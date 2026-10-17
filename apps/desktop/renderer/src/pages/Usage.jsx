import React, { useEffect, useRef, useState } from "react";
import { Gauge, CreditCard, Clock, Plus, Users, Check, X, Sparkles } from "lucide-react";
import { api, toast, cx, ToolShell, Modal, useAccess } from "../core.jsx";

// Usage (0.7.22): the account's plan, this week's credits, extra credits, the free messages and the history; the plans
// and the credit packs; for the Owner, every account's plan. In English, like the credit messages.
const when = (ms) => ms ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(ms)) : "";
const lei = (n) => `${Number(n).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lei`;
const num = (n) => Number(n || 0).toLocaleString("en-GB");
const KIND = { chat: "Message", image: "Picture", video: "Video", transcribe: "Voice", plan: "Plan started", extra: "Credits added" };

// Everything Serasmart AI does, in the same order on every plan (0.7.25): what the plan includes has a tick (with its
// amount), what it does not is struck through, so the difference between the plans is easy to see.
const limit = (v, unit) => v === null || v === undefined ? "Unlimited" : v ? `${num(v)} ${unit}${v === 1 ? "" : "s"}` : false;
const PLAN_FEATURES = [
  ["Fast and advanced models", () => true],
  ["Top models (the strongest Claude, GPT, Gemini and Grok)", (p) => p.tiers.includes("top")],
  ["Web search with sources", () => true],
  ["Picture generation", () => true],
  ["HD pictures", (p) => !!p.imageHd],
  ["Video generation", (p) => p.videoSeconds ? `up to ${p.videoSeconds} s` : false],
  ["Deep Research", (p) => !!p.deepResearch],
  ["Compare models side by side", (p) => p.compare ? `${p.compare} at once` : false],
  ["Connected apps (Gmail, Drive, Notion, GitHub…)", (p) => limit(p.plugins, "app")],
  ["Skills", (p) => limit(p.skills, "skill")],
  ["Automations", (p) => limit(p.automations, "automation")],
  ["Memory, projects and file library", () => true],
  ["Word, Excel, PowerPoint and PDF files", () => true],
  ["Voice input", () => true],
  ["Answers keep going when the app is closed", () => true],
  ["Priority access at busy times", (p) => !!p.priority],
  ["Team admin with shared credits", (p) => !!p.team],
  ["API access", (p) => !!p.api]
];
function PlanCard({ plan, current, popular }) {
  return <article className={cx("planCard", current && "current", popular && "popular")} aria-label={`${plan.name} plan`}>
    {popular && !current && <span className="planBadge"><Sparkles size={12} /> Most popular</span>}
    {current && <span className="planBadge current"><Check size={12} /> Your plan</span>}
    <header>
      <h4>{plan.name}{plan.label && <small>{plan.label}</small>}</h4>
      <div className="planPrice"><b>{lei(plan.price)}</b><span>/ 30 days</span></div>
      <small className="planYearly">{lei(plan.yearly)} a year · 2 months free</small>
    </header>
    <div className="planCredits"><b>{num(plan.credits)}</b> credits<span>{num(plan.perWeek)} a week · {plan.seats > 1 ? `${plan.seats} people` : "1 person"}</span></div>
    <ul className="planFeatures">{PLAN_FEATURES.map(([label, get]) => {
      const v = get(plan);
      return <li key={label} className={v ? "on" : "off"}>{v ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}<span>{v ? label : <s>{label}</s>}{typeof v === "string" && <em>{v}</em>}</span><span className="sr">{v ? "included" : "not included"}</span></li>;
    })}</ul>
    <button className={current ? "planCta current" : "planCta"} disabled title={current ? "" : "Card payments open soon"}>{current ? "Current plan" : `Choose ${plan.name}`}</button>
  </article>;
}

function Meter({ percent }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return <div className={cx("usageMeter", p >= 90 && "high", p >= 100 && "full")} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={`${p}% of this week's credits used`}><span style={{ width: `${p}%` }} /></div>;
}

function PackCalculator({ min = 100 }) {
  const [credits, setCredits] = useState(1000), [price, setPrice] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!(credits >= min)) { setPrice(null); return; }
    let live = true;
    const t = setTimeout(() => api(`/api/credits/price?credits=${credits}`).then((d) => live && setPrice(d.price)).catch(() => live && setPrice(null)), 200);
    return () => { live = false; clearTimeout(t); };
  }, [credits, min]);
  async function buy() {
    setBusy(true);
    try { await api("/api/credits/buy", { method: "POST", body: JSON.stringify({ credits }) }); }
    catch (e) { toast(e.message, "info"); } finally { setBusy(false); }
  }
  return <div className="usagePack">
    <label>Extra credits<input type="number" min={min} step={100} value={credits} onChange={(e) => setCredits(Math.floor(Number(e.target.value) || 0))} /></label>
    <div className="usagePackPrice"><b>{price ? lei(price) : "—"}</b><small>{credits >= min ? "used at once, no weekly limit, valid 12 months" : `minimum ${min} credits`}</small></div>
    <button className="primary" disabled={busy || !price} onClick={buy}><CreditCard size={15} /> Buy</button>
  </div>;
}

function OwnerPanel({ plans }) {
  const [rows, setRows] = useState([]), [email, setEmail] = useState(""), [plan, setPlan] = useState("plus"), [billing, setBilling] = useState("monthly"), [extra, setExtra] = useState(100), [busy, setBusy] = useState(false);
  const load = () => api("/api/credits/accounts").then((d) => setRows(d.data || [])).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);
  async function run(path, body, ok) {
    if (!email.trim()) { toast("Write the account's email first.", "info"); return; }
    setBusy(true);
    try { await api(path, { method: "POST", body: JSON.stringify({ email: email.trim(), ...body }) }); toast(ok, "success"); load(); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  }
  return <section className="usageSection">
    <h3><Users size={17} /> Accounts (Owner)</h3>
    <p className="settingsHelp">Until card payments open, plans and extra credits are given from here. The account must have signed in at least once.</p>
    <div className="usageOwnerForm">
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="account email" aria-label="Account email" list="usageAccounts" />
      <datalist id="usageAccounts">{rows.filter((r) => !r.unlimited).map((r) => <option key={r.id} value={r.email} />)}</datalist>
      <select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan">{plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}<option value="none">No plan</option></select>
      <select value={billing} onChange={(e) => setBilling(e.target.value)} aria-label="Billing"><option value="monthly">30 days</option><option value="yearly">Yearly</option></select>
      <button className="secondary" disabled={busy} onClick={() => run("/api/credits/accounts/plan", { plan, billing }, plan === "none" ? "Plan removed." : "Plan started.")}>Set plan</button>
      <input type="number" min={1} value={extra} onChange={(e) => setExtra(Math.floor(Number(e.target.value) || 0))} aria-label="Extra credits" />
      <button className="secondary" disabled={busy} onClick={() => run("/api/credits/accounts/grant", { credits: extra }, "Credits added.")}><Plus size={14} /> Add credits</button>
    </div>
    <div className="usageTable" role="table" aria-label="Accounts">
      <div role="row" className="usageRow head"><span>Account</span><span>Plan</span><span>This week</span><span>Extra</span></div>
      {rows.map((r) => <div role="row" className="usageRow" key={r.id}>
        <span title={r.email}>{r.name || r.email}<small>{r.email}</small></span>
        <span>{r.unlimited ? "Unlimited" : r.plan ? `${r.plan.name}${r.plan.billing === "yearly" ? " · yearly" : ""}` : r.mode === "trial" ? "Trial" : "Free"}</span>
        <span>{r.unlimited ? "—" : r.week ? `${num(r.week.used)} / ${num(r.week.budget)}` : r.trial?.active ? `${num(r.trial.left)} left` : `${r.free.used}/${r.free.limit} free`}</span>
        <span>{r.unlimited ? "—" : num(r.extras)}</span>
      </div>)}
    </div>
  </section>;
}

export function UsagePage({ onClose }) {
  const { isOwner } = useAccess();
  const [d, setD] = useState(null), [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => { api("/api/credits?peek=1").then((x) => mounted.current && setD(x)).catch((e) => mounted.current && setError(e.message)); }, []);
  const cat = d?.catalog;
  return <ToolShell title="Usage" subtitle="Your plan, this week's credits and what each action costs." onClose={onClose} className="pageModal usagePage">
    <div className="pageBody">
      {error && <div className="emptyState small">{error}</div>}
      {!d && !error && <div className="emptyState small">Loading…</div>}
      {d && <>
        {!d.enabled && <p className="settingsHelp usageOff">Plans and credits are not turned on yet: every account works as before (the free tier and the Owner's rules).</p>}
        {d.enabled && d.unlimited && <p className="settingsHelp usageOff">Your account is not charged (Owner).</p>}
        {d.enabled && !d.unlimited && <section className="usageHero">
          <div className="usageHeroHead">
            <span className="taskIcon"><Gauge size={20} /></span>
            <div><b>{d.plan ? `${d.plan.name} plan` : d.mode === "trial" ? "Free trial" : "Free"}</b>
              <small>{d.plan ? (d.plan.renewsAt ? `Next credits: ${when(d.plan.renewsAt)}` : `Ends ${when(d.plan.endsAt)}`) : d.mode === "trial" ? `${num(d.trial.left)} of ${num(d.trial.credits)} credits · ends ${when(d.trial.endsAt)}` : `${d.free.left} of ${d.free.limit} free messages left today`}</small></div>
          </div>
          {d.week && <>
            <Meter percent={d.week.percent} />
            <div className="usageWeek"><span><b>{d.week.percent}%</b> of this week's credits used</span><span>{num(d.week.left)} left · week {d.week.tranche} of 4</span></div>
          </>}
          <div className="usageStats">
            <div><small>Available now</small><b>{num(d.available)}</b></div>
            <div><small>Extra credits</small><b>{num(d.extras)}</b></div>
            <div><small>Free messages today</small><b>{d.free.left}/{d.free.limit}</b></div>
          </div>
        </section>}
        {d.enabled && !d.unlimited && <section className="usageSection"><h3><CreditCard size={17} /> Buy extra credits</h3><PackCalculator min={cat.minPack} /></section>}
        <section className="usageSection">
          <h3>Plans</h3>
          <div className="planGrid">{cat.plans.map((p) => <PlanCard key={p.key} plan={p} current={d.plan?.key === p.key} popular={p.key === "pro"} />)}</div>
          <p className="settingsHelp">Without a plan: {cat.free.dailyMessages} messages a day on the free models, after a {cat.trial.days}-day trial with {num(cat.trial.credits)} credits. Card payments open soon; until then plans are given by the Owner.</p>
          <p className="settingsHelp">Credits come in four weekly parts (days 1, 8, 15 and 22); what you don't use moves to the next week. At 100% the paid models stop until the next part, or you buy extra credits; {cat.freeDaily.planExhausted} messages a day stay on the free models.</p>
        </section>
        <section className="usageSection">
          <h3>What things cost</h3>
          <div className="usageCosts">
            {[["Message, fast model", cat.costs.fast], ["Web search", `+${cat.costs.web}`], ["Message, advanced model", cat.costs.advanced], ["Picture", cat.costs.image], ["Message, top model", cat.costs.top], ["Picture HD", cat.costs.imageHd], ["Short video (~6 s)", `from ${cat.costs.videoBase}`], ["Voice to text", `${cat.costs.transcribeMinute} a minute`]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
          </div>
        </section>
        {d.enabled && !d.unlimited && d.history?.length > 0 && <section className="usageSection">
          <h3><Clock size={17} /> Recent</h3>
          <div className="usageTable history">{d.history.slice(0, 40).map((h, i) => <div className="usageRow" key={i}>
            <span>{KIND[h.kind] || h.kind}<small>{h.model || h.note || ""}</small></span><span>{new Date(h.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><span className={h.credits < 0 ? "plus" : ""}>{!h.credits ? "" : h.credits < 0 ? `+${num(-h.credits)}` : `−${num(h.credits)}`}</span>
          </div>)}</div>
        </section>}
        {isOwner && d.enabled && <OwnerPanel plans={cat.plans} />}
      </>}
    </div>
  </ToolShell>;
}

// The message at 100% (and when a plan feature is missing): buy credits now, or wait for the renewal.
export function CreditsDialog({ info, onBuy, onClose }) {
  const wait = info?.credits?.renewsAt ? `Wait until ${when(info.credits.renewsAt)}` : "Wait";
  return <Modal title={info.code === "plan_upgrade" ? "Not in your plan" : info.code === "free_limit" ? "Free messages used" : "Credits used up"} subtitle={info.message} className="modal creditsDialog" onClose={onClose}>
    <div className="formActions">
      <button className="secondary" onClick={onClose}>{info.code === "plan_upgrade" ? "Close" : wait}</button>
      <button className="primary" onClick={onBuy}>{info.code === "plan_upgrade" ? "See plans" : "Buy credits"}</button>
    </div>
  </Modal>;
}
