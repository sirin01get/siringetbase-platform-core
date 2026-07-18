// Shared notification_dispatch logging — both entry points (the Send
// Email Hook route and sendNotification()) write through this so there's
// exactly one place that knows the table's shape. Uses the service-role
// client deliberately: this table has no end-user RLS policy (see
// ../../supabase/migrations/0006_notification_dispatch.sql), and both
// callers are trusted server-side code, not requests acting as a signed-in
// user.

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { SendEmailRequest, SendEmailResult } from "./types";

export async function logDispatchAttempt(request: SendEmailRequest): Promise<string | null> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("notification_dispatch")
    .insert({
      vertical: request.vertical,
      role: request.role,
      channel: "email",
      trigger_event: request.triggerEvent,
      recipient_email: request.to,
      provider: "resend",
      status: "queued",
    })
    .select("id")
    .single();

  if (error) {
    // Logging failure must never block the actual send — comms exists to
    // get the email out, the log is observability, not a gate. Surface via
    // console so it's visible in Workers logs without failing the request.
    console.error("comms: failed to insert notification_dispatch row", error);
    return null;
  }
  return data?.id ?? null;
}

export async function updateDispatchResult(dispatchId: string | null, result: SendEmailResult): Promise<void> {
  if (!dispatchId) return;
  const supabase = createSupabaseServiceRoleClient();
  const { error } = await supabase
    .from("notification_dispatch")
    .update({
      status: result.success ? "sent" : "failed",
      provider_message_id: result.providerMessageId || null,
      error_message: result.failureReason ?? null,
    })
    .eq("id", dispatchId);

  if (error) {
    console.error("comms: failed to update notification_dispatch row", error);
  }
}
