"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import AdminGate from "@/components/admin/AdminGate";
import {
  Badge,
  Banner,
  buttonPrimary,
  Card,
  EmptyState,
  hintClass,
  inputClass,
  labelClass,
  PageHeader,
  SectionHeading,
  Spinner,
  td,
  th,
  trBody,
} from "@/components/admin/AdminUI";

interface ChargeRateRow {
  id: string;
  vertical: string;
  service_type_slug: string | null;
  rate: number;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  created_at: string;
}

interface MembershipFeeRow {
  id: string;
  vertical: string;
  role: string;
  amount: number;
  billing_cycle: "monthly" | "quarterly" | "annual";
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  created_at: string;
}

interface SubscriptionPlanRow {
  id: string;
  vertical: string;
  service_type_slug: string;
  tier: string;
  amount: number;
  included_usage_quota: number | null;
  overage_unit_rate: number | null;
  usage_unit_label: string | null;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  created_at: string;
}

// Status computed client-side, purely for display — the API returns raw
// history, "which one is live right now" is a presentation question, not a
// query the backend needs to answer specially.
function rowStatus(effectiveFrom: string, effectiveTo: string | null): "scheduled" | "current" | "expired" {
  const now = Date.now();
  const from = new Date(effectiveFrom).getTime();
  const to = effectiveTo ? new Date(effectiveTo).getTime() : null;
  if (from > now) return "scheduled";
  if (to !== null && to <= now) return "expired";
  return "current";
}

const statusTone: Record<"current" | "scheduled" | "expired", "green" | "amber" | "slate"> = {
  current: "green",
  scheduled: "amber",
  expired: "slate",
};

// Billing rate card control plane — ../../billing/README.md,
// ../../supabase/migrations/0008_billing_rate_cards.sql. Lets an admin
// schedule a "Platform charges" rate (percentage, deducted at payout) or a
// "platform membership fee" (fixed, recurring) to take effect immediately
// or on a future date, without touching whatever's live today — the
// previous open-ended row for the same scope is closed out automatically
// (src/lib/billing/rate-card.ts's createPlatformChargeRate()/
// createPlatformMembershipFee()).
//
// business_admin only (the owner's own naming — see README.md "Access
// control") — this manages a real rate now, deducted from every CA's
// payout across every vertical, so every create here is audit-logged with
// the full rate/fee detail (see the two API routes this page calls).
// Tailwind-styled via src/components/admin/AdminUI.tsx, matching this
// app's other /admin/* pages.
export default function BillingAdminPage() {
  return (
    <AdminGate allowedRoles={["business_admin"]}>
      {() => <BillingAdminPageInner />}
    </AdminGate>
  );
}

function BillingAdminPageInner() {
  const [chargeRates, setChargeRates] = useState<ChargeRateRow[]>([]);
  const [membershipFees, setMembershipFees] = useState<MembershipFeeRow[]>([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [planVertical, setPlanVertical] = useState("cafocus");
  const [planServiceType, setPlanServiceType] = useState("");
  const [planTier, setPlanTier] = useState("basic");
  const [planAmount, setPlanAmount] = useState("");
  const [planQuota, setPlanQuota] = useState("");
  const [planOverageRate, setPlanOverageRate] = useState("");
  const [planUsageUnitLabel, setPlanUsageUnitLabel] = useState("");
  const [planEffectiveFrom, setPlanEffectiveFrom] = useState("");
  const [planNote, setPlanNote] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);

  const [rateVertical, setRateVertical] = useState("cafocus");
  const [rateServiceType, setRateServiceType] = useState("");
  const [ratePercent, setRatePercent] = useState("10");
  const [rateEffectiveFrom, setRateEffectiveFrom] = useState("");
  const [rateNote, setRateNote] = useState("");
  const [savingRate, setSavingRate] = useState(false);

  const [feeVertical, setFeeVertical] = useState("cafocus");
  const [feeRole, setFeeRole] = useState("ca");
  const [feeAmount, setFeeAmount] = useState("");
  const [feeCycle, setFeeCycle] = useState<"monthly" | "quarterly" | "annual">("monthly");
  const [feeEffectiveFrom, setFeeEffectiveFrom] = useState("");
  const [feeNote, setFeeNote] = useState("");
  const [savingFee, setSavingFee] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [rateRes, feeRes, planRes] = await Promise.all([
      fetch("/api/admin/billing/platform-charge-rates"),
      fetch("/api/admin/billing/platform-membership-fees"),
      fetch("/api/admin/billing/module-subscription-plans"),
    ]);
    const rateBody = (await rateRes.json().catch(() => ({}))) as {
      status: string;
      rows?: ChargeRateRow[];
      message?: string;
    };
    const feeBody = (await feeRes.json().catch(() => ({}))) as {
      status: string;
      rows?: MembershipFeeRow[];
      message?: string;
    };
    const planBody = (await planRes.json().catch(() => ({}))) as {
      status: string;
      rows?: SubscriptionPlanRow[];
      message?: string;
    };
    if (rateBody.status !== "ok") {
      setError(rateBody.message ?? "Failed to load platform charge rates.");
    }
    setChargeRates(rateBody.rows ?? []);
    setMembershipFees(feeBody.rows ?? []);
    setSubscriptionPlans(planBody.rows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createRate(e: FormEvent) {
    e.preventDefault();
    setSavingRate(true);
    setError(null);
    setInfo(null);

    const res = await fetch("/api/admin/billing/platform-charge-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vertical: rateVertical,
        service_type_slug: rateServiceType || null,
        rate: Number(ratePercent) / 100,
        effective_from: rateEffectiveFrom || new Date().toISOString(),
        note: rateNote,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { status: string; message?: string };
    if (body.status !== "ok") {
      setError(body.message ?? "Could not save rate.");
    } else {
      setInfo("Platform charge rate saved.");
      setRateNote("");
    }
    setSavingRate(false);
    await load();
  }

  async function createFee(e: FormEvent) {
    e.preventDefault();
    setSavingFee(true);
    setError(null);
    setInfo(null);

    const res = await fetch("/api/admin/billing/platform-membership-fees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vertical: feeVertical,
        role: feeRole,
        amount: Number(feeAmount),
        billing_cycle: feeCycle,
        effective_from: feeEffectiveFrom || new Date().toISOString(),
        note: feeNote,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { status: string; message?: string };
    if (body.status !== "ok") {
      setError(body.message ?? "Could not save fee.");
    } else {
      setInfo("Platform membership fee saved.");
      setFeeAmount("");
      setFeeNote("");
    }
    setSavingFee(false);
    await load();
  }

  async function createPlan(e: FormEvent) {
    e.preventDefault();
    setSavingPlan(true);
    setError(null);
    setInfo(null);

    const res = await fetch("/api/admin/billing/module-subscription-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vertical: planVertical,
        service_type_slug: planServiceType,
        tier: planTier,
        amount: Number(planAmount),
        included_usage_quota: planQuota ? Number(planQuota) : null,
        overage_unit_rate: planOverageRate ? Number(planOverageRate) : null,
        usage_unit_label: planUsageUnitLabel || null,
        effective_from: planEffectiveFrom || new Date().toISOString(),
        note: planNote,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { status: string; message?: string };
    if (body.status !== "ok") {
      setError(body.message ?? "Could not save plan.");
    } else {
      setInfo("Module subscription plan saved.");
      setPlanAmount("");
      setPlanQuota("");
      setPlanOverageRate("");
      setPlanUsageUnitLabel("");
      setPlanNote("");
    }
    setSavingPlan(false);
    await load();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Billing — rate card"
        description={
          <>
            Manage <strong className="font-semibold text-slate-700">platform charges</strong> (the percentage taken
            at payout) and the <strong className="font-semibold text-slate-700">platform membership fee</strong> (a
            fixed, recurring platform-access fee) for every vertical. Changes can be scheduled for a future date —
            the previously-open rate for the same scope is closed out automatically the moment a new one is saved.
          </>
        }
      />

      {error && <Banner tone="red" className="mb-5">{error}</Banner>}
      {info && <Banner tone="green" className="mb-5">{info}</Banner>}

      <section className="mb-10">
        <SectionHeading className="mb-3">Platform charges</SectionHeading>
        <Card className="mb-5 p-5">
          <form onSubmit={(e) => void createRate(e)} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelClass}>
              Vertical
              <input value={rateVertical} onChange={(e) => setRateVertical(e.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <label className={labelClass}>
              Service type <span className={hintClass}>(optional — blank applies to all)</span>
              <input
                value={rateServiceType}
                onChange={(e) => setRateServiceType(e.target.value)}
                placeholder="e.g. gst-filing"
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className={labelClass}>
              Rate (%)
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={ratePercent}
                onChange={(e) => setRatePercent(e.target.value)}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className={labelClass}>
              Effective from <span className={hintClass}>(blank = now)</span>
              <input
                type="datetime-local"
                value={rateEffectiveFrom}
                onChange={(e) => setRateEffectiveFrom(e.target.value)}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className={labelClass}>
              Note
              <input value={rateNote} onChange={(e) => setRateNote(e.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={savingRate} className={buttonPrimary}>
                {savingRate ? (
                  <span className="flex items-center gap-2">
                    <Spinner /> Saving…
                  </span>
                ) : (
                  "Schedule rate"
                )}
              </button>
            </div>
          </form>
        </Card>

        {loading ? (
          <EmptyState>Loading…</EmptyState>
        ) : chargeRates.length === 0 ? (
          <EmptyState>No platform charge rates set yet — payouts fall back to a hardcoded default until one exists.</EmptyState>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className={th}>Vertical</th>
                    <th className={th}>Service type</th>
                    <th className={th}>Rate</th>
                    <th className={th}>Effective from</th>
                    <th className={th}>Effective to</th>
                    <th className={th}>Status</th>
                    <th className={th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {chargeRates.map((r) => {
                    const status = rowStatus(r.effective_from, r.effective_to);
                    return (
                      <tr key={r.id} className={trBody}>
                        <td className={td}>{r.vertical}</td>
                        <td className={td}>{r.service_type_slug ?? "all"}</td>
                        <td className={`${td} font-medium text-slate-900`}>{(r.rate * 100).toFixed(2)}%</td>
                        <td className={`${td} whitespace-nowrap text-slate-500`}>{new Date(r.effective_from).toLocaleString()}</td>
                        <td className={`${td} whitespace-nowrap text-slate-500`}>
                          {r.effective_to ? new Date(r.effective_to).toLocaleString() : "open"}
                        </td>
                        <td className={td}>
                          <Badge tone={statusTone[status]}>{status}</Badge>
                        </td>
                        <td className={`${td} text-slate-500`}>{r.note ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      <section className="mb-10">
        <SectionHeading className="mb-3">Platform membership fee</SectionHeading>
        <Card className="mb-5 p-5">
          <form onSubmit={(e) => void createFee(e)} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelClass}>
              Vertical
              <input value={feeVertical} onChange={(e) => setFeeVertical(e.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <label className={labelClass}>
              Role
              <input value={feeRole} onChange={(e) => setFeeRole(e.target.value)} placeholder="e.g. ca" className={`${inputClass} mt-1.5`} />
            </label>
            <label className={labelClass}>
              Amount (INR)
              <input
                type="number"
                min="0"
                step="0.01"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className={labelClass}>
              Billing cycle
              <select
                value={feeCycle}
                onChange={(e) => setFeeCycle(e.target.value as typeof feeCycle)}
                className={`${inputClass} mt-1.5`}
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label className={labelClass}>
              Effective from <span className={hintClass}>(blank = now)</span>
              <input
                type="datetime-local"
                value={feeEffectiveFrom}
                onChange={(e) => setFeeEffectiveFrom(e.target.value)}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className={labelClass}>
              Note
              <input value={feeNote} onChange={(e) => setFeeNote(e.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={savingFee} className={buttonPrimary}>
                {savingFee ? (
                  <span className="flex items-center gap-2">
                    <Spinner /> Saving…
                  </span>
                ) : (
                  "Schedule fee"
                )}
              </button>
            </div>
          </form>
        </Card>

        {!loading && membershipFees.length === 0 ? (
          <EmptyState>No platform membership fees set yet — none are being collected regardless, see the note above.</EmptyState>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className={th}>Vertical</th>
                    <th className={th}>Role</th>
                    <th className={th}>Amount</th>
                    <th className={th}>Cycle</th>
                    <th className={th}>Effective from</th>
                    <th className={th}>Effective to</th>
                    <th className={th}>Status</th>
                    <th className={th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {membershipFees.map((f) => {
                    const status = rowStatus(f.effective_from, f.effective_to);
                    return (
                      <tr key={f.id} className={trBody}>
                        <td className={td}>{f.vertical}</td>
                        <td className={td}>{f.role}</td>
                        <td className={`${td} font-medium text-slate-900`}>₹{f.amount}</td>
                        <td className={td}>{f.billing_cycle}</td>
                        <td className={`${td} whitespace-nowrap text-slate-500`}>{new Date(f.effective_from).toLocaleString()}</td>
                        <td className={`${td} whitespace-nowrap text-slate-500`}>
                          {f.effective_to ? new Date(f.effective_to).toLocaleString() : "open"}
                        </td>
                        <td className={td}>
                          <Badge tone={statusTone[status]}>{status}</Badge>
                        </td>
                        <td className={`${td} text-slate-500`}>{f.note ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      <section>
        <SectionHeading
          className="mb-3"
          subtitle={
            <>
              Recurring, per-module tiers for subscription-monetized service types (e.g. cafocus&apos;s Client
              management / Document storage / Automated reminders — see that vertical&apos;s{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]">service_types.monetization_model</code>
              ). A CA subscribing to a released module picks one of these tiers;{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]">included_usage_quota</code> +{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]">overage_unit_rate</code> are optional
              and only matter for a module that meters usage — leave both blank for a flat monthly fee.
            </>
          }
        >
          Module subscription plans
        </SectionHeading>
        <Card className="mb-5 mt-3 p-5">
          <form onSubmit={(e) => void createPlan(e)} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className={labelClass}>
              Vertical
              <input value={planVertical} onChange={(e) => setPlanVertical(e.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <label className={labelClass}>
              Service type
              <input
                value={planServiceType}
                onChange={(e) => setPlanServiceType(e.target.value)}
                placeholder="e.g. document-storage"
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className={labelClass}>
              Tier
              <input value={planTier} onChange={(e) => setPlanTier(e.target.value)} placeholder="e.g. basic" className={`${inputClass} mt-1.5`} />
            </label>
            <label className={labelClass}>
              Amount / month (INR)
              <input
                type="number"
                min="0"
                step="0.01"
                value={planAmount}
                onChange={(e) => setPlanAmount(e.target.value)}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className={labelClass}>
              Included usage quota <span className={hintClass}>(optional)</span>
              <input
                type="number"
                min="0"
                value={planQuota}
                onChange={(e) => setPlanQuota(e.target.value)}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className={labelClass}>
              Overage rate/unit <span className={hintClass}>(optional, cost-plus above quota)</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={planOverageRate}
                onChange={(e) => setPlanOverageRate(e.target.value)}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className={labelClass}>
              Usage unit label <span className={hintClass}>(optional, e.g. &quot;client&quot;)</span>
              <input
                value={planUsageUnitLabel}
                onChange={(e) => setPlanUsageUnitLabel(e.target.value)}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className={labelClass}>
              Effective from <span className={hintClass}>(blank = now)</span>
              <input
                type="datetime-local"
                value={planEffectiveFrom}
                onChange={(e) => setPlanEffectiveFrom(e.target.value)}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <label className={labelClass}>
              Note
              <input value={planNote} onChange={(e) => setPlanNote(e.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={savingPlan} className={buttonPrimary}>
                {savingPlan ? (
                  <span className="flex items-center gap-2">
                    <Spinner /> Saving…
                  </span>
                ) : (
                  "Schedule plan"
                )}
              </button>
            </div>
          </form>
        </Card>

        {!loading && subscriptionPlans.length === 0 ? (
          <EmptyState>No module subscription plans set yet — nothing is releasable for CAs to subscribe to until one exists.</EmptyState>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className={th}>Vertical</th>
                    <th className={th}>Service type</th>
                    <th className={th}>Tier</th>
                    <th className={th}>Amount/mo</th>
                    <th className={th}>Quota</th>
                    <th className={th}>Overage rate</th>
                    <th className={th}>Effective from</th>
                    <th className={th}>Effective to</th>
                    <th className={th}>Status</th>
                    <th className={th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptionPlans.map((p) => {
                    const status = rowStatus(p.effective_from, p.effective_to);
                    return (
                      <tr key={p.id} className={trBody}>
                        <td className={td}>{p.vertical}</td>
                        <td className={td}>{p.service_type_slug}</td>
                        <td className={td}>{p.tier}</td>
                        <td className={`${td} font-medium text-slate-900`}>₹{p.amount}</td>
                        <td className={td}>
                          {p.included_usage_quota ?? "—"}
                          {p.usage_unit_label ? ` ${p.usage_unit_label}` : ""}
                        </td>
                        <td className={td}>{p.overage_unit_rate != null ? `₹${p.overage_unit_rate}` : "—"}</td>
                        <td className={`${td} whitespace-nowrap text-slate-500`}>{new Date(p.effective_from).toLocaleString()}</td>
                        <td className={`${td} whitespace-nowrap text-slate-500`}>
                          {p.effective_to ? new Date(p.effective_to).toLocaleString() : "open"}
                        </td>
                        <td className={td}>
                          <Badge tone={statusTone[status]}>{status}</Badge>
                        </td>
                        <td className={`${td} text-slate-500`}>{p.note ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </main>
  );
}
