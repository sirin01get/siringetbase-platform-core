import { NextResponse } from "next/server";
import { listModuleSubscriptionPlans, createModuleSubscriptionPlan } from "@/lib/billing/subscription-plans";
import { requireAdmin } from "@/lib/admin/auth";
import { writeAuditLog } from "@/lib/admin/audit";

interface CreateBody {
  vertical?: string;
  service_type_slug?: string;
  tier?: string;
  amount?: number;
  included_usage_quota?: number | null;
  overage_unit_rate?: number | null;
  usage_unit_label?: string | null;
  effective_from?: string;
  note?: string;
}

// Admin control plane for module subscription plans (tier/pricing for
// subscription-monetized service types like cafocus's "Client management" /
// "Document storage" / "Automated reminders") — same shape as
// ../platform-charge-rates/route.ts, see that file's header comment and
// ../../../../../supabase/migrations/0020_module_subscription_plans.sql.
//
// business_admin only, audit-logged on every create — this sets the number
// a CA's recurring mandate/manual-monthly charge is priced against.
export async function GET(request: Request) {
  const auth = await requireAdmin(request, "billing.subscription_plan.list", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const vertical = searchParams.get("vertical") ?? undefined;

  try {
    const rows = await listModuleSubscriptionPlans(vertical);
    return NextResponse.json({ status: "ok", rows });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not load subscription plans." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request, "billing.subscription_plan.create", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as CreateBody;

  if (!body.vertical) {
    return NextResponse.json({ status: "error", message: "vertical is required." }, { status: 400 });
  }
  if (!body.service_type_slug) {
    return NextResponse.json({ status: "error", message: "service_type_slug is required." }, { status: 400 });
  }
  if (!body.tier) {
    return NextResponse.json({ status: "error", message: "tier is required." }, { status: 400 });
  }
  if (body.amount === undefined || body.amount === null || body.amount < 0) {
    return NextResponse.json({ status: "error", message: "amount must be a non-negative number." }, { status: 400 });
  }
  if (!body.effective_from) {
    return NextResponse.json({ status: "error", message: "effective_from is required." }, { status: 400 });
  }
  const effectiveFrom = new Date(body.effective_from);
  if (Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ status: "error", message: "effective_from must be a valid date." }, { status: 400 });
  }

  try {
    const result = await createModuleSubscriptionPlan({
      vertical: body.vertical,
      serviceTypeSlug: body.service_type_slug,
      tier: body.tier,
      amount: body.amount,
      includedUsageQuota: body.included_usage_quota ?? null,
      overageUnitRate: body.overage_unit_rate ?? null,
      usageUnitLabel: body.usage_unit_label?.trim() || null,
      effectiveFrom: effectiveFrom.toISOString(),
      note: body.note?.trim() || null,
    });
    await writeAuditLog({
      actor: auth.actor,
      action: "billing.subscription_plan.create",
      targetType: "module_subscription_plan",
      targetId: result.id,
      outcome: "success",
      detail: { ...body, effective_from: effectiveFrom.toISOString() },
      request,
    });
    return NextResponse.json({ status: "ok", id: result.id });
  } catch (err) {
    await writeAuditLog({
      actor: auth.actor,
      action: "billing.subscription_plan.create",
      outcome: "error",
      detail: { ...body, error: err instanceof Error ? err.message : String(err) },
      request,
    });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not create plan." },
      { status: 500 }
    );
  }
}
