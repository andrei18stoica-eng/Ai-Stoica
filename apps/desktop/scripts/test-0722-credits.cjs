// 0.7.22: plans and credits, exactly as the Owner decided them on 2026-10-16 ("Serasmart AI — Ordinea de lucru", Faza 0).
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const C = require("../lib/credits.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const DAY = 86400000;
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

function units() {
  // The table: price -> credits through the formula (fees, 1% tax, 50% profit, 15% margin), rounded down to 10.
  // (0.7.25: the plans of 2026-10-17; Pro x2 / x5 / x10 have 2 / 5 / 10 times Pro's credits.)
  const table = { start: [29.99, 299.99, 1120], plus: [64.99, 649.99, 2570], pro: [99.99, 999.99, 4010], pro2: [199.99, 1999.99, 8150], max5: [499.99, 4999.99, 20540], business: [999.99, 9999.99, 41190], enterprise: [1999.99, 19999.99, 82490] };
  for (const [k, [price, yearly, credits]] of Object.entries(table)) {
    expect(C.PLANS[k].price === price && C.PLANS[k].yearly === yearly && C.PLANS[k].credits === credits, `${k}: price and credits from the table`);
    expect(C.creditsForPrice(price) === credits, `${k}: the formula gives ${credits}, not ${C.creditsForPrice(price)}`);
    expect(String(price).endsWith(".99") && String(yearly).endsWith(".99"), `${k}: prices end in ,99`);
  }
  expect(C.PLANS.business.seats === 5 && C.PLANS.enterprise.seats === 15 && C.PLANS.start.automations === 3 && C.PLANS.plus.automations === 10 && C.PLANS.pro.automations === 25 && C.PLANS.pro2.automations === 50 && C.PLANS.max5.automations === null, "seats and automations per plan (null = unlimited)");
  expect(C.PLANS.start.compare === 2 && C.PLANS.plus.compare === 3 && C.PLANS.pro.compare === 4 && C.PLANS.start.videoSeconds === 0 && C.PLANS.plus.videoSeconds > 0 && !C.PLANS.plus.tiers.includes("top") && C.PLANS.pro.tiers.includes("top"), "what each plan adds");
  // Extra packs: minimum 100, price rounded up to ,99.
  const packs = { 100: 5.99, 500: 14.99, 1000: 26.99, 5000: 123.99, 10000: 244.99 };
  for (const [n, p] of Object.entries(packs)) expect(C.priceForCredits(Number(n)) === p, `${n} credits = ${p} lei, not ${C.priceForCredits(Number(n))}`);
  expect(C.priceForCredits(99) === null && C.priceForCredits("x") === null, "under 100 credits is not sold");
  // Action costs.
  expect(C.cost("chat", { model: "groq/llama-3.1-8b-instant" }) === 1 && C.cost("chat", { model: "anthropic/claude-sonnet-4.5" }) === 10 && C.cost("chat", { model: "claude-opus-4" }) === 40, "chat by model class");
  expect(C.cost("chat", { model: "gpt-4o", web: true }) === 15 && C.cost("image", {}) === 20 && C.cost("image", { hd: true }) === 50, "web search adds 5; pictures 20 / 50");
  expect(C.cost("video", { seconds: 6, model: "grok-imagine-video" }) === 216 && C.cost("video", { seconds: 8, model: "veo-3.1-fast-generate-preview" }) === 424 && C.cost("transcribe", { seconds: 61 }) === 6, "video by the model's price per second (0.7.27); voice 3 a minute");
  expect(C.isFreeModel("openrouter/x:free") && C.isFreeModel("groq/llama") && C.isFreeModel("pol/openai") && !C.isFreeModel("gemini/gemini-2.5-flash") && !C.isFreeModel("openai/gpt-4o"), "free models (Gemini's free tier excluded: not for the EU public)");

  // The ledger with a clock we move.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "credits-"));
  let now = Date.UTC(2026, 9, 15, 10, 0);
  const L = C.createCredits(dir, { now: () => now });

  // Trial: 2 days, 50 credits, then 5 free messages a day.
  let s = L.status("ana");
  expect(s.mode === "trial" && s.available === 50 && s.features.name === "Start", "a new account starts a 2-day trial with 50 credits: " + JSON.stringify(s));
  let h = L.reserve("ana", 40);
  expect(L.status("ana").available === 10, "a reserved amount is set aside");
  L.release(h);
  h = L.reserve("ana", 40); L.settle(h, 40, { kind: "chat" });
  let err = null; try { L.reserve("ana", 20); } catch (e) { err = e; }
  expect(err?.code === "credits_exhausted" && err.status === 402 && /trial credits/.test(err.message), "the trial runs out: " + err?.message);
  now += 2 * DAY + 1;
  s = L.status("ana");
  expect(s.mode === "free" && s.free.limit === 5 && s.available === 0, "after the trial: free, 5 messages a day");
  for (let i = 0; i < 5; i++) L.useFree("ana");
  err = null; try { L.useFree("ana"); } catch (e) { err = e; }
  expect(err?.code === "free_limit" && err.status === 429, "the 6th free message is refused");
  now += DAY; expect(L.status("ana").free.left === 5, "free messages reset every day");

  // Plus, monthly: 2,570 a period, 642 in week 1; what is left rolls into week 2; the period ends on day 30.
  const start = now;
  L.setPlan("ana", "plus");
  s = L.status("ana");
  expect(s.mode === "plan" && s.week.budget === 642 && s.week.percent === 0 && s.week.refillAt === start + 7 * DAY && s.features.videoSeconds === 6, "Plus: the week's tranche is 642: " + JSON.stringify(s.week));
  const ch = L.charge("ana", 161, { kind: "chat" });
  expect(ch.warning?.level === 25 && /25%/.test(ch.warning.message), "a warning at 25%");
  expect(L.takeNotice("ana")?.level === 25 && L.takeNotice("ana") === null, "the warning is shown once");
  expect(L.charge("ana", 200).warning?.level === 50 && L.charge("ana", 220).warning?.level === 90, "50% and 90% (75% passed in the same step)");
  const last = L.charge("ana", 500);
  expect(last.charged === 61, "only what is left is taken: " + last.charged);
  expect(L.status("ana").week.left === 0 && last.warning?.level === 100, "100% reached");
  err = null; try { L.reserve("ana", 10); } catch (e) { err = e; }
  expect(err?.code === "credits_exhausted" && /renew on \w+day, \d+ \w+ at \d\d:\d\d/.test(err.message) && err.info.renewsAt === start + 7 * DAY, "at 100%: buy credits or wait until the date: " + err?.message);
  expect(L.status("ana").free.limit === 5, "with a plan used up, 5 free messages a day (0.7.27, as without a plan)");
  // Extra credits: used at once, no weekly limit.
  L.addExtra("ana", 100);
  expect(L.status("ana").available === 100, "extra credits are available at once");
  L.charge("ana", 30);
  expect(L.status("ana").extras === 70, "and taken after the tranche");
  // Week 2: a new 25% (643 more); nothing was left over from week 1.
  now = start + 7 * DAY;
  s = L.status("ana");
  expect(s.week.budget === 643 && s.week.tranche === 2 && s.week.used === 0, "week 2 brings the next tranche: " + JSON.stringify(s.week));
  L.charge("ana", 43);
  now = start + 14 * DAY;
  expect(L.status("ana").week.budget === 642 + 600, "what is left in a week rolls into the next");
  now = start + 21 * DAY;
  s = L.status("ana");
  expect(s.week.tranche === 4 && s.week.refillAt === null, "the last tranche lasts until day 30 (a monthly plan does not renew by itself)");
  now = start + 30 * DAY;
  s = L.status("ana");
  expect(s.mode === "free" && s.expiredPlan?.key === "plus" && s.extras === 70, "after 30 days the plan ends; extra credits stay (12 months)");
  now = start + 400 * DAY;
  expect(L.status("ana").extras === 0, "extra credits expire after 12 months");

  // Yearly: 12 periods of 30 days, the counters start again each period.
  now = Date.UTC(2027, 0, 1);
  L.setPlan("bob", "start", { billing: "yearly" });
  L.charge("bob", 280);
  expect(L.status("bob").week.left === 0, "Start's week: 280");
  now += 30 * DAY;
  s = L.status("bob");
  expect(s.mode === "plan" && s.week.budget === 280 && s.week.used === 0 && s.plan.billing === "yearly", "a new period of a yearly plan: " + JSON.stringify(s.week));

  // Team: Business, members share the wallet; a member's own weekly limit.
  L.setPlan("boss", "business");
  L.setTeam("boss", ["m1", "m2"], { m2: 50 });
  expect(L.status("m1").plan?.key === "business" && L.status("m1").available === L.status("boss").available, "members use the team's credits");
  L.charge("m2", 50);
  err = null; try { L.reserve("m2", 1); } catch (e) { err = e; }
  expect(err?.code === "credits_exhausted" && L.status("m1").available > 0, "a member's own limit stops only that member");
  err = null; try { L.setTeam("boss", ["a", "b", "c", "d", "e"]); } catch (e) { err = e; }
  expect(err?.code === "too_many", "Business has 5 seats");
  err = null; try { L.setTeam("ana", ["x"]); } catch (e) { err = e; }
  expect(err?.code === "not_team", "personal plans have no team");

  // Everything survives a restart.
  const L2 = C.createCredits(dir, { now: () => now });
  expect(L2.status("boss").plan?.key === "business" && L2.history("m2").some((x) => x.credits === 50), "the ledger is saved");
  fs.rmSync(dir, { recursive: true, force: true });
}

async function gateway() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "credits-gw-"));
  const seen = [];
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "Ai principal", owned_by: "combo" }, { id: "anthropic/claude-sonnet-4.5" }, { id: "anthropic/claude-opus-4" }, { id: "groq/llama-3.1-8b-instant" }] }));
      if (req.url === "/v1/chat/completions") { const j = JSON.parse(body); seen.push(j.model); return res.end(JSON.stringify({ id: "x", model: j.model, choices: [{ index: 0, message: { role: "assistant", content: "Gata." }, finish_reason: "stop" }] })); }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "k", model: "Ai principal", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false, ownerEmail: "owner@example.com", creditsEnabled: true };
  const gw = require("../local-gateway.cjs").startLocalGateway({ dataDir: dir, port: 8887, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8887";
  const call = async (p, { method = "GET", body, token } = {}) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  try {
    const owner = (await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } })).j.token;
    const ana = (await call("/auth/register", { method: "POST", body: { email: "ana@example.com", password: "password123", name: "Ana" } })).j.token;
    const chat = (token, model) => call("/api/chat", { method: "POST", token, body: { ...(model ? { model } : {}), messages: [{ role: "user", content: "Salut" }] } });

    // The Owner is never charged.
    expect((await chat(owner, "anthropic/claude-opus-4")).status === 200 && (await call("/api/credits", { token: owner })).j.unlimited === true, "the Owner is unlimited");
    // Ana: trial, 50 credits; an advanced model costs 10, a top model needs Pro.
    let c = (await call("/api/credits", { token: ana })).j;
    expect(c.enabled && !c.unlimited && c.mode === "trial" && c.available === 50 && c.catalog.plans.length === 7 && c.catalog.packs[2].price === 26.99, "Ana's trial and the catalog: " + JSON.stringify(c).slice(0, 300));
    expect((await chat(ana, "anthropic/claude-sonnet-4.5")).status === 200 && (await call("/api/credits", { token: ana })).j.available === 40, "an advanced answer costs 10");
    let r = await chat(ana, "anthropic/claude-opus-4");
    expect(r.status === 403 && r.j.code === "plan_upgrade" && /Pro plan/.test(r.j.error), "a top model needs Pro: " + JSON.stringify(r.j));
    // A failed answer costs nothing.
    const before = (await call("/api/credits", { token: ana })).j.available;
    cfg.baseUrl = "http://127.0.0.1:1/v1";
    r = await chat(ana, "anthropic/claude-sonnet-4.5");
    cfg.baseUrl = `http://127.0.0.1:${omniPort}/v1`;
    expect(r.status >= 500 && (await call("/api/credits", { token: ana })).j.available === before, "credits are taken only when the answer comes out");
    for (let i = 0; i < 4; i++) await chat(ana, "anthropic/claude-sonnet-4.5");
    // Used up: the chosen paid model is refused with the "buy or wait" message; the default model answers through a free one.
    r = await chat(ana, "anthropic/claude-sonnet-4.5");
    expect(r.status === 402 && r.j.code === "credits_exhausted", "used up: " + JSON.stringify(r.j));
    seen.length = 0;
    r = await chat(ana, "groq/llama-3.1-8b-instant");
    c = (await call("/api/credits", { token: ana })).j;
    expect(r.status === 200 && seen[0] === "groq/llama-3.1-8b-instant" && c.free.used === 1, "a free model still answers, as one of today's free messages");
    // Plan limits: skills and automations.
    expect((await call("/api/skills", { method: "POST", token: ana, body: { name: "S1", instructions: "x" } })).status === 200, "a skill in the trial");
    // The Owner starts a Plus plan for Ana and adds 100 credits.
    expect((await call("/api/credits/accounts/plan", { method: "POST", token: ana, body: { email: "ana@example.com", plan: "pro2" } })).status === 403, "only the Owner gives plans");
    r = await call("/api/credits/accounts/plan", { method: "POST", token: owner, body: { email: "ana@example.com", plan: "plus" } });
    expect(r.status === 200 && r.j.data.plan.key === "plus" && r.j.data.week.budget === 642, "the Owner starts Plus for Ana: " + JSON.stringify(r.j).slice(0, 200));
    expect((await call("/api/credits/accounts/grant", { method: "POST", token: owner, body: { email: "ana@example.com", credits: 100 } })).j.data.extras === 100, "and adds 100 extra credits");
    expect((await chat(ana, "anthropic/claude-sonnet-4.5")).status === 200, "Ana answers again with the plan");
    c = (await call("/api/credits", { token: ana })).j;
    expect(c.week.used === 10 && c.history.some((x) => x.kind === "chat" && x.credits === 10), "the Usage page sees the week and the history");
    const list = (await call("/api/credits/accounts", { token: owner })).j;
    expect(list.data.some((x) => x.email === "ana@example.com" && x.plan?.key === "plus") && list.data.some((x) => x.email === "owner@example.com" && x.unlimited), "the Owner sees every account");
    // Prices and buying (card payments come in phase 8).
    expect((await call("/api/credits/price?credits=1000", { token: ana })).j.price === 26.99 && (await call("/api/credits/price?credits=50", { token: ana })).status === 400, "pack prices");
    expect((await call("/api/credits/buy", { method: "POST", token: ana, body: { credits: 500 } })).status === 501, "card payments are not open yet");
    // Off: nothing is charged.
    cfg.creditsEnabled = false;
    const was = (await call("/api/credits", { token: ana })).j.week.used;
    await chat(ana, "anthropic/claude-sonnet-4.5");
    c = (await call("/api/credits", { token: ana })).j;
    expect(c.enabled === false && c.unlimited === true && c.week.used === was, "with credits off nothing is charged");
  } finally {
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => { units(); await gateway(); console.log("0.7.22 credits (0.7.25 plans) OK"); })().catch((e) => { console.error(e); process.exit(1); });
