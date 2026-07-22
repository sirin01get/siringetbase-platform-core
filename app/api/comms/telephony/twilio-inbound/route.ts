import { NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";
import { verifyTwilioSignature } from "@/lib/comms/telephony/verify-twilio-webhook";

// POST /api/comms/telephony/twilio-inbound — inbound voice webhook (Phase 0
// skeleton). Configure this URL on the Twilio number's Voice webhook once
// deployed (PMMUSA/ops/twilio-setup-checklist.md hand-back step).
//
// Compliance in the call path by construction (GLOBAL/05 §A): the
// recording disclosure is the FIRST thing every caller hears, before any
// recording or routing. The intake-triage-agent replaces the placeholder
// <Say> below (PMMUSA doc 09 flow); warm transfer to a coordinator resolves
// via Herzbeat (GLOBAL/08 §C) from Phase 1.

const RECORDING_DISCLOSURE =
  "Thank you for calling the maintenance line. This call may be recorded for quality assurance.";

function twiml(body: string): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params[key] = value;
  }

  const valid = await verifyTwilioSignature(
    env.twilioAuthToken(),
    req.nextUrl.href,
    params,
    req.headers.get("x-twilio-signature")
  );
  if (!valid) {
    return NextResponse.json({ status: "error", message: "Invalid signature" }, { status: 403 });
  }

  // Phase 0 placeholder: disclosure → acknowledge → hang up. The
  // intake-triage flow (record issue, SMS photo link, warm transfer)
  // lands here next; every branch keeps the disclosure first.
  return twiml(
    `<Say>${RECORDING_DISCLOSURE}</Say>` +
      `<Say>The intake service is being set up. Please contact your property manager directly for now.</Say>` +
      `<Hangup/>`
  );
}
