// 0.7.17, at the Owner's request:
//  - the free tier: every account except the Owner makes 3 pictures, 1 video and 10 files a day, from free providers,
//    whatever model the chat is on; the Owner is unlimited; a failed attempt gives the unit back;
//  - Control Center: the Owner allows or blocks each model for each account ("model_overrides" in the permissions).
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");
const policy = require("../../server/ai-policy.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
async function body(req) { let b = ""; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; }
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(200, 1)]);

async function main() {
  // Policy unit checks (the real file the server uses).
  const ctx = (overrides, extra = {}) => ({ user: { role: "user" }, permissions: { chat: true, openai: false, groq: true, model_overrides: overrides, ...extra }, paidEnabled: false, combinations: [] });
  expect(!policy.evaluateModelAccess(ctx({}), "openai/gpt-5").allowed, "a paid model is closed by default");
  expect(policy.evaluateModelAccess(ctx({ "openai/gpt-5": "allow" }), "openai/gpt-5").allowed, "'allow' opens a paid model for this account");
  expect(policy.evaluateModelAccess(ctx({ "OpenAI/GPT-5": "allow" }), "openai/gpt-5").allowed, "model names are compared without case");
  expect(!policy.evaluateModelAccess(ctx({ "groq/llama-3.3-70b-versatile": "deny" }), "groq/llama-3.3-70b-versatile").allowed, "'deny' closes an open model");
  expect(!policy.evaluateModelAccess(ctx({ "openai/gpt-5": "allow" }, { chat: false }), "openai/gpt-5").allowed, "no override opens a model while chat is off");
  expect(policy.evaluateModelAccess({ ...ctx({ "x/y": "deny" }), user: { role: "owner" } }, "groq/llama-3.3-70b-versatile").allowed, "the Owner is never restricted");
  expect(!policy.evaluateModelAccess(ctx({ "cx/gpt-5.5": "allow" }), "cx/gpt-5.5").allowed, "a button never opens the Owner's personal subscriptions");
  const server = fs.readFileSync(path.join(__dirname, "../../server/server.cjs"), "utf8");
  expect(/app\.patch\("\/api\/admin\/users\/:id\/models", auth, ownerOnly/.test(server) && /admin\.model_override/.test(server), "the server needs the Owner-only route for per-model access");

  const accounts = {
    "normal-token": { id: "u1", email: "ana@example.com", name: "Ana", role: "user", status: "active" },
    "owner-token": { id: "u0", email: "owner@example.com", name: "Owner", role: "owner", status: "active" }
  };
  const permissions = { chat: true, groq: true, gemini: true, openai: false, image_generation: true, video_generation: true, document_generation: true, model_overrides: {} };
  const cloud = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    const user = accounts[String(req.headers.authorization || "").replace(/^Bearer /, "")];
    if (!user) { res.statusCode = 401; return res.end("{}"); }
    if (req.url === "/auth/me") return res.end(JSON.stringify({ user, permissions }));
    if (req.url === "/api/ai/access" && req.method === "POST") {
      const { models = [] } = await body(req);
      const context = { user, permissions, paidEnabled: false, combinations: [] };
      return res.end(JSON.stringify({ data: models.map((m) => policy.evaluateModelAccess(context, m)), policyEnforced: true }));
    }
    res.statusCode = 404; res.end("{}");
  });
  const omni = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "groq/llama-3.3-70b-versatile", owned_by: "groq" }, { id: "openai/gpt-5", owned_by: "openai" }] }));
    if (req.url === "/v1/chat/completions") { const j = await body(req); return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok " + j.model } }] })); }
    res.statusCode = 404; res.end("{}");
  });
  const [cloudPort, omniPort] = [await listen(cloud), await listen(omni)];
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, controlApiUrl: `http://127.0.0.1:${cloudPort}`, apiKey: "k", model: "", webSearchEnabled: false, githubAutoContext: false,
    imageProviders: "gemini", videoProviders: "gemini", freeDocumentsPerDay: 2 };
  const realFetch = globalThis.fetch;
  let pollinationsOk = true; const pollinationsCalls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    if (u.startsWith("https://image.pollinations.ai/")) { pollinationsCalls.push(u); return pollinationsOk ? new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }) : new Response("no", { status: 503 }); }
    return new Response("{}", { status: 503 });
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-quotas-"));
  const gw = startLocalGateway({ dataDir: dir, port: 8879, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8879";
  const call = (p, token, payload) => realFetch(base + p, { method: payload ? "POST" : "GET", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: payload ? JSON.stringify(payload) : undefined });
  try {
    // Pictures: 3 a day for a normal account, from the free providers, even with «Făcute de» = Gemini and a Claude chat model.
    for (let i = 1; i <= 3; i++) {
      const r = await call("/api/generate/image", "normal-token", { prompt: "o pisică " + i, via: "anthropic/claude-sonnet-4" });
      const j = await r.json();
      expect(r.status === 200 && j.data?.provider === "pollinations-free", `picture ${i} must come from the free tier: ${r.status} ${JSON.stringify(j)}`);
    }
    let r = await call("/api/generate/image", "normal-token", { prompt: "a patra" }), j = await r.json();
    expect(r.status === 429 && /3 poze gratuite/.test(j.error), "the fourth picture of the day is refused: " + r.status + JSON.stringify(j));
    let q = await (await call("/api/quota", "normal-token")).json();
    expect(q.image.left === 0 && q.image.limit === 3 && !q.unlimited, "the quota route shows the day: " + JSON.stringify(q));
    // The Owner is unlimited.
    for (let i = 0; i < 5; i++) {
      r = await call("/api/generate/image", "owner-token", { prompt: "owner " + i });
      expect(r.status !== 429, "the Owner has no limit on pictures");
    }
    q = await (await call("/api/quota", "owner-token")).json();
    expect(q.unlimited === true, "the Owner is shown unlimited");

    // A failed attempt gives the unit back: another account, providers down, then up again.
    accounts["other-token"] = { id: "u2", email: "bob@example.com", name: "Bob", role: "user", status: "active" };
    pollinationsOk = false;
    for (let i = 0; i < 4; i++) { r = await call("/api/generate/image", "other-token", { prompt: "x" }); expect(r.status >= 400 && r.status !== 429, "providers down: an error, not a limit: " + r.status); }
    pollinationsOk = true;
    r = await call("/api/generate/image", "other-token", { prompt: "x" });
    expect(r.status === 200, "failed tries must not use the free pictures: " + r.status);

    // Video: the free tier says so when no free video service is connected, and keeps the unit.
    r = await call("/api/generate/video", "normal-token", { prompt: "un apus" }); j = await r.json();
    expect(r.status === 503 && /gratuit/.test(j.error), "no free video service: a clear message " + r.status + JSON.stringify(j));
    q = await (await call("/api/quota", "normal-token")).json();
    expect(q.video.left === 1, "a failed video keeps the free video: " + JSON.stringify(q));

    // Files: 2 a day here (freeDocumentsPerDay), the Owner unlimited.
    for (let i = 1; i <= 2; i++) { r = await call("/api/export", "normal-token", { format: "docx", title: "t" + i, content: "# Salut\ntext" }); expect(r.status === 200, `file ${i}: ${r.status}`); }
    r = await call("/api/export", "normal-token", { format: "pdf", title: "t3", content: "text" }); j = await r.json();
    expect(r.status === 429 && /2 fișiere gratuite/.test(j.error), "the third file of the day is refused: " + r.status + JSON.stringify(j));
    for (let i = 0; i < 3; i++) { r = await call("/api/export", "owner-token", { format: "xlsx", title: "o" + i, content: "| a | b |\n|---|---|\n| 1 | 2 |" }); expect(r.status === 200, "the Owner exports without a limit: " + r.status); }

    // Control Center: an override opens a closed model and closes an open one for this account.
    let ids = (await (await call("/api/models", "normal-token")).json());
    const idList = ids.data.map((x) => typeof x === "string" ? x : x.id);
    expect(idList.includes("groq/llama-3.3-70b-versatile") && !idList.includes("openai/gpt-5"), "default: Groq open, OpenAI locked: " + idList);
    permissions.model_overrides = { "openai/gpt-5": "allow", "groq/llama-3.3-70b-versatile": "deny" };
    await new Promise((res) => setTimeout(res, 50));
    const chat = async (model) => { const x = await call("/api/chat", "normal-token", { model, messages: [{ role: "user", content: "Salut" }] }); return { status: x.status, body: await x.json() }; };
    let c = await chat("openai/gpt-5");
    expect(c.status === 200 && /ok openai\/gpt-5/.test(c.body?.choices?.[0]?.message?.content || ""), "'allow' lets the account use the model: " + c.status + JSON.stringify(c.body));
    c = await chat("groq/llama-3.3-70b-versatile");
    expect(c.status === 403 && /Owner/.test(c.body?.error || ""), "'deny' blocks the model with the Owner's name: " + c.status + JSON.stringify(c.body));
    ids = await (await call("/api/models", "normal-token")).json();
    expect((ids.locked || []).some((x) => x.id === "groq/llama-3.3-70b-versatile" && /blocat/.test(x.reason)), "a denied model is listed locked: " + JSON.stringify(ids.locked));
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); omni.close(); cloud.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // The interface: Control Center has the three-state button per model.
  const ui = fs.readFileSync(path.join(__dirname, "../renderer/src/main.jsx"), "utf8");
  expect(/setModelMode\(selected,m,v\)/.test(ui) && /\/models`,\{method:"PATCH"/.test(ui) && /\["default","Implicit"\],\["allow","Activat"\],\["deny","Blocat"\]/.test(ui), "Control Center needs Implicit / Activat / Blocat per model");
  console.log("test-0717-quotas-grants: OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
