"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import AdminGate from "@/components/admin/AdminGate";

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

const statusColor: Record<string, string> = { current: "#0a7", scheduled: "#c80", expired: "#999" };

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
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 960 }}>
      <h1>Billing — rate card</h1>
      <p>
        Manage <strong>Platform charges</strong> (the percentage taken at payout) and the{" "}
        <strong>platform membership fee</strong> (a fixed, recurring platform-access fee) for every vertical.
        Changes can be scheduled for a future date — the previously-open rate for the same scope is closed out
        automatically the moment a new one is saved.
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {info && <p style={{ color: "seagreen" }}>{info}</p>}

      <h2>Platform charges</h2>
      <form onSubmit={(e) => void createRate(e)} style={formStyle}>
        <label>
          Vertical
          <input value={rateVertical} onChange={(e) => setRateVertical(e.target.value)} style={inputStyle} />
        </label>
        <label>
          Service type <span style={{ fontWeight: 400, color: "#666" }}>(optional — blank applies to all)</span>
          <input
            value={rateServiceType}
            onChange={(e) => setRateServiceType(e.target.value)}
            placeholder="e.g. gst-filing"
            style={inputStyle}
          />
        </label>
        <label>
          Rate (%)
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={ratePercent}
            onChange={(e) => setRatePercent(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          Effective from <span style={{ fontWeight: 400, color: "#666" }}>(blank = now)</span>
          <input
            type="datetime-local"
            value={rateEffectiveFrom}
            onChange={(e) => setRateEffectiveFrom(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          Note
          <input value={rateNote} onChange={(e) => setRateNote(e.target.value)} style={inputStyle} />
        </label>
        <button type="submit" disabled={savingRate}>
          {savingRate ? "Saving…" : "Schedule rate"}
        </button>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : chargeRates.length === 0 ? (
        <p>No platform charge rates set yet — payouts fall back to a hardcoded default until one exists.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Vertical</th>
              <th style={cellStyle}>Service type</th>
              <th style={cellStyle}>Rate</th>
              <th style={cellStyle}>Effective from</th>
              <th style={cellStyle}>Effective to</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Note</th>
            </tr>
          </thead>
          <tbody>
            {chargeRates.map((r) => {
              const status = rowStatus(r.effective_from, r.effective_to);
              return (
                <tr key={r.id}>
                  <td style={cellStyle}>{r.vertical}</td>
                  <td style={cellStyle}>{r.service_type_slug ?? "all"}</td>
                  <td style={cellStyle}>{(r.rate * 100).toFixed(2)}%</td>
                  <td style={cellStyle}>{new Date(r.effective_from).toLocaleString()}</td>
                  <td style={cellStyle}>{r.effective_to ? new Date(r.effective_to).toLocaleString() : "open"}</td>
                  <td style={{ ...cellStyle, color: statusColor[status], fontWeight: 600 }}>{status}</td>
                  <td style={cellStyle}>{r.note ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: "2.5rem" }}>Platform membership fee</h2>
      <form onSubmit={(e) => void createFee(e)} style={formStyle}>
        <label>
          Vertical
          <input value={feeVertical} onChange={(e) => setFeeVertical(e.target.value)} style={inputStyle} />
        </label>
        <label>
          Role
          <input value={feeRole} onChange={(e) => setFeeRole(e.target.value)} placeholder="e.g. ca" style={inputStyle} />
        </label>
        <label>
          Amount (INR)
          <input
            type="number"
            min="0"
            step="0.01"
            value={feeAmount}
            onChange={(e) => setFeeAmount(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          Billing cycle
          <select value={feeCycle} onChange={(e) => setFeeCycle(e.target.value as typeof feeCycle)} style={inputStyle}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
        </label>
        <label>
          Effective from <span style={{ fontWeight: 400, color: "#666" }}>(blank = now)</span>
          <input
            type="datetime-local"
            value={feeEffectiveFrom}
            onChange={(e) => setFeeEffectiveFrom(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          Note
          <input value={feeNote} onChange={(e) => setFeeNote(e.target.value)} style={inputStyle} />
        </label>
        <button type="submit" disabled={savingFee}>
          {savingFee ? "Saving…" : "Schedule fee"}
        </button>
      </form>

      {!loading && membershipFees.length === 0 ? (
        <p>No platform membership fees set yet — none are being collected regardless, see the note above.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Vertical</th>
              <th style={cellStyle}>Role</th>
              <th style={cellStyle}>Amount</th>
              <th style={cellStyle}>Cycle</th>
              <th style={cellStyle}>Effective from</th>
              <th style={cellStyle}>Effective to</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Note</th>
            </tr>
          </thead>
          <tbody>
            {membershipFees.map((f) => {
              const status = rowStatus(f.effective_from, f.effective_to);
              return (
                <tr key={f.id}>
                  <td style={cellStyle}>{f.vertical}</td>
                  <td style={cellStyle}>{f.role}</td>
                  <td style={cellStyle}>₹{f.amount}</td>
                  <td style={cellStyle}>{f.billing_cycle}</td>
                  <td style={cellStyle}>{new Date(f.effective_from).toLocaleString()}</td>
                  <td style={cellStyle}>{f.effective_to ? new Date(f.effective_to).toLocaleString() : "open"}</td>
                  <td style={{ ...cellStyle, color: statusColor[status], fontWeight: 600 }}>{status}</td>
                  <td style={cellStyle}>{f.note ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: "2.5rem" }}>Module subscription plans</h2>
      <p>
        Recurring, per-module tiers for subscription-monetized service types (e.g. cafocus&apos;s Client management /
        Document storage / Automated reminders — see that vertical&apos;s <code>service_types.monetization_model</code>).
        A CA subscribing to a released module picks one of these tiers; <code>included_usage_quota</code> +{" "}
        <code>overage_unit_rate</code> are optional and only matter for a module that meters usage — leave both blank
        for a flat monthly fee.
      </p>
      <form onSubmit={(e) => void createPlan(e)} style={formStyle}>
        <label>
          Vertical
          <input value={planVertical} onChange={(e) => setPlanVertical(e.target.value)} style={inputStyle} />
        </label>
        <label>
          Service type
          <input
            value={planServiceType}
            onChange={(e) => setPlanServiceType(e.target.value)}
            placeholder="e.g. document-storage"
            style={inputStyle}
          />
        </label>
        <label>
          Tier
          <input value={planTier} onChange={(e) => setPlanTier(e.target.value)} placeholder="e.g. basic" style={inputStyle} />
        </label>
        <label>
          Amount / month (INR)
          <input
            type="number"
            min="0"
            step="0.01"
            value={planAmount}
            onChange={(e) => setPlanAmount(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          Included usage quota <span style={{ fontWeight: 400, color: "#666" }}>(optional)</span>
          <input type="number" min="0" value={planQuota} onChange={(e) => setPlanQuota(e.target.value)} style={inputStyle} />
        </label>
        <label>
          Overage rate/unit <span style={{ fontWeight: 400, color: "#666" }}>(optional, cost-plus above quota)</span>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={planOverageRate}
            onChange={(e) => setPlanOverageRate(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          Usage unit label <span style={{ fontWeight: 400, color: "#666" }}>(optional, e.g. &quot;client&quot;)</span>
          <input value={planUsageUnitLabel} onChange={(e) => setPlanUsageUnitLabel(e.target.value)} style={inputStyle} />
        </label>
        <label>
          Effective from <span style={{ fontWeight: 400, color: "#666" }}>(blank = now)</span>
          <input
            type="datetime-local"
            value={planEffectiveFrom}
            onChange={(e) => setPlanEffectiveFrom(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          Note
          <input value={planNote} onChange={(e) => setPlanNote(e.target.value)} style={inputStyle} />
        </label>
        <button type="submit" disabled={savingPlan}>
          {savingPlan ? "Saving…" : "Schedule plan"}
        </button>
      </form>

      {!loading && subscriptionPlans.length === 0 ? (
        <p>No module subscription plans set yet — nothing is releasable for CAs to subscribe to until one exists.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Vertical</th>
              <th style={cellStyle}>Service type</th>
              <th style={cellStyle}>Tier</th>
              <th style={cellStyle}>Amount/mo</th>
              <th style={cellStyle}>Quota</th>
              <th style={cellStyle}>Overage rate</th>
              <th style={cellStyle}>Effective from</th>
              <th style={cellStyle}>Effective to</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Note</th>
            </tr>
          </thead>
          <tbody>
            {subscriptionPlans.map((p) => {
              const status = rowStatus(p.effective_from, p.effective_to);
              return (
                <tr key={p.id}>
                  <td style={cellStyle}>{p.vertical}</td>
                  <td style={cellStyle}>{p.service_type_slug}</td>
                  <td style={cellStyle}>{p.tier}</td>
                  <td style={cellStyle}>₹{p.amount}</td>
                  <td style={cellStyle}>{p.included_usage_quota ?? "—"}{p.usage_unit_label ? ` ${p.usage_unit_label}` : ""}</td>
                  <td style={cellStyle}>{p.overage_unit_rate != null ? `₹${p.overage_unit_rate}` : "—"}</td>
                  <td style={cellStyle}>{new Date(p.effective_from).toLocaleString()}</td>
                  <td style={cellStyle}>{p.effective_to ? new Date(p.effective_to).toLocaleString() : "open"}</td>
                  <td style={{ ...cellStyle, color: statusColor[status], fontWeight: 600 }}>{status}</td>
                  <td style={cellStyle}>{p.note ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}

const formStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "0.75rem",
  alignItems: "end",
  margin: "1rem 0 1.5rem",
  padding: "1rem",
  border: "1px solid #ddd",
  borderRadius: 8,
};
const inputStyle: CSSProperties = { display: "block", width: "100%", padding: "0.4rem", marginTop: "0.25rem" };
const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" };
const cellStyle: CSSProperties = { border: "1px solid #ddd", padding: "0.4rem", textAlign: "left" };
