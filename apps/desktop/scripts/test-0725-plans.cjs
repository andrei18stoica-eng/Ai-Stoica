// 0.7.25, the Owner's plans of 2026-10-17: Start, Plus, Pro, Pro x2, Pro Max x5, Pro Max x10 (Business, 5 people) and
// Enterprise (15 people). Unlimited = null; the old Max moves to Pro x2; connected apps are counted against the plan
// (the built-in plugins are for everyone); HD pictures need Plus; a video is billed for at most one clip's length. The
// Usage page shows every feature on every plan, ticked or struck through, in English.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const C = require("../lib/credits.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

function units() {
  expect(Object.keys(C.PLANS).join() === "start,plus,pro,pro2,max5,business,enterprise", "the seven plans in order: " + Object.keys(C.PLANS).join());
  expect(C.PLANS.pro2.credits === 2 * C.PLANS.pro.credits + 130 && Math.round(C.PLANS.max5.credits / C.PLANS.pro.credits) === 5 && Math.round(C.PLANS.business.credits / C.PLANS.pro.credits) === 10, "x2 / x5 / x10 of Pro's credits");
  expect(C.PLANS.business.name === "Pro Max x10" && C.PLANS.business.label === "Business" && C.PLANS.business.seats === 5 && C.PLANS.business.team && C.PLANS.enterprise.api && C.PLANS.enterprise.seats === 15, "Business and Enterprise");
  const video = Object.values(C.PLANS).map((p) => p.videoSeconds);
  expect(video.join() === "0,6,8,10,15,20,30", "who pays more gets longer video: " + video.join());
  for (const k of ["max5", "business", "enterprise"]) for (const f of ["plugins", "skills", "automations"]) expect(C.PLANS[k][f] === null, `${k}: ${f} unlimited`);
  expect(!C.PLANS.start.imageHd && C.PLANS.plus.imageHd && C.PLANS.start.plugins === 0 && C.PLANS.plus.plugins === 3 && C.PLANS.pro.plugins === 10 && C.PLANS.pro2.plugins === null, "HD pictures and connected apps per plan");
  // The old Max (199,99) is Pro x2 now: a wallet saved with it, and the Owner giving it by the old name.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plans-"));
  fs.writeFileSync(path.join(dir, "credits.json"), JSON.stringify({ accounts: { ana: { walletId: "ana", firstSeenAt: Date.now() - 1000 } }, wallets: { ana: { id: "ana", plan: "max", billing: "monthly", startedAt: Date.now() - 1000, extras: [], history: [] } } }));
  const L = C.createCredits(dir);
  let s = L.status("ana");
  expect(s.plan?.key === "pro2" && s.plan.name === "Pro x2" && s.features.videoSeconds === 10 && s.features.plugins === null && s.features.imageHd === true, "an old Max wallet reads as Pro x2: " + JSON.stringify(s.plan));
  s = L.setPlan("bob", "max");
  expect(s.plan.key === "pro2", "the old name gives Pro x2");
  expect(C.catalog().plans.length === 7 && C.catalog().videoClipMax === C.VIDEO_CLIP_MAX, "the catalog");
  fs.rmSync(dir, { recursive: true, force: true });
}

async function gateway() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plans-gw-"));
  const omni = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(req.url === "/v1/models" ? JSON.stringify({ data: [{ id: "Ai principal", owned_by: "combo" }] }) : "{}"); });
  const omniPort = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "k", model: "Ai principal", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false, ownerEmail: "owner@example.com", creditsEnabled: true, pollinationsFreeEnabled: false };
  const gw = require("../local-gateway.cjs").startLocalGateway({ dataDir: dir, port: 8869, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8869";
  const call = async (p, { method = "GET", body, token } = {}) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, j }; };
  try {
    const owner = (await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } })).j.token;
    const ana = (await call("/auth/register", { method: "POST", body: { email: "ana@example.com", password: "password123", name: "Ana" } })).j.token;
    const plan = (key) => call("/api/credits/accounts/plan", { method: "POST", token: owner, body: { email: "ana@example.com", plan: key } });
    const app = (n) => call("/api/plugins", { method: "POST", token: ana, body: { name: "App " + n, url: "https://example.com/hook" + n, method: "GET" } });

    // Start: no connected apps (the built-in ones still), no HD pictures.
    expect((await plan("start")).status === 200, "Start given");
    let r = await app(1);
    expect(r.status === 403 && r.j.code === "plan_upgrade" && /Connected apps are available from the Plus plan/.test(r.j.error), "Start cannot connect apps: " + JSON.stringify(r));
    expect((await call("/api/plugins/builtin", { method: "POST", token: ana, body: { key: "weather" } })).status === 200, "the built-in plugins are for every plan");
    r = await call("/api/generate/image", { method: "POST", token: ana, body: { prompt: "x", size: "1536x1024" } });
    expect(r.status === 403 && /HD pictures are available from the Plus plan/.test(r.j.error), "HD pictures need Plus: " + JSON.stringify(r));
    // Plus: three apps, the fourth is refused (the built-in one does not count).
    await plan("plus");
    for (const n of [1, 2, 3]) expect((await app(n)).status === 200, `Plus: app ${n}`);
    r = await app(4);
    expect(r.status === 403 && /Your plan includes 3 connected apps/.test(r.j.error), "Plus: the fourth app is refused: " + JSON.stringify(r));
    // Pro x2: no limit.
    await plan("pro2");
    expect((await app(4)).status === 200 && (await app(5)).status === 200, "Pro x2: unlimited apps");
    const s = (await call("/api/credits", { token: ana })).j;
    expect(s.plan.key === "pro2" && s.features.plugins === null && s.features.imageHd && s.features.seats === 1, "the account's features: " + JSON.stringify(s.features));
  } finally {
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sources() {
  const gw = fs.readFileSync(path.join(__dirname, "..", "local-gateway.cjs"), "utf8");
  expect(/Math\.min\(askedDuration,videoMax,creditsLib\.VIDEO_CLIP_MAX\)/.test(gw), "a video is billed for at most one clip's length");
  const ui = fs.readFileSync(path.join(__dirname, "..", "renderer", "src", "pages", "Usage.jsx"), "utf8");
  for (const f of ["Top models", "HD pictures", "Video generation", "Deep Research", "Connected apps", "Skills", "Automations", "Priority access", "Team admin", "API access"]) expect(ui.includes(`["${f}`), `the plans list «${f}»`);
  expect(/<s>\{label\}<\/s>/.test(ui) && /popular=\{p\.key === "pro"\}/.test(ui) && /toLocaleString\("ro-RO"/.test(ui), "struck through when not included, Pro marked, prices as 1.999,99");
}

(async () => { units(); sources(); await gateway(); console.log("0.7.25 plans OK"); })().catch((e) => { console.error(e); process.exit(1); });
