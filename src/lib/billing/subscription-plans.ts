import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// Module subscription plans — the admin-managed tier/pricing side of
// recurring module billing (Client management / Document storage /
// Automated reminders in cafocus/app; any future vertical's own
// subscription-monetized service types). See
// ../../../supabase/migrations/0020_module_subscription_plans.sql for the
// schema and why this is scoped (vertical, service_type_slug, tier) rather
// than one flat fee like platform_membership_fees.
//
// Same effective-dated, close-previous-row-on-insert control-plane pattern
// as ./rate-card.ts — see that file's header comment for the reasoning this
// mirrors exactly. Managed by /admin/billing (app/api/admin/billing/*),
// business_admin only, audit-logged on every create.

export interface ModuleSubscriptionPlanRow {
  id: string;
  vertical: string;
  serviceTypeSlug: string;
  tier: string;
  amount: number;
  includedUsageQuota: number | null;
  overageUnitRate: number | null;
  usageUnitLabel: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  createdAt: string;
}

export async function listModuleSubscriptionPlans(vertical?: string): Promise<ModuleSubscriptionPlanRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  let query = supabase
    .from("module_subscription_plans")
    .select(
      "id, vertical, service_type_slug, tier, amount, included_usage_quota, overage_unit_rate, usage_unit_label, effective_from, effective_to, note, created_at"
    )
    .order("effective_from", { ascending: false });
  if (vertical) query = query.eq("vertical", vertical);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    vertical: r.vertical,
    serviceTypeSlug: r.service_type_slug,
    tier: r.tier,
    amount: r.amount,
    includedUsageQuota: r.included_usage_quota,
    overageUnitRate: r.overage_unit_rate,
    usageUnitLabel: r.usage_unit_label,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    note: r.note,
    createdAt: r.created_at,
  }));
}

// Closes out the open-ended row for the same (vertical, service_type_slug,
// tier) scope before inserting — identical posture to
// ./rate-card.ts's createPlatformChargeRate().
export async function createModuleSubscriptionPlan(params: {
  vertical: string;
  serviceTypeSlug: string;
  tier: string;
  amount: number;
  includedUsageQuota?: number | null;
  overageUnitRate?: number | null;
  usageUnitLabel?: string | null;
  effectiveFrom: string;
  note?: string | null;
}): Promise<{ id: string }> {
  const supabase = createSupabaseServiceRoleClient();

  await supabase
    .from("module_subscription_plans")
    .update({ effective_to: params.effectiveFrom })
    .eq("vertical", params.vertical)
    .eq("service_type_slug", params.serviceTypeSlug)
    .eq("tier", params.tier)
    .is("effective_to", null)
    .lt("effective_from", params.effectiveFrom);

  const { data, error } = await supabase
    .from("module_subscription_plans")
    .insert({
      vertical: params.vertical,
      service_type_slug: params.serviceTypeSlug,
      tier: params.tier,
      amount: params.amount,
      included_usage_quota: params.includedUsageQuota ?? null,
      overage_unit_rate: params.overageUnitRate ?? null,
      usage_unit_label: params.usageUnitLabel ?? null,
      effective_from: params.effectiveFrom,
      note: params.note ?? null,
    })
    .select("id")
    .single();

  if (error || !data)
    throw new Error(`Could not create module subscription plan: ${error?.message ?? "unknown error"}`);
  return { id: data.id };
}

// Effective-dated lookup for a specific (vertical, service_type_slug, tier)
// — used by the recurring billing cron (../billing/... TODO see
// subscription-billing.ts) to price a renewal against whatever's live right
// now, and by the admin UI's "current" display. Same precedence rule as
// ../../../cafocus/app/src/lib/billing/rate-card.ts's read side: most
// recently effective row wins; returns null rather than throwing when no
// plan has ever been set for this exact scope.
export async function getEffectiveModuleSubscriptionPlan(params: {
  vertical: string;
  serviceTypeSlug: string;
  tier: string;
  atDate?: Date;
}): Promise<ModuleSubscriptionPlanRow | null> {
  const supabase = createSupabaseServiceRoleClient();
  const at = (params.atDate ?? new Date()).toISOString();

  const { data, error } = await supabase
    .from("module_subscription_plans")
    .select(
      "id, vertical, service_type_slug, tier, amount, included_usage_quota, overage_unit_rate, usage_unit_label, effective_from, effective_to, note, created_at"
    )
    .eq("vertical", params.vertical)
    .eq("service_type_slug", params.serviceTypeSlug)
    .eq("tier", params.tier)
    .lte("effective_from", at)
    .or(`effective_to.is.null,effective_to.gt.${at}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    vertical: data.vertical,
    serviceTypeSlug: data.service_type_slug,
    tier: data.tier,
    amount: data.amount,
    includedUsageQuota: data.included_usage_quota,
    overageUnitRate: data.overage_unit_rate,
    usageUnitLabel: data.usage_unit_label,
    effectiveFrom: data.effective_from,
    effectiveTo: data.effective_to,
    note: data.note,
    createdAt: data.created_at,
  };
}
