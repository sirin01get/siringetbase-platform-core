import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// The billing rate card — ../../billing/README.md's `revenue_share_rates`
// and `subscription_plans` entries, built as two real, effective-dated
// tables under this build's product terminology: "Platform charges" (the
// percentage cut taken at payout) and "platform membership fee" (a fixed,
// recurring platform-access fee). See
// ../../supabase/migrations/0008_billing_rate_cards.sql for the schema and
// exactly why effective-dating works the way it does.
//
// Managed by the admin control plane (app/api/admin/billing/*,
// /admin/billing) — every function here is service-role, no session check
// of its own (same no-auth-gate dev-phase posture as
// app/api/admin/sync-queue/*'s own header comments; protect before a real
// launch).
//
// "platform_membership_fees" is modeled and manageable here, but nothing
// in this codebase actively collects it yet — there's no recurring-billing
// job that calls PaymentGatewayPort.charge() against it on a cadence. That
// job is a separate, not-yet-built piece (subscription_charges in the
// billing doc's Model table); this file only gives an admin somewhere real
// to set the number in advance of that existing.

export interface PlatformChargeRateRow {
  id: string;
  vertical: string;
  serviceTypeSlug: string | null;
  rate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  createdAt: string;
}

export interface PlatformMembershipFeeRow {
  id: string;
  vertical: string;
  role: string;
  amount: number;
  billingCycle: "monthly" | "quarterly" | "annual";
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  createdAt: string;
}

export async function listPlatformChargeRates(vertical?: string): Promise<PlatformChargeRateRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  let query = supabase
    .from("platform_charge_rates")
    .select("id, vertical, service_type_slug, rate, effective_from, effective_to, note, created_at")
    .order("effective_from", { ascending: false });
  if (vertical) query = query.eq("vertical", vertical);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    vertical: r.vertical,
    serviceTypeSlug: r.service_type_slug,
    rate: r.rate,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    note: r.note,
    createdAt: r.created_at,
  }));
}

export async function listPlatformMembershipFees(vertical?: string): Promise<PlatformMembershipFeeRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  let query = supabase
    .from("platform_membership_fees")
    .select("id, vertical, role, amount, billing_cycle, effective_from, effective_to, note, created_at")
    .order("effective_from", { ascending: false });
  if (vertical) query = query.eq("vertical", vertical);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    vertical: r.vertical,
    role: r.role,
    amount: r.amount,
    billingCycle: r.billing_cycle,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    note: r.note,
    createdAt: r.created_at,
  }));
}

// Closes out whichever open-ended row currently covers this scope (sets its
// effective_to to the new row's effective_from) before inserting — keeps
// "what's effective right now" unambiguous without a database-level
// no-overlap constraint (see the migration's header comment on why that's
// enforced here, not in SQL). Only touches a row that would otherwise
// overlap the new one (effective_from < new effectiveFrom, effective_to
// still null) — inserting a rate for a scope with no existing open-ended
// row (the common case: the very first rate, or a second future-dated rate
// stacked after an already-scheduled one) is a plain insert, nothing to close.
export async function createPlatformChargeRate(params: {
  vertical: string;
  serviceTypeSlug: string | null;
  rate: number;
  effectiveFrom: string;
  note?: string | null;
}): Promise<{ id: string }> {
  const supabase = createSupabaseServiceRoleClient();

  let closeQuery = supabase
    .from("platform_charge_rates")
    .update({ effective_to: params.effectiveFrom })
    .eq("vertical", params.vertical)
    .is("effective_to", null)
    .lt("effective_from", params.effectiveFrom);
  closeQuery = params.serviceTypeSlug
    ? closeQuery.eq("service_type_slug", params.serviceTypeSlug)
    : closeQuery.is("service_type_slug", null);
  await closeQuery;

  const { data, error } = await supabase
    .from("platform_charge_rates")
    .insert({
      vertical: params.vertical,
      service_type_slug: params.serviceTypeSlug,
      rate: params.rate,
      effective_from: params.effectiveFrom,
      note: params.note ?? null,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Could not create platform charge rate: ${error?.message ?? "unknown error"}`);
  return { id: data.id };
}

export async function createPlatformMembershipFee(params: {
  vertical: string;
  role: string;
  amount: number;
  billingCycle: "monthly" | "quarterly" | "annual";
  effectiveFrom: string;
  note?: string | null;
}): Promise<{ id: string }> {
  const supabase = createSupabaseServiceRoleClient();

  await supabase
    .from("platform_membership_fees")
    .update({ effective_to: params.effectiveFrom })
    .eq("vertical", params.vertical)
    .eq("role", params.role)
    .is("effective_to", null)
    .lt("effective_from", params.effectiveFrom);

  const { data, error } = await supabase
    .from("platform_membership_fees")
    .insert({
      vertical: params.vertical,
      role: params.role,
      amount: params.amount,
      billing_cycle: params.billingCycle,
      effective_from: params.effectiveFrom,
      note: params.note ?? null,
    })
    .select("id")
    .single();

  if (error || !data)
    throw new Error(`Could not create platform membership fee: ${error?.message ?? "unknown error"}`);
  return { id: data.id };
}
