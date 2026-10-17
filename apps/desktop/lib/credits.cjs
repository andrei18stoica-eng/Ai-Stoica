// Plans and credits (0.7.20), as decided by the Owner on 2026-10-16 ("Serasmart AI — Ordinea de lucru", Faza 0).
//
// 1 credit = 0.01 lei of real provider cost. A plan's credits come from its price: what is left after the card fee
// (1.5% + 1.27 lei), the micro-company tax (1%) and a 50% profit, divided by 0.01 lei × 1.15 (a 15% safety margin),
// rounded down to 10. A plan lasts 30 days (a yearly plan: 12 periods of 30 days, paid as 10). Each period's credits
// come in four 25% tranches on days 1, 8, 15 and 22; what is not used rolls into the next week and is lost when the
// period ends. The person sees the week's tranche as 100%, with warnings at 25, 50, 75 and 90%. At 100% the paid
// models stop: buy extra credits (used at once, valid 12 months) or wait for the next tranche; 5 messages a day stay
// on the free models. A new account gets a 2-day trial with 50 credits; after it, an account without a plan keeps 5
// messages a day on the free models. Credits are taken only when the answer, picture or video really comes out.
//
// The ledger lives in <data>/credits.json, apart from the main store (written on every charge).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { renameWithRetry } = require("./store.cjs");

const DAY = 24 * 60 * 60 * 1000, WEEK = 7 * DAY, PERIOD = 30 * DAY;
const CREDIT_LEI = 0.01, SAFETY = 1.15, CARD_PCT = 0.015, CARD_FIXED = 1.27, TAX = 0.01, PROFIT = 0.5;

// What each plan adds (0.7.25, the Owner's table of 2026-10-17: Start, Plus, Pro, Pro x2, Pro Max x5, Pro Max x10 =
// Business for 5 people, Enterprise for 15). Pro x2 / x5 / x10 have 2 / 5 / 10 times Pro's credits (the same formula).
// "tiers": the model classes it may use. null = no limit. videoSeconds: the longest video (one clip is at most
// VIDEO_CLIP_MAX seconds for now). plugins: how many apps the account may connect (the built-in ones are for all).
const PLANS = {
  start: { name: "Start", price: 29.99, yearly: 299.99, credits: 1120, seats: 1, tiers: ["fast", "advanced"], imageHd: false, videoSeconds: 0, plugins: 0, deepResearch: false, compare: 2, automations: 3, skills: 10, priority: false },
  plus: { name: "Plus", price: 64.99, yearly: 649.99, credits: 2570, seats: 1, tiers: ["fast", "advanced"], imageHd: true, videoSeconds: 6, plugins: 3, deepResearch: false, compare: 3, automations: 10, skills: 25, priority: false },
  pro: { name: "Pro", price: 99.99, yearly: 999.99, credits: 4010, seats: 1, tiers: ["fast", "advanced", "top"], imageHd: true, videoSeconds: 8, plugins: 10, deepResearch: true, compare: 4, automations: 25, skills: 50, priority: false },
  pro2: { name: "Pro x2", price: 199.99, yearly: 1999.99, credits: 8150, seats: 1, tiers: ["fast", "advanced", "top"], imageHd: true, videoSeconds: 10, plugins: null, deepResearch: true, compare: 4, automations: 50, skills: 100, priority: true },
  max5: { name: "Pro Max x5", price: 499.99, yearly: 4999.99, credits: 20540, seats: 1, tiers: ["fast", "advanced", "top"], imageHd: true, videoSeconds: 15, plugins: null, deepResearch: true, compare: 6, automations: null, skills: null, priority: true },
  business: { name: "Pro Max x10", label: "Business", price: 999.99, yearly: 9999.99, credits: 41190, seats: 5, tiers: ["fast", "advanced", "top"], imageHd: true, videoSeconds: 20, plugins: null, deepResearch: true, compare: 6, automations: null, skills: null, priority: true, team: true },
  enterprise: { name: "Enterprise", price: 1999.99, yearly: 19999.99, credits: 82490, seats: 15, tiers: ["fast", "advanced", "top"], imageHd: true, videoSeconds: 30, plugins: null, deepResearch: true, compare: 6, automations: null, skills: null, priority: true, team: true, api: true }
};
// Plans that were renamed: a wallet on the old key moves to the new one when it is read (Max 199,99 → Pro x2).
const LEGACY_PLANS = { max: "pro2" };
// One generated clip is at most this long (Grok Imagine: 15 s; Veo: 8 s). Longer videos need joined clips.
const VIDEO_CLIP_MAX = 15;
// No plan: free models only, a few messages a day; the trial tries Start for two days.
const FREE_FEATURES = { name: "Free", tiers: ["fast"], imageHd: false, videoSeconds: 0, plugins: 0, deepResearch: false, compare: 0, automations: 0, skills: 3, priority: false };
const TRIAL = { days: 2, credits: 50 };
const FREE_DAILY = { noPlan: 5, planExhausted: 5 };
const WARN_AT = [25, 50, 75, 90];

// Starting costs per action, in credits (recalculated in phase 9 from the real costs).
const COSTS = { fast: 1, advanced: 10, top: 40, web: 5, image: 20, imageHd: 50, videoBase: 300, videoBaseSeconds: 6, videoExtraSecond: 50, transcribeMinute: 3 };
const MIN_PACK = 100;

const round10 = (n) => Math.floor(n / 10) * 10;
// Credits a payment of `price` lei buys, after fees, tax and profit.
function creditsForPrice(price) {
  const budget = price - (price * CARD_PCT + CARD_FIXED) - price * TAX - price * PROFIT;
  return Math.max(0, round10(budget / (CREDIT_LEI * SAFETY)));
}
// The price of an extra pack of `credits`, rounded up to x,99 lei (100 = 5,99; 1.000 = 26,99; 10.000 = 244,99).
function priceForCredits(credits) {
  const n = Math.floor(Number(credits));
  if (!Number.isFinite(n) || n < MIN_PACK) return null;
  const raw = (n * CREDIT_LEI * SAFETY + CARD_FIXED) / (1 - CARD_PCT - TAX - PROFIT);
  const cents = Math.round(raw * 100), whole = Math.floor(cents / 100);
  const price = cents <= whole * 100 + 99 ? whole * 100 + 99 : (whole + 1) * 100 + 99;
  return price / 100;
}

// The class of a model, from its name: "top" (Opus, GPT-5, o1/o3, Gemini Pro, Grok 4…), "fast" (mini, flash, haiku,
// small open models, the free ones) or "advanced" (everything else, including OmniRoute combinations).
function modelTier(model) {
  const id = String(model || "").toLowerCase();
  if (!id) return "advanced";
  if (/(^|[\/:._-])(mini|nano|flash|haiku|lite|small|tiny|instant|fast|gemma)([\/:._-]|\d|$)|:free$|(^|[^\d])(1|3|7|8|9)b([^\w]|$)|scout|maverick/.test(id)) return "fast";
  if (/opus|gpt-?5(?![.\d]*-?(mini|nano|chat))|gpt-?4\.5|(^|[\/:._-])o[134](?![\w])|(^|[\/:._-])o[134]-(?!mini)|-pro\b|ultra|grok-?4(?!.*fast)|deep-?research|(^|[\/:._-])r1\b|reasoner/.test(id)) return "top";
  return "advanced";
}

// Models that cost nothing and may serve the public: the keyless OmniRoute services, OpenRouter ":free", GPT-OSS
// and the free tiers of Groq, Cerebras, Mistral, NVIDIA, Cloudflare, Cohere, Hugging Face and GitHub Models.
// Gemini's free tier is not among them: its terms do not allow serving users in the EU.
const KEYLESS = new Set(["pol", "pollinations", "cfp", "cloudflare-playground", "ddgw", "duckduckgo-web", "felo", "felo-web", "tllm", "theoldllm", "pepper", "chipotle"]);
const FREE_DIRECT = new Set(["groq", "cerebras", "mistral", "nvidia", "cloudflare", "cohere", "huggingface", "github"]);
function isFreeModel(model) {
  const id = String(model || "").trim().toLowerCase();
  if (!id) return false;
  const first = id.includes("/") ? id.split("/")[0] : "";
  if (KEYLESS.has(first)) return true;
  if (id.endsWith(":free")) return true;
  if (/^((openai|groq|cerebras)\/)?gpt[-_. ]?oss/.test(id)) return true;
  return FREE_DIRECT.has(first);
}

function cost(kind, opts = {}) {
  if (kind === "chat") return (isFreeModel(opts.model) ? COSTS.fast : COSTS[modelTier(opts.model)] || COSTS.advanced) + (opts.web ? COSTS.web : 0);
  if (kind === "image") return opts.hd ? COSTS.imageHd : COSTS.image;
  if (kind === "video") { const s = Math.max(1, Math.ceil(Number(opts.seconds) || COSTS.videoBaseSeconds)); return COSTS.videoBase + Math.max(0, s - COSTS.videoBaseSeconds) * COSTS.videoExtraSecond; }
  if (kind === "transcribe") return Math.max(1, Math.ceil((Number(opts.seconds) || 60) / 60)) * COSTS.transcribeMinute;
  return 0;
}

class CreditError extends Error {
  constructor(code, message, info = {}, status = 402) { super(message); this.code = code; this.status = status; this.info = info; }
}

// "Thursday, 22 October at 18:30", in the server's time zone (Romania by default).
function when(ms, tz = "Europe/Bucharest") {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${parts.weekday}, ${parts.day} ${parts.month} at ${parts.hour}:${parts.minute}`;
  } catch { return new Date(ms).toISOString(); }
}

function createCredits(dataDir, { now: clock = () => Date.now(), timeZone = "Europe/Bucharest" } = {}) {
  const file = path.join(dataDir, "credits.json");
  const holds = new Map();
  let db = null;

  function load() {
    if (db) return db;
    try { db = JSON.parse(fs.readFileSync(file, "utf8")); } catch { db = null; }
    if (!db || typeof db !== "object") db = {};
    db.wallets = db.wallets && typeof db.wallets === "object" ? db.wallets : {};
    db.accounts = db.accounts && typeof db.accounts === "object" ? db.accounts : {};
    return db;
  }
  function save() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1), { mode: 0o600 });
    renameWithRetry(tmp, file);
  }
  function account(userId) {
    const d = load(), key = String(userId);
    if (!d.accounts[key]) d.accounts[key] = { walletId: key, firstSeenAt: clock() };
    return d.accounts[key];
  }
  function wallet(walletId) {
    const d = load(), key = String(walletId);
    if (!d.wallets[key]) d.wallets[key] = { id: key, extras: [], history: [] };
    const w = d.wallets[key];
    w.extras = Array.isArray(w.extras) ? w.extras : []; w.history = Array.isArray(w.history) ? w.history : [];
    if (LEGACY_PLANS[w.plan]) w.plan = LEGACY_PLANS[w.plan];
    return w;
  }
  const walletOf = (userId) => wallet(account(userId).walletId || String(userId));

  // The plan's position in time: period, week, tranche, renewal. Rolls the counters forward (and says if it did).
  function planClock(w, t) {
    const plan = PLANS[w.plan];
    if (!plan || !w.startedAt) return null;
    const periods = w.billing === "yearly" ? 12 : 1;
    const elapsed = t - w.startedAt;
    if (elapsed < 0) return null;
    const p = Math.floor(elapsed / PERIOD);
    const endsAt = w.startedAt + periods * PERIOD;
    if (p >= periods) return { plan, expired: true, endsAt };
    const periodStart = w.startedAt + p * PERIOD;
    const week = Math.min(3, Math.floor((t - periodStart) / WEEK));
    let rolled = false;
    if (w.period !== p) { w.period = p; w.periodUsed = 0; w.week = -1; rolled = true; }
    if (w.week !== week) { w.week = week; w.weekStartUsed = Number(w.periodUsed) || 0; w.warned = []; w.memberWeekUsed = {}; rolled = true; }
    const released = week === 3 ? plan.credits : Math.floor((plan.credits * (week + 1)) / 4);
    const used = Number(w.periodUsed) || 0;
    const remaining = Math.max(0, released - used);
    const weekUsed = used - (Number(w.weekStartUsed) || 0);
    const weekBudget = remaining + weekUsed;
    const nextTranche = week < 3 ? periodStart + (week + 1) * WEEK : null;
    const periodEndsAt = periodStart + PERIOD;
    const renewsAt = nextTranche || (p + 1 < periods ? periodEndsAt : null);
    return { plan, expired: false, period: p, periods, week, released, remaining, weekUsed, weekBudget, nextTranche, periodEndsAt, renewsAt, endsAt, rolled };
  }
  function extrasLeft(w, t) { return w.extras.filter((x) => x.expiresAt > t && x.left > 0).reduce((s, x) => s + x.left, 0); }
  function trialState(a, w, t) {
    if (PLANS[w.plan] && w.startedAt && t < w.startedAt + (w.billing === "yearly" ? 12 : 1) * PERIOD) return null;
    const start = a.trialStartedAt || a.firstSeenAt || t;
    const endsAt = start + TRIAL.days * DAY;
    if (t >= endsAt) return { active: false, endsAt, left: 0 };
    return { active: true, endsAt, left: Math.max(0, TRIAL.credits - (Number(a.trialUsed) || 0)) };
  }
  function memberLeft(w, userId, c) {
    const limit = w.memberLimits?.[userId];
    if (!c || !(limit > 0)) return Infinity;
    return Math.max(0, limit - (Number(w.memberWeekUsed?.[userId]) || 0));
  }
  const held = (walletId) => [...holds.values()].filter((h) => h.walletId === walletId).reduce((s, h) => s + h.amount, 0);

  // Everything an account needs to know about its credits right now.
  function status(userId) {
    const t = clock(), a = account(userId), w = walletOf(userId);
    const c = planClock(w, t);
    if (c?.rolled) save();
    const trial = trialState(a, w, t);
    const extras = extrasLeft(w, t);
    const active = c && !c.expired;
    const planLeft = active ? Math.min(c.remaining, memberLeft(w, String(userId), c)) : 0;
    const available = Math.max(0, planLeft + (trial?.active ? trial.left : 0) + extras - held(w.id));
    const features = active ? c.plan : trial?.active ? PLANS.start : FREE_FEATURES;
    const day = new Date(t).toISOString().slice(0, 10);
    const freeUsed = a.freeDay === day ? Number(a.freeUsed) || 0 : 0;
    const freeLimit = active ? FREE_DAILY.planExhausted : FREE_DAILY.noPlan;
    return {
      mode: active ? "plan" : trial?.active ? "trial" : "free",
      plan: active ? { key: w.plan, name: c.plan.name, billing: w.billing || "monthly", credits: c.plan.credits, startedAt: w.startedAt, periodEndsAt: c.periodEndsAt, endsAt: c.endsAt, renewsAt: c.renewsAt, team: !!c.plan.team, members: (w.members || []).length } : null,
      expiredPlan: c?.expired ? { key: w.plan, name: c.plan.name, endedAt: c.endsAt } : null,
      week: active ? { budget: c.weekBudget, used: c.weekUsed, left: planLeft, percent: c.weekBudget > 0 ? Math.min(100, Math.round((c.weekUsed / c.weekBudget) * 100)) : 100, tranche: c.week + 1, refillAt: c.renewsAt } : null,
      trial: trial ? { active: trial.active, left: trial.left, endsAt: trial.endsAt, credits: TRIAL.credits } : null,
      extras, available, held: held(w.id),
      free: { limit: freeLimit, used: freeUsed, left: Math.max(0, freeLimit - freeUsed) },
      features: { name: features.name, tiers: features.tiers, imageHd: !!features.imageHd, videoSeconds: features.videoSeconds, plugins: features.plugins, deepResearch: features.deepResearch, compare: features.compare, automations: features.automations, skills: features.skills, priority: !!features.priority, team: !!features.team, api: !!features.api, seats: features.seats || 1 },
      notice: w.notice || null
    };
  }

  function exhaustedError(s) {
    const renew = s.plan?.renewsAt;
    if (s.mode === "plan") {
      return new CreditError("credits_exhausted", `You've used all of this week's credits. Buy extra credits now, or wait until they renew${renew ? ` on ${when(renew, timeZone)}` : " with your next plan"}. Until then you have ${s.free.left} free message${s.free.left === 1 ? "" : "s"} today on the free models.`, { renewsAt: renew || null, freeLeft: s.free.left });
    }
    if (s.mode === "trial") return new CreditError("credits_exhausted", `You've used the ${TRIAL.credits} trial credits. Choose a plan or buy extra credits to keep going; the free models give you ${s.free.left} message${s.free.left === 1 ? "" : "s"} today.`, { renewsAt: null, freeLeft: s.free.left });
    return new CreditError("plan_required", `${s.expiredPlan ? `Your ${s.expiredPlan.name} plan has ended` : "Your free trial has ended"}. Choose a plan or buy extra credits to use this model; the free models give you ${s.free.left} message${s.free.left === 1 ? "" : "s"} today.`, { renewsAt: null, freeLeft: s.free.left });
  }

  // Sets the credits aside before the work starts. Throws CreditError when the account cannot pay `amount`.
  function reserve(userId, amount, meta = {}) {
    const s = status(userId);
    if (s.available < amount) throw exhaustedError(s);
    const w = walletOf(userId), id = crypto.randomUUID();
    holds.set(id, { id, walletId: w.id, userId: String(userId), amount, meta, at: clock() });
    return { id, amount };
  }
  function release(hold) { if (hold?.id) holds.delete(hold.id); }

  // Takes `amount` (the real cost) for a hold: the plan's tranche first, then the trial, then the extra packs (the
  // ones that expire first). Returns what was charged and the warning the account crossed, if any.
  function settle(hold, amount, meta = {}) {
    const h = hold?.id ? holds.get(hold.id) : null;
    if (!h) return { charged: 0 };
    holds.delete(h.id);
    return charge(h.userId, amount, { ...h.meta, ...meta });
  }
  function charge(userId, amount, meta = {}) {
    const t = clock(), a = account(userId), w = walletOf(userId), uid = String(userId);
    let need = Math.max(0, Math.ceil(Number(amount) || 0));
    const total = need, parts = {};
    const c = planClock(w, t);
    if (c && !c.expired && need > 0) {
      const take = Math.min(need, c.remaining, memberLeft(w, uid, c));
      if (take > 0) {
        w.periodUsed = (Number(w.periodUsed) || 0) + take; need -= take; parts.plan = take;
        if (w.memberLimits?.[uid] > 0) { w.memberWeekUsed = w.memberWeekUsed || {}; w.memberWeekUsed[uid] = (Number(w.memberWeekUsed[uid]) || 0) + take; }
      }
    }
    const trial = trialState(a, w, t);
    if (trial?.active && need > 0) {
      const take = Math.min(need, trial.left);
      if (take > 0) { a.trialStartedAt = a.trialStartedAt || a.firstSeenAt || t; a.trialUsed = (Number(a.trialUsed) || 0) + take; need -= take; parts.trial = take; }
    }
    if (need > 0) {
      for (const x of w.extras.filter((e) => e.expiresAt > t && e.left > 0).sort((p, q) => p.expiresAt - q.expiresAt)) {
        const take = Math.min(need, x.left);
        x.left -= take; need -= take; parts.extra = (parts.extra || 0) + take;
        if (!need) break;
      }
    }
    w.extras = w.extras.filter((x) => x.left > 0 && x.expiresAt > t);
    const charged = total - need;
    w.history.unshift({ at: t, userId: uid, kind: meta.kind || "chat", model: meta.model ? String(meta.model).slice(0, 120) : undefined, credits: charged, parts, ...(need ? { unpaid: need } : {}) });
    w.history = w.history.slice(0, 300);
    // Warnings at 25 / 50 / 75 / 90% of the week, and once at 100%.
    let warning = null;
    const after = c && !c.expired ? planClock(w, t) : null;
    if (after && after.weekBudget > 0) {
      const pct = Math.floor((after.weekUsed / after.weekBudget) * 100);
      w.warned = Array.isArray(w.warned) ? w.warned : [];
      const crossed = [...WARN_AT, 100].filter((x) => pct >= x && !w.warned.includes(x));
      if (crossed.length) {
        w.warned.push(...crossed);
        const level = crossed[crossed.length - 1];
        warning = { level, at: t, renewsAt: after.renewsAt, message: level >= 100
          ? `You've used 100% of this week's credits. They renew${after.renewsAt ? ` on ${when(after.renewsAt, timeZone)}` : " with your next plan"}; you can also buy extra credits now.`
          : `You've used ${level}% of this week's credits.` };
        w.notice = warning;
      }
    }
    save();
    return { charged, parts, warning };
  }

  // One of today's free messages (free models only, when the account has no credits to pay with).
  function useFree(userId) {
    const s = status(userId);
    if (s.free.left <= 0) {
      const tomorrow = new Date(new Date(clock()).toISOString().slice(0, 10) + "T00:00:00Z").getTime() + DAY;
      throw new CreditError("free_limit", `You've used today's ${s.free.limit} free messages. They reset on ${when(tomorrow, timeZone)}${s.mode === "plan" ? ", and your credits renew" + (s.plan?.renewsAt ? ` on ${when(s.plan.renewsAt, timeZone)}` : "") : ""}. Buy extra credits or choose a plan to keep going now.`, { renewsAt: s.plan?.renewsAt || null, resetsAt: tomorrow }, 429);
    }
    const a = account(userId), day = new Date(clock()).toISOString().slice(0, 10);
    if (a.freeDay !== day) { a.freeDay = day; a.freeUsed = 0; }
    a.freeUsed = (Number(a.freeUsed) || 0) + 1;
    save();
    return { left: s.free.left - 1 };
  }
  function refundFree(userId) {
    const a = account(userId), day = new Date(clock()).toISOString().slice(0, 10);
    if (a.freeDay === day && a.freeUsed > 0) { a.freeUsed -= 1; save(); }
  }

  // The Owner (until payments arrive in phase 8): starts or changes a plan, adds extra credits, groups a team.
  function setPlan(userId, planKey, { billing = "monthly", startedAt } = {}) {
    const w = walletOf(userId);
    if (planKey === null || planKey === "none") { delete w.plan; delete w.startedAt; delete w.billing; w.period = null; w.week = null; w.periodUsed = 0; save(); return status(userId); }
    if (LEGACY_PLANS[planKey]) planKey = LEGACY_PLANS[planKey];
    if (!PLANS[planKey]) throw new CreditError("bad_plan", "Unknown plan.", {}, 400);
    w.plan = planKey; w.billing = billing === "yearly" ? "yearly" : "monthly"; w.startedAt = Number(startedAt) || clock();
    w.period = null; w.week = null; w.periodUsed = 0; w.weekStartUsed = 0; w.warned = []; w.notice = null;
    w.history.unshift({ at: clock(), userId: String(userId), kind: "plan", plan: planKey, billing: w.billing, credits: 0 });
    save();
    return status(userId);
  }
  function addExtra(userId, credits, { months = 12, note = "" } = {}) {
    const n = Math.floor(Number(credits));
    if (!Number.isFinite(n) || n < 1 || n > 10_000_000) throw new CreditError("bad_amount", "The number of credits is not valid.", {}, 400);
    const w = walletOf(userId), t = clock();
    w.extras.push({ id: crypto.randomUUID(), credits: n, left: n, boughtAt: t, expiresAt: t + (months === 12 ? 365 : months * 30) * DAY, note: String(note).slice(0, 120) });
    w.history.unshift({ at: t, userId: String(userId), kind: "extra", credits: -n, note: String(note).slice(0, 120) || undefined });
    if (w.notice?.level >= 100) w.notice = null;
    save();
    return status(userId);
  }
  // The team's members share the owner's wallet; a member can get a weekly limit of their own.
  function setTeam(ownerId, memberIds = [], limits = {}) {
    const w = walletOf(ownerId), plan = PLANS[w.plan];
    if (!plan?.team) throw new CreditError("not_team", "Only the Business and Enterprise plans have a team.", {}, 400);
    const members = [...new Set(memberIds.map(String).filter((x) => x && x !== String(ownerId)))];
    if (members.length + 1 > plan.seats) throw new CreditError("too_many", `The ${plan.name} plan has ${plan.seats} seats.`, {}, 400);
    const d = load();
    for (const [uid, a] of Object.entries(d.accounts)) if (a.walletId === w.id && uid !== String(ownerId) && !members.includes(uid)) a.walletId = uid;
    for (const uid of members) account(uid).walletId = w.id;
    w.members = members;
    w.memberLimits = Object.fromEntries(Object.entries(limits || {}).filter(([k, v]) => members.includes(String(k)) && Number(v) > 0).map(([k, v]) => [String(k), Math.floor(Number(v))]));
    save();
    return status(ownerId);
  }
  function takeNotice(userId) { const w = walletOf(userId), n = w.notice || null; if (n) { w.notice = null; save(); } return n; }
  function history(userId, limit = 50) { return walletOf(userId).history.slice(0, limit); }
  function summary() {
    const d = load();
    return Object.keys(d.accounts).map((uid) => ({ userId: uid, ...status(uid) }));
  }

  return { status, reserve, release, settle, charge, useFree, refundFree, setPlan, addExtra, setTeam, takeNotice, history, summary, file };
}

function catalog() {
  return {
    plans: Object.entries(PLANS).map(([key, p]) => ({ key, ...p, perWeek: Math.floor(p.credits / 4) })),
    free: { ...FREE_FEATURES, dailyMessages: FREE_DAILY.noPlan },
    trial: TRIAL, costs: COSTS, minPack: MIN_PACK, warnAt: WARN_AT, freeDaily: FREE_DAILY, videoClipMax: VIDEO_CLIP_MAX,
    packs: [100, 500, 1000, 5000, 10000].map((c) => ({ credits: c, price: priceForCredits(c) }))
  };
}

module.exports = { PLANS, LEGACY_PLANS, VIDEO_CLIP_MAX, FREE_FEATURES, TRIAL, FREE_DAILY, COSTS, WARN_AT, MIN_PACK, creditsForPrice, priceForCredits, modelTier, isFreeModel, cost, CreditError, createCredits, catalog, when };
