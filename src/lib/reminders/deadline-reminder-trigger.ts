import { env } from "@/config/env";

// Thin trigger for worker.ts's daily 05:00 cron — fires LawForge's matter
// deadline-reminder sweep. Directly modelled on
// ../billing/subscription-billing-trigger.ts (same outbound-HTTP shape, same
// "best-effort, log don't throw" posture); see env.ts's lawforgeAppBaseUrl()/
// deadlineRemindersInternalSecret() for why this Worker drives a job that
// belongs to another vertical.
//
// Short version: LawForge has its own scheduled() handler ready to go, but
// the Workers Free plan caps Cron Triggers at 5 account-wide and all five
// are taken (cafocus/app 2, this Worker 3). Rather than pay to schedule one
// job, LawForge exposes the sweep as an internal endpoint and this cron
// calls it.
//
// lawforge/app's POST /api/internal/deadline-sweep does all the real work
// (finding open matters with a deadline inside the reminder window,
// grouping them per lawyer, sending one digest each via /api/comms/notify,
// then stamping last_reminded_at). This function only fires it and logs the
// outcome.
export async function triggerLawforgeDeadlineSweep(): Promise<void> {
  try {
    const res = await fetch(`${env.lawforgeAppBaseUrl()}/api/internal/deadline-sweep`, {
      method: "POST",
      headers: { "x-deadline-reminders-internal-secret": env.deadlineRemindersInternalSecret() },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`LawForge deadline sweep trigger failed: HTTP ${res.status}`, body);
      return;
    }
    console.log("LawForge deadline sweep triggered:", body);
  } catch (err) {
    console.error("LawForge deadline sweep trigger threw:", err);
  }
}
