import type {
  SmsPort,
  TelephonyPort,
  SendSmsRequest,
  SendSmsResult,
  StartCallRequest,
  StartCallResult,
  TransferCallRequest,
  TransferCallResult,
} from "../types";

// Real Twilio adapter — REST API via fetch (no SDK: Workers-friendly, zero
// deps). Ships only because it passes the exact same contract suite the
// mocks pass (__tests__/contract.test.ts) — the payments-README mock-to-real
// rule. Transport is injectable so the contract suite runs deterministically
// against a stub; production uses global fetch.
//
// Compliance behaviors are part of the PORT contract, enforced here exactly
// as in the mocks: no SMS without consentRef (TCPA), no recording without a
// disclosure. These checks run BEFORE any network call.

export interface TwilioConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  // Messaging Service SID once A2P campaign is approved; falls back to the
  // raw from-number before that (voice-first launch, doc 12 R1 step 4).
  messagingServiceSid?: string;
  // E.164 sending number — used as SMS From when no messaging service yet.
  fromNumber: string;
  fetchImpl?: typeof fetch;
}

const API_BASE = "https://api.twilio.com/2010-04-01";

function authHeader(config: TwilioConfig): string {
  // API key auth: key SID as username, secret as password.
  return "Basic " + btoa(`${config.apiKeySid}:${config.apiKeySecret}`);
}

async function twilioPost(
  config: TwilioConfig,
  path: string,
  form: Record<string, string>
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const doFetch = config.fetchImpl ?? fetch;
  const response = await doFetch(`${API_BASE}/Accounts/${config.accountSid}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, body };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function createTwilioSms(config: TwilioConfig): SmsPort {
  return {
    providerName: "twilio",

    async sendSms(request: SendSmsRequest): Promise<SendSmsResult> {
      if (!request.consentRef) {
        return {
          success: false,
          providerMessageId: "",
          status: "failed",
          failureReason: "Refused: no consentRef (TCPA: no SMS without a consent row)",
          rawResponse: { provider: "twilio", outcome: "consent_missing" },
        };
      }

      const form: Record<string, string> = {
        To: request.to,
        Body: request.body,
      };
      if (config.messagingServiceSid) form.MessagingServiceSid = config.messagingServiceSid;
      else form.From = config.fromNumber;

      try {
        const { ok, body } = await twilioPost(config, "/Messages.json", form);
        if (!ok) {
          return {
            success: false,
            providerMessageId: String(body.sid ?? ""),
            status: "failed",
            failureReason: String(body.message ?? "Twilio API error"),
            rawResponse: body,
          };
        }
        const twilioStatus = String(body.status ?? "");
        // queued/accepted/sending = in flight → pending; sent/delivered = sent.
        const pending = ["queued", "accepted", "sending", "scheduled"].includes(twilioStatus);
        return {
          success: !pending,
          providerMessageId: String(body.sid ?? ""),
          status: pending ? "pending" : "sent",
          rawResponse: body,
        };
      } catch (err) {
        return {
          success: false,
          providerMessageId: "",
          status: "failed",
          failureReason: err instanceof Error ? err.message : String(err),
          rawResponse: { provider: "twilio", outcome: "transport_error" },
        };
      }
    },
  };
}

export function createTwilioTelephony(config: TwilioConfig): TelephonyPort {
  return {
    providerName: "twilio",

    async startCall(request: StartCallRequest): Promise<StartCallResult> {
      if (request.recordCall && !request.recordingDisclosure) {
        return {
          success: false,
          providerCallId: "",
          status: "failed",
          failureReason:
            "Refused: recordCall without recordingDisclosure (disclosure required in every call path)",
          rawResponse: { provider: "twilio", outcome: "disclosure_missing" },
        };
      }

      // Outbound TwiML: say the disclosure (when recording) before anything
      // else — the disclosure is in the call path by construction.
      const disclosureSay = request.recordCall
        ? `<Say>${escapeXml(request.recordingDisclosure!)}</Say>`
        : "";
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>${disclosureSay}<Pause length="1"/></Response>`;

      const form: Record<string, string> = {
        To: request.to,
        From: request.from,
        Twiml: twiml,
      };
      if (request.recordCall) form.Record = "true";

      try {
        const { ok, body } = await twilioPost(config, "/Calls.json", form);
        if (!ok) {
          return {
            success: false,
            providerCallId: String(body.sid ?? ""),
            status: "failed",
            failureReason: String(body.message ?? "Twilio API error"),
            rawResponse: body,
          };
        }
        // A 201 means Twilio accepted the call — that IS initiation.
        // Twilio's creation response always reads "queued"; connect/answer
        // progress arrives via status callbacks, not here.
        return {
          success: true,
          providerCallId: String(body.sid ?? ""),
          status: "initiated",
          rawResponse: body,
        };
      } catch (err) {
        return {
          success: false,
          providerCallId: "",
          status: "failed",
          failureReason: err instanceof Error ? err.message : String(err),
          rawResponse: { provider: "twilio", outcome: "transport_error" },
        };
      }
    },

    async transferCall(request: TransferCallRequest): Promise<TransferCallResult> {
      // Warm transfer = live-update the in-progress call with new TwiML
      // dialing the target (SIP URI or E.164).
      const isSip = request.target.startsWith("sip:");
      const dial = isSip
        ? `<Dial><Sip>${escapeXml(request.target)}</Sip></Dial>`
        : `<Dial>${escapeXml(request.target)}</Dial>`;
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>${dial}</Response>`;

      try {
        const { ok, body } = await twilioPost(
          config,
          `/Calls/${encodeURIComponent(request.providerCallId)}.json`,
          { Twiml: twiml }
        );
        if (!ok) {
          return {
            success: false,
            providerCallId: request.providerCallId,
            status: "failed",
            failureReason: String(body.message ?? "Twilio API error"),
            rawResponse: body,
          };
        }
        return {
          success: true,
          providerCallId: request.providerCallId,
          status: "transferred",
          rawResponse: body,
        };
      } catch (err) {
        return {
          success: false,
          providerCallId: request.providerCallId,
          status: "failed",
          failureReason: err instanceof Error ? err.message : String(err),
          rawResponse: { provider: "twilio", outcome: "transport_error" },
        };
      }
    },
  };
}
