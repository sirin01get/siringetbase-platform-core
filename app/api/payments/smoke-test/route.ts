import { NextResponse } from "next/server";
import { getPaymentGateway, getBankPayout } from "@/lib/payments/registry";

// Exercises the active PaymentGatewayPort + BankPayoutPort end to end
// without touching Supabase — useful before the database is even wired up,
// to confirm the adapter registry and mock contract work. Same spirit as
// homeai's /api/ai/smoke-test: no auth gate, dev-phase convenience,
// protect or remove before anything resembling a public launch.
//
// POST with { "forceFail": true } to exercise the simulated-failure path
// instead of the happy path.
//
// GET is handled separately below purely so visiting this URL directly in a
// browser (which sends GET) gets a helpful explanation instead of
// Cloudflare's generic, unstyled 405 error page — cosmetic only, doesn't
// change what the endpoint actually requires.
export async function GET() {
  return NextResponse.json(
    {
      error: "This endpoint requires POST, not GET.",
      hint: "Visiting the URL directly in a browser sends a GET request — that's why you're seeing this instead of a result.",
      usage: {
        curl: 'curl -X POST <this-url> -H "Content-Type: application/json" -d "{}"',
        forceFailVariant: 'curl -X POST <this-url> -H "Content-Type: application/json" -d "{\\"forceFail\\": true}"',
        powershell:
          'Invoke-RestMethod -Uri "<this-url>" -Method Post -ContentType "application/json" -Body "{}"',
      },
    },
    { status: 405 }
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const forceFail = Boolean(body?.forceFail);
  const tag = forceFail ? "FORCE_FAIL" : "";

  const gateway = getPaymentGateway();
  const bankPayout = getBankPayout();

  const charge = await gateway.charge({
    amount: 1000,
    currency: "INR",
    roleProfileId: "smoke-test",
    vertical: "smoke-test",
    description: `Platform Core Phase 0 smoke test ${tag}`.trim(),
  });

  const payout = await bankPayout.disburse({
    amount: 900,
    currency: "INR",
    payoutAccountId: "smoke-test",
    accountNumberLast4: "1234",
    destination: { accountType: "in_ifsc", ifsc: "SMOK0000001" },
    accountHolderName: "Smoke Test",
    reference: `smoke-test ${tag}`.trim(),
  });

  return NextResponse.json({
    status: "ok",
    gateway: { provider: gateway.providerName, charge },
    bankPayout: { provider: bankPayout.providerName, payout },
  });
}
