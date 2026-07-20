import { NextResponse } from "next/server";
import { listPlatformChargeRates, createPlatformChargeRate } from "@/lib/billing/rate-card";
import { requireAdmin } from "@/lib/admin/auth";
import { writeAuditLog } from "@/lib/admin/audit";

interface CreateBody {
  vertical?: string;
  service_type_slug?: string | null;
  rate?: number;
  effective_from?: string;
  note?: string;
}

// Admin control plane for "Platform charges" — ../../../billing/README.md,
// ../../../../supabase/migrations/0008_billing_rate_cards.sql. List history
// / schedule a new rate, optionally effective on a future date.
//
// business_admin only — real per-admin session + audit trail via
// requireAdmin() (see ../../../../README.md "Access control"). This moves
// real money (the rate deducted from every CA's payout), so POST logs the
// full old-scope/new-rate detail on every create.
export async function GET(request: Request) {
  const auth = await requireAdmin(request, "billing.charge_rate.list", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const vertical = searchParams.get("vertical") ?? undefined;

  try {
    const rows = await listPlatformChargeRates(vertical);
    return NextResponse.json({ status: "ok", rows });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not load rates." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request, "billing.charge_rate.create", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as CreateBody;

  if (!body.vertical) {
    return NextResponse.json({ status: "error", message: "vertical is required." }, { status: 400 });
  }
  if (body.rate === undefined || body.rate === null || body.rate < 0 || body.rate > 1) {
    return NextResponse.json(
      { status: "error", message: "rate must be a number between 0 and 1 (e.g. 0.10 for 10%)." },
      { status: 400 }
    );
  }
  if (!body.effective_from) {
    return NextResponse.json({ status: "error", message: "effective_from is required." }, { status: 400 });
  }
  const effectiveFrom = new Date(body.effective_from);
  if (Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ status: "error", message: "effective_from must be a valid date." }, { status: 400 });
  }

  try {
    const result = await createPlatformChargeRate({
      vertical: body.vertical,
      serviceTypeSlug: body.service_type_slug?.trim() || null,
      rate: body.rate,
      effectiveFrom: effectiveFrom.toISOString(),
      note: body.note?.trim() || null,
    });
    await writeAuditLog({
      actor: auth.actor,
      action: "billing.charge_rate.create",
      targetType: "platform_charge_rate",
      targetId: result.id,
      outcome: "success",
      detail: {
        vertical: body.vertical,
        service_type_slug: body.service_type_slug?.trim() || null,
        rate: body.rate,
        effective_from: effectiveFrom.toISOString(),
        note: body.note?.trim() || null,
      },
      request,
    });
    return NextResponse.json({ status: "ok", id: result.id });
  } catch (err) {
    await writeAuditLog({
      actor: auth.actor,
      action: "billing.charge_rate.create",
      outcome: "error",
      detail: { vertical: body.vertical, error: err instanceof Error ? err.message : String(err) },
      request,
    });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not create rate." },
      { status: 500 }
    );
  }
}
