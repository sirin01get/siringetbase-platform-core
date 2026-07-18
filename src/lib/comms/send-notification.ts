// sendNotification() — the "everything else" entry point from
// ../../../comms/README.md's "Two Entry Points, One Pipeline": referral
// invites, verification-approved/rejected notices, future
// engagement-milestone emails. Unlike the Send Email Hook (which Supabase
// calls, so the trigger is external), this is a direct function call from
// a vertical's own backend code that already knows exactly who it's
// notifying and why — no webhook, no signature to verify.
//
// Converges on the same template registry, provider adapter, and delivery
// log as the hook route — that convergence is the shared facility.

import { getEmailSender } from "./provider-registry";
import { logDispatchAttempt, updateDispatchResult } from "./log";
import type { SendEmailRequest, SendEmailResult } from "./types";

export async function sendNotification(request: SendEmailRequest): Promise<SendEmailResult> {
  const dispatchId = await logDispatchAttempt(request);
  const sender = getEmailSender();
  const result = await sender.send(request);
  await updateDispatchResult(dispatchId, result);
  return result;
}
