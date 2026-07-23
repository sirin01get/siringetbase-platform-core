import { env } from "@/config/env";

// Thin trigger for worker.ts's daily cron — see env.ts's
// cafocusAppBaseUrl()/subscriptionsInternalSecret() header comment for why
// this is an outbound HTTP call rather than a direct query. cafocus/app's
// POST /api/internal/subscriptions/run-billing-cycle does all the real
// work (finding due ca_module_subscriptions, charging mandates or creating
// pending manual invoices, sending reminders); this function only fires it
// and logs the outcome, same "best-effort, log don't throw" posture as
// ../admin/audit-log-purge.ts's purgeDeletedAuditLogEntries().
export async function triggerCafocusSubscriptionBillingCycle(): Promise<void> {
  try {
    const res = await fetch(`${env.cafocusAppBaseUrl()}/api/internal/subscriptions/run-billing-cycle`, {
      method: "POST",
      headers: { "x-subscriptions-internal-secret": env.subscriptionsInternalSecret() },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`Subscription billing cycle trigger failed: HTTP ${res.status}`, body);
      return;
    }
    console.log("Subscription billing cycle triggered:", body);
  } catch (err) {
    console.error("Subscription billing cycle trigger threw:", err);
  }
}
