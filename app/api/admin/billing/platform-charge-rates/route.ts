import { NextResponse } from "next/server";
import { listPlatformChargeRates, createPlatformChargeRate } from "@/lib/billing/rate-card";

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
// No auth gate — same dev-phase-convenience posture as
// app/api/admin/sync-queue/*'s own header comments. Not for a production
// deployment with real money moving through it.
export async function GET(request: Request) {
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
    return NextResponse.json({ status: "ok", id: result.id });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Could not create rate." },
      { status: 500 }
    );
  }
}
