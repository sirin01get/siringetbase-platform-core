import { describe, expect, it } from "vitest";
import { allSmsAdapters, allTelephonyAdapters } from "../registry";
import { createTwilioSms, createTwilioTelephony } from "../adapters/twilio";
import type { SmsPort, TelephonyPort, SendSmsRequest, StartCallRequest } from "../types";

// One contract suite per port, run against EVERY adapter — mocks AND the
// real Twilio adapter (over a stubbed transport, so CI is deterministic and
// needs no credentials). The stub simulates Twilio's REST responses,
// including provider-side failures, so the real adapter's error mapping is
// held to the same behavior the mocks guarantee.
//
// Harness knobs: how to trigger a provider failure / pending state differs
// per adapter (mocks read the reference field; the Twilio stub reacts to
// request content), and telephony "pending" doesn't exist for real Twilio
// (creation 201 = initiated; progress arrives via status callbacks), so
// that one test is capability-gated.

interface SmsHarness {
  name: string;
  adapter: SmsPort;
  smsPending: boolean; // adapter can report a pending SMS state
}

interface TelephonyHarness {
  name: string;
  adapter: TelephonyPort;
  callPending: boolean; // adapter can report a pending call state
}

// --- Twilio stub transport -------------------------------------------------

const twilioStubFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const body = String(init?.body ?? "");
  const params = new URLSearchParams(body);
  const probe = `${params.get("Body") ?? ""} ${params.get("Twiml") ?? ""} ${params.get("To") ?? ""}`;

  const json = (status: number, payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), { status });

  if (probe.includes("FORCE_FAIL")) {
    return json(400, { code: 21211, message: "Simulated Twilio API error", status: 400 });
  }
  if (url.includes("/Messages.json")) {
    const pending = probe.includes("FORCE_PENDING");
    return json(201, { sid: "SM_stub_1", status: pending ? "queued" : "sent" });
  }
  if (url.includes("/Calls/")) {
    return json(200, { sid: url.split("/Calls/")[1]!.replace(".json", ""), status: "in-progress" });
  }
  if (url.includes("/Calls.json")) {
    return json(201, { sid: "CA_stub_1", status: "queued" });
  }
  return json(404, { message: "unexpected stub path: " + url });
};

const twilioConfig = {
  accountSid: "AC_test",
  apiKeySid: "SK_test",
  apiKeySecret: "secret_test",
  fromNumber: "+15559876543",
  fetchImpl: twilioStubFetch,
};

// --- Harness sets ----------------------------------------------------------

const smsHarnesses: SmsHarness[] = [
  ...allSmsAdapters().map((adapter) => ({ name: adapter.providerName, adapter, smsPending: true })),
  { name: "twilio (stubbed transport)", adapter: createTwilioSms(twilioConfig), smsPending: true },
];

const telephonyHarnesses: TelephonyHarness[] = [
  ...allTelephonyAdapters().map((adapter) => ({
    name: adapter.providerName,
    adapter,
    callPending: true,
  })),
  {
    name: "twilio (stubbed transport)",
    adapter: createTwilioTelephony(twilioConfig),
    callPending: false,
  },
];

// --- Request builders ------------------------------------------------------

// Failure triggers ride in fields every adapter sends to its provider
// (body/To for SMS, disclosure text for calls), so both mocks (which read
// reference) and the stubbed real adapter (which reacts to payload) fire.
const smsRequest = (overrides: Partial<SendSmsRequest> = {}): SendSmsRequest => ({
  to: "+15551234567",
  vertical: "pmmusa",
  role: "resident",
  consentRef: "consent_00000000-0000-0000-0000-000000000001",
  body: "Your work order #123 has been updated.",
  reference: "wo_123_update",
  ...overrides,
});

const smsFail = (): SendSmsRequest =>
  smsRequest({ reference: "FORCE_FAIL", body: "FORCE_FAIL Your work order failed to send." });
const smsPending = (): SendSmsRequest =>
  smsRequest({ reference: "FORCE_PENDING", body: "FORCE_PENDING queued update." });

const callRequest = (overrides: Partial<StartCallRequest> = {}): StartCallRequest => ({
  to: "+15551234567",
  from: "+15559876543",
  vertical: "pmmusa",
  recordCall: true,
  recordingDisclosure: "This call may be recorded for quality assurance.",
  reference: "wo_123_dispatch",
  ...overrides,
});

const callFail = (): StartCallRequest =>
  callRequest({
    reference: "FORCE_FAIL",
    recordingDisclosure: "FORCE_FAIL This call may be recorded.",
  });

// --- SMS contract ----------------------------------------------------------

for (const h of smsHarnesses) {
  describe(`SmsPort contract: ${h.name}`, () => {
    it("sends when consent is present", async () => {
      const result = await h.adapter.sendSms(smsRequest());
      expect(result.success).toBe(true);
      expect(result.status).toBe("sent");
      expect(result.providerMessageId).toBeTruthy();
      expect(result.rawResponse).toBeTypeOf("object");
    });

    it("refuses to send without a consentRef (TCPA)", async () => {
      const result = await h.adapter.sendSms(smsRequest({ consentRef: "" }));
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.failureReason).toMatch(/consent/i);
    });

    it("reports provider failure without throwing", async () => {
      const result = await h.adapter.sendSms(smsFail());
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.failureReason).toBeTruthy();
    });

    if (h.smsPending) {
      it("reports pending delivery as not-success", async () => {
        const result = await h.adapter.sendSms(smsPending());
        expect(result.success).toBe(false);
        expect(result.status).toBe("pending");
      });
    }
  });
}

// --- Telephony contract ----------------------------------------------------

for (const h of telephonyHarnesses) {
  describe(`TelephonyPort contract: ${h.name}`, () => {
    it("initiates an outbound call", async () => {
      const result = await h.adapter.startCall(callRequest());
      expect(result.success).toBe(true);
      expect(result.status).toBe("initiated");
      expect(result.providerCallId).toBeTruthy();
    });

    it("refuses to record without a disclosure", async () => {
      const result = await h.adapter.startCall(
        callRequest({ recordCall: true, recordingDisclosure: undefined })
      );
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.failureReason).toMatch(/disclosure/i);
    });

    it("allows unrecorded calls without a disclosure", async () => {
      const result = await h.adapter.startCall(
        callRequest({ recordCall: false, recordingDisclosure: undefined })
      );
      expect(result.success).toBe(true);
    });

    it("reports call failure without throwing", async () => {
      const result = await h.adapter.startCall(callFail());
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.failureReason).toBeTruthy();
    });

    it("warm-transfers an active call", async () => {
      const started = await h.adapter.startCall(callRequest());
      const result = await h.adapter.transferCall({
        providerCallId: started.providerCallId,
        target: "sip:ops-coordinator@siringet-us.example",
        reference: "warm_transfer",
      });
      expect(result.success).toBe(true);
      expect(result.status).toBe("transferred");
      expect(result.providerCallId).toBe(started.providerCallId);
    });

    it("reports a dropped transfer without throwing", async () => {
      const result = await h.adapter.transferCall({
        providerCallId: "call_x",
        target: "sip:FORCE_FAIL@siringet-us.example",
        reference: "FORCE_FAIL",
      });
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
    });
  });
}
