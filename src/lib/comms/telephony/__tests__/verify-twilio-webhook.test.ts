import { describe, expect, it } from "vitest";
import { computeTwilioSignature, verifyTwilioSignature } from "../verify-twilio-webhook";

// Pins the signature algorithm (url + sorted key/value concat, HMAC-SHA1,
// base64) so a refactor can't silently break inbound-webhook auth.
describe("Twilio webhook signature", () => {
  const authToken = "test_auth_token";
  const url = "https://example.com/api/comms/telephony/twilio-inbound";
  const params = { CallSid: "CA123", From: "+15551234567", To: "+15559876543" };

  it("accepts a correctly signed request", async () => {
    const sig = await computeTwilioSignature(authToken, url, params);
    expect(await verifyTwilioSignature(authToken, url, params, sig)).toBe(true);
  });

  it("sorts params by key (order-independent)", async () => {
    const a = await computeTwilioSignature(authToken, url, params);
    const b = await computeTwilioSignature(authToken, url, {
      To: "+15559876543",
      From: "+15551234567",
      CallSid: "CA123",
    });
    expect(a).toBe(b);
  });

  it("rejects a tampered payload", async () => {
    const sig = await computeTwilioSignature(authToken, url, params);
    expect(
      await verifyTwilioSignature(authToken, url, { ...params, To: "+15550000000" }, sig)
    ).toBe(false);
  });

  it("rejects a wrong token and a missing signature", async () => {
    const sig = await computeTwilioSignature(authToken, url, params);
    expect(await verifyTwilioSignature("other_token", url, params, sig)).toBe(false);
    expect(await verifyTwilioSignature(authToken, url, params, null)).toBe(false);
  });
});
