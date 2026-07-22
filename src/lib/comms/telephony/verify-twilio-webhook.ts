// Twilio inbound-webhook signature validation (X-Twilio-Signature):
// base64(HMAC-SHA1(authToken, fullUrl + concat(sortedParamKey+value))).
// Same trust posture as the Send Email Hook's Standard-Webhooks check —
// no unverified payload is ever acted on. WebCrypto only (Workers-safe).

export async function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
): Promise<string> {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  let binary = "";
  for (const b of new Uint8Array(sig)) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  providedSignature: string | null
): Promise<boolean> {
  if (!providedSignature) return false;
  const expected = await computeTwilioSignature(authToken, url, params);
  if (expected.length !== providedSignature.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ providedSignature.charCodeAt(i);
  }
  return diff === 0;
}
