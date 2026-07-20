import { NextResponse } from "next/server";
import { listPlatformMembershipFees, createPlatformMembershipFee } from "@/lib/billing/rate-card";
import { requireAdmin } from "@/lib/admin/auth";
import { writeAuditLog } from "@/lib/admin/audit";

interface CreateBody {
  vertical?: string;
  role?: string;
  amount?: number;
  billing_cycle?: string;
  effective_from?: string;
  note?: string;
}

const VALID_BILLING_CYCLES = ["monthly", "quarterly", "annual"] as const;

// Admin control plane for the "platform membership fee" —
// ../../../billing/README.md, ../../../../supabase/migrations/0008_billing_rate_cards.sql.
// Same shape as ../platform-charge-rates/route.ts — business_admin only,
// real per-admin session + audit trail via requireAdmin().
export async function GET(request: Request) {
  const auth = await requireAdmin(request, "billing.membership_fee.list", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const vertical = searchParams.get("vertical") ?? undefined;

  try {
    const rows = await listPlatformMembershipFees(vertical);
    return NextResponse.json({ status: "ok", rows });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not load fees." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request, "billing.membership_fee.create", ["business_admin"]);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as CreateBody;

  if (!body.vertical || !body.role) {
    return NextResponse.json({ status: "error", message: "vertical and role are required." }, { status: 400 });
  }
  if (body.amount === undefined || body.amount === null || body.amount < 0) {
    return NextResponse.json({ status: "error", message: "amount must be a non-negative number." }, { status: 400 });
  }
  if (!body.billing_cycle || !VALID_BILLING_CYCLES.includes(body.billing_cycle as (typeof VALID_BILLING_CYCLES)[number])) {
    return NextResponse.json(
      { status: "error", message: `billing_cycle must be one of: ${VALID_BILLING_CYCLES.join(", ")}` },
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
    const result = await createPlatformMembershipFee({
      vertical: body.vertical,
      role: body.role,
      amount: body.amount,
      billingCycle: body.billing_cycle as (typeof VALID_BILLING_CYCLES)[number],
      effectiveFrom: effectiveFrom.toISOString(),
      note: body.note?.trim() || null,
    });
    await writeAuditLog({
      actor: auth.actor,
      action: "billing.membership_fee.create",
      targetType: "platform_membership_fee",
      targetId: result.id,
      outcome: "success",
      detail: {
        vertical: body.vertical,
        role: body.role,
        amount: body.amount,
        billing_cycle: body.billing_cycle,
        effective_from: effectiveFrom.toISOString(),
        note: body.note?.trim() || null,
      },
      request,
    });
    return NextResponse.json({ status: "ok", id: result.id });
  } catch (err) {
    await writeAuditLog({
      actor: auth.actor,
      action: "billing.membership_fee.create",
      outcome: "error",
      detail: { vertical: body.vertical, role: body.role, error: err instanceof Error ? err.message : String(err) },
      request,
    });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not create fee." },
      { status: 500 }
    );
  }
}
