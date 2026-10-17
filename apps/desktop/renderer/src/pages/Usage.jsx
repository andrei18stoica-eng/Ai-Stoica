import React, { useEffect, useRef, useState } from "react";
import { Gauge, CreditCard, Clock, Plus, Users, Check, X, Sparkles } from "lucide-react";
import { api, toast, cx, ToolShell, Modal, useAccess } from "../core.jsx";
import { t as tr, useLanguage, getLanguage } from "../i18n.jsx";

// Usage (0.7.22): the account's plan, this week's credits, extra credits, the free messages and the history; the plans
// and the credit packs; for the Owner, every account's plan. In English, like the credit messages.
const when = (ms) => ms ? new Intl.DateTimeFormat(getLanguage(), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(ms)) : "";
const lei = (n) => `${Number(n).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lei`;
const num = (n) => Number(n || 0).toLocaleString(getLanguage() === "en" ? "en-GB" : getLanguage());
const day = (ms) => new Intl.DateTimeFormat(getLanguage(), { day: "numeric", month: "short" }).format(new Date(ms));
const WEEK_MS = 7 * 86400000, PERIOD_MS = 30 * 86400000;
const KIND = { chat: "Message", image: "Picture", video: "Video", transcribe: "Voice", plan: "Plan started", extra: "Credits added" };

// Everything Serasmart AI does, in the same order on every plan (0.7.25): what the plan includes has a tick (with its
// amount), what it does not is struck through, so the difference between the plans is easy to see.
const limit = (v, unit) => v === null || v === undefined ? tr("Unlimited") : v ? tr(v === 1 ? `1 ${unit}` : `{n} ${unit}s`, { n: num(v) }) : false;
const PLAN_FEATURES = [
  ["Fast and advanced models", () => true],
  ["Top models (the strongest Claude, GPT, Gemini and Grok)", (p) => p.tiers.includes("top")],
  ["Web search with sources", () => true],
  ["Picture generation", (p) => p.imagesPerDay ? tr("{n} a day", { n: p.imagesPerDay }) : true],
  ["HD pictures", (p) => !!p.imageHd],
  ["Video generation", (p) => p.videoSeconds ? tr("up to {s} s", { s: p.videoSeconds }) : false],
  ["Deep Research", (p) => !!p.deepResearch],
  ["Compare models side by side", (p) => p.compare ? tr("{n} at once", { n: p.compare }) : false],
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
  return <article className={cx("planCard", current && "current", popular && "popular")} aria-label={tr("{plan} plan", { plan: plan.name })}>
    {popular && !current && <span className="planBadge"><Sparkles size={12} /> {tr("Most popular")}</span>}
    {current && <span className="planBadge current"><Check size={12} /> {tr("Your plan")}</span>}
    <header>
      <h4>{plan.name}{plan.label && <small>{plan.label}</small>}</h4>
      <div className="planPrice"><b>{lei(plan.price)}</b><span>{tr("/ 30 days")}</span></div>
      <small className="planYearly">{tr("{price} a year · 2 months free", { price: lei(plan.yearly) })}</small>
    </header>
    <div className="planCredits"><b>{num(plan.credits)}</b> {tr("credits")}<span>{tr("{n} a week", { n: num(plan.perWeek) })} · {plan.seats > 1 ? tr("{n} people", { n: plan.seats }) : tr("1 person")}</span></div>
    <ul className="planFeatures">{PLAN_FEATURES.map(([label, get]) => {
      const v = get(plan);
      return <li key={label} className={v ? "on" : "off"}>{v ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}<span>{v ? tr(label) : <s>{tr(label)}</s>}{typeof v === "string" && <em>{v}</em>}</span><span className="sr">{v ? tr("included") : tr("not included")}</span></li>;
    })}</ul>
    <button className={current ? "planCta current" : "planCta"} disabled title={current ? "" : tr("Card payments open soon")}>{current ? tr("Current plan") : tr("Choose {plan}", { plan: plan.name })}</button>
  </article>;
}

// The four parts of the current 30-day period, each 7 days after the day the plan started (0.7.27).
function WeekParts({ periodEndsAt, current }) {
  const start = periodEndsAt - PERIOD_MS;
  return <div className="weekParts" aria-label={tr("This period's credit parts")}>{[0, 1, 2, 3].map((i) => <span key={i} className={cx(i + 1 < current && "done", i + 1 === current && "now")}><b>{tr("Part {n}", { n: i + 1 })}</b>{day(start + i * WEEK_MS)}</span>)}</div>;
}
function Meter({ percent }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return <div className={cx("usageMeter", p >= 90 && "high", p >= 100 && "full")} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={tr("{p}% of this week's credits used", { p })}><span style={{ width: `${p}%` }} /></div>;
}

// Extra credits (0.7.26): a card next to the plans where the person writes how many credits they want; the price
// (x,99 lei, from lib/credits.cjs priceForCredits) follows the number as it is typed.
const PACK_PRESETS = [500, 1000, 2500, 5000, 10000];
const PACK_MAX = 1000000;
const EXTRA_FEATURES = ["Any number of credits you choose", "Used at once, no weekly limit", "Valid 12 months", "Added on top of any plan, or without one", "Every model and tool your plan allows"];
function ExtraCreditsCard({ min = 100 }) {
  useLanguage();
  const [credits, setCredits] = useState(1000), [price, setPrice] = useState(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const valid = credits >= min && credits <= PACK_MAX;
  useEffect(() => {
    if (!valid) { setPrice(null); return; }
    let live = true; setLoading(true);
    const t = setTimeout(() => api(`/api/credits/price?credits=${credits}`).then((d) => live && setPrice(d.price)).catch(() => live && setPrice(null)).finally(() => live && setLoading(false)), 200);
    return () => { live = false; clearTimeout(t); };
  }, [credits, valid]);
  async function buy() {
    setBusy(true);
    try { await api("/api/credits/buy", { method: "POST", body: JSON.stringify({ credits }) }); }
    catch (e) { toast(e.message, "info"); } finally { setBusy(false); }
  }
  return <article className="planCard extraCard" aria-label={tr("Extra credits")}>
    <span className="planBadge extra"><Plus size={12} /> {tr("Top up")}</span>
    <header>
      <h4>{tr("Extra credits")}</h4>
      <div className="planPrice" aria-live="polite"><b>{valid && price ? lei(price) : "—"}</b><span>{valid ? tr("once") : ""}</span></div>
      <small className="planYearly">{valid && price ? tr("for {n} credits · paid once", { n: num(credits) }) : credits > PACK_MAX ? tr("at most {n} credits", { n: num(PACK_MAX) }) : tr("minimum {n} credits", { n: num(min) })}</small>
    </header>
    <label className="extraInput"><span>{tr("How many credits?")}</span>
      <input type="number" inputMode="numeric" min={min} max={PACK_MAX} step={100} value={credits || ""} placeholder={String(min)} onChange={(e) => setCredits(Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-describedby="extraHint" />
    </label>
    <div className="extraPresets" role="group" aria-label={tr("Quick amounts")}>{PACK_PRESETS.map((n) => <button key={n} type="button" className={cx(credits === n && "on")} aria-pressed={credits === n} onClick={() => setCredits(n)}>{num(n)}</button>)}</div>
    <ul className="planFeatures">{EXTRA_FEATURES.map((f) => <li key={f} className="on"><Check size={14} aria-hidden="true" /><span>{tr(f)}</span></li>)}</ul>
    <small id="extraHint" className="extraHint">{loading ? tr("Working out the price…") : tr("The price changes with the number of credits.")}</small>
    <button className="planCta extraCta" disabled={busy || !valid || !price} onClick={buy}><CreditCard size={15} /> {valid && price ? tr("Buy for {price}", { price: lei(price) }) : tr("Buy credits")}</button>
  </article>;
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
  useLanguage();
  const { isOwner } = useAccess();
  const [d, setD] = useState(null), [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => { api("/api/credits?peek=1").then((x) => mounted.current && setD(x)).catch((e) => mounted.current && setError(e.message)); }, []);
  const cat = d?.catalog;
  return <ToolShell title={tr("Usage")} subtitle={tr("Your plan, this week's credits and extra credits.")} onClose={onClose} className="pageModal usagePage">
    <div className="pageBody">
      {error && <div className="emptyState small">{error}</div>}
      {!d && !error && <div className="emptyState small">{tr("Loading…")}</div>}
      {d && <>
        {!d.enabled && <p className="settingsHelp usageOff">{tr("Plans and credits are not turned on yet: every account works as before (the free tier and the Owner's rules).")}</p>}
        {d.enabled && d.unlimited && <p className="settingsHelp usageOff">{tr("Your account is not charged (Owner).")}</p>}
        {d.enabled && !d.unlimited && <section className="usageHero">
          <div className="usageHeroHead">
            <span className="taskIcon"><Gauge size={20} /></span>
            <div><b>{d.plan ? tr("{plan} plan", { plan: d.plan.name }) : d.mode === "trial" ? tr("Free trial") : tr("Free")}</b>
              <small>{d.plan ? (d.plan.renewsAt ? tr("Next credits: {when}", { when: when(d.plan.renewsAt) }) : tr("Ends {when}", { when: when(d.plan.endsAt) })) : d.mode === "trial" ? tr("{left} of {total} credits · ends {when}", { left: num(d.trial.left), total: num(d.trial.credits), when: when(d.trial.endsAt) }) : tr("{left} of {limit} free messages left today", { left: d.free.left, limit: d.free.limit })}</small></div>
          </div>
          {d.week && <>
            <Meter percent={d.week.percent} />
            <div className="usageWeek"><span><b>{d.week.percent}%</b> {tr("of this week's credits used")}</span><span>{tr("{n} left · week {w} of 4", { n: num(d.week.left), w: d.week.tranche })}</span></div>
            {d.plan?.periodEndsAt && <WeekParts periodEndsAt={d.plan.periodEndsAt} current={d.week.tranche} />}
          </>}
          <div className="usageStats">
            <div><small>{tr("Available now")}</small><b>{num(d.available)}</b></div>
            <div><small>{tr("Extra credits")}</small><b>{num(d.extras)}</b></div>
            <div><small>{tr("Free messages today")}</small><b>{d.free.left}/{d.free.limit}</b></div>
          </div>
        </section>}
        <section className="usageSection">
          <h3>{tr("Plans and extra credits")}</h3>
          <div className="planGrid">{cat.plans.map((p) => <PlanCard key={p.key} plan={p} current={d.plan?.key === p.key} popular={p.key === "pro"} />)}<ExtraCreditsCard min={cat.minPack} /></div>
          <p className="settingsHelp">{tr("Without a plan: {n} messages a day on the free models, after a {days}-day trial with {credits} credits. Card payments open soon; until then plans are given by the Owner.", { n: cat.free.dailyMessages, days: cat.trial.days, credits: num(cat.trial.credits) })}</p>
          <p className="settingsHelp">{tr("A plan's credits come in four equal parts, one every 7 days counted from the day your plan started (for example, a plan started on a Wednesday gets its credits every Wednesday). What you don't use moves to the next week. At 100% the paid models stop until the next part, or you buy extra credits; meanwhile you keep {n} messages a day on the free models.", { n: cat.freeDaily.planExhausted })}</p>
        </section>
        {d.enabled && !d.unlimited && d.history?.length > 0 && <section className="usageSection">
          <h3><Clock size={17} /> {tr("Recent")}</h3>
          <div className="usageTable history">{d.history.slice(0, 40).map((h, i) => <div className="usageRow" key={i}>
            <span>{tr(KIND[h.kind] || h.kind)}<small>{h.model || h.note || ""}</small></span><span>{new Date(h.at).toLocaleString(getLanguage(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><span className={h.credits < 0 ? "plus" : ""}>{!h.credits ? "" : h.credits < 0 ? `+${num(-h.credits)}` : `−${num(h.credits)}`}</span>
          </div>)}</div>
        </section>}
        {isOwner && d.enabled && <OwnerPanel plans={cat.plans} />}
      </>}
    </div>
  </ToolShell>;
}

// The message at 100% (and when a plan feature is missing): buy credits now, or wait for the renewal.
export function CreditsDialog({ info, onBuy, onClose }) {
  useLanguage();
  const wait = info?.credits?.renewsAt ? tr("Wait until {when}", { when: when(info.credits.renewsAt) }) : tr("Wait");
  return <Modal title={info.code === "plan_upgrade" ? tr("Not in your plan") : info.code === "free_limit" ? tr("Free messages used") : tr("Credits used up")} subtitle={info.message} className="modal creditsDialog" onClose={onClose}>
    <div className="formActions">
      <button className="secondary" onClick={onClose}>{info.code === "plan_upgrade" ? tr("Close") : wait}</button>
      <button className="primary" onClick={onBuy}>{info.code === "plan_upgrade" ? tr("See plans") : tr("Buy credits")}</button>
    </div>
  </Modal>;
}
