// 0.7.16, at the Owner's request: the accounts other than the Owner see every model, and use every one that costs nothing, from OmniRoute
// and from the direct APIs (Gemini, Groq, Mistral, GitHub Models, OpenRouter :free, Pollinations…). The Owner's own
// subscriptions (Codex, Claude Code, GitHub Copilot, Kiro, the "-web" accounts) stay his: their terms forbid sharing the
// account. An OmniRoute combination does not say what it uses, so the others get only the ones the Owner shares.
// The models they may not use are listed locked; using one says «nu îți este permis de Owner» and why.
// The policy below is the real apps/server/ai-policy.cjs.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");
const policy = require("../../server/ai-policy.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
async function body(req) { let b = ""; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; }
const answer = (text) => ({ choices: [{ message: { role: "assistant", content: text } }] });

async function main() {
  const accounts = {
    "normal-token": { id: "u1", email: "ana@example.com", name: "Ana", role: "user", status: "active" },
    "owner-token": { id: "u0", email: "owner@example.com", name: "Owner", role: "owner", status: "active" }
  };
  const permissions = { chat: true, cerebras: true, gemini: true, groq: true, cloudflare: true, openrouter: false };
  const cloud = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    const user = accounts[String(req.headers.authorization || "").replace(/^Bearer /, "")];
    if (!user) { res.statusCode = 401; return res.end(JSON.stringify({ error: "bad token" })); }
    if (req.url === "/auth/me") return res.end(JSON.stringify({ user, permissions }));
    if (req.url === "/api/ai/access" && req.method === "POST") {
      const { models = [] } = await body(req);
      const context = { user, permissions, paidEnabled: false, combinations: [] };
      return res.end(JSON.stringify({ data: models.map((m) => policy.evaluateModelAccess(context, m)), policyEnforced: true, paidAiEnabled: false }));
    }
    res.statusCode = 404; res.end("{}");
  });
  const omniAsked = [];
  const omni = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [
      { id: "Ai principal", owned_by: "combo" }, { id: "Gratuit", owned_by: "combo" }, { id: "auto/fast", owned_by: "combo" },
      { id: "cx/gpt-5.5", owned_by: "codex" }, { id: "cc/claude-sonnet-4.6", owned_by: "claude" }, { id: "gh/gpt-5", owned_by: "github" },
      { id: "github/gpt-4.1", owned_by: "github" }, { id: "kr/claude-sonnet-4.5", owned_by: "kiro" }, { id: "grok-web/grok-4", owned_by: "grok-web" },
      { id: "gemini/gemini-2.5-flash", owned_by: "gemini" }, { id: "groq/llama-3.3-70b-versatile", owned_by: "groq" },
      { id: "openrouter/meta-llama/llama-3.3-70b-instruct:free", owned_by: "openrouter" }, { id: "pol/openai", owned_by: "pollinations" },
      { id: "openai/gpt-5", owned_by: "openai" }
    ] }));
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      const j = await body(req); omniAsked.push(j.model);
      return res.end(JSON.stringify(answer("omni " + j.model)));
    }
    res.statusCode = 404; res.end("{}");
  });
  const [cloudPort, omniPort] = [await listen(cloud), await listen(omni)];
  const cfg = {
    baseUrl: `http://127.0.0.1:${omniPort}/v1`, controlApiUrl: `http://127.0.0.1:${cloudPort}`, apiKey: "sk-omni", model: "",
    webSearchEnabled: false, githubAutoContext: false, sharedCombos: "Gratuit",
    mistralApiKey: "mk-test", githubToken: "ghp-test", openAiApiKey: "sk-openai", directChatCostPolicy: "allow_paid", blockedProviders: "cerebras"
  };
  const direct = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    const model = (() => { try { return JSON.parse(init?.body || "{}").model; } catch { return ""; } })();
    if (u === "https://api.mistral.ai/v1/chat/completions") { direct.push("mistral/" + model); return json(answer("mistral " + model)); }
    if (u === "https://models.github.ai/inference/chat/completions") { direct.push("github/" + model); return json(answer("github " + model)); }
    if (u === "https://api.openai.com/v1/chat/completions") { direct.push("openai/" + model); return json(answer("openai " + model)); }
    return new Response("{}", { status: 503 });
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-shared-access-"));
  const gw = startLocalGateway({ dataDir: dir, port: 8879, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8879";
  const call = (p, token, payload) => realFetch(base + p, { method: payload ? "POST" : "GET", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: payload ? JSON.stringify(payload) : undefined });
  const chat = async (token, model) => { const r = await call("/api/chat", token, { model, messages: [{ role: "user", content: "Salut" }] }); const j = await r.json(); return { status: r.status, text: j?.choices?.[0]?.message?.content || "", error: j?.error || "" }; };
  try {
    // A normal account: the free models of OmniRoute, the shared combination and the free direct APIs.
    let r = await call("/api/models", "normal-token");
    const listed = await r.json();
    let ids = listed.data.map((x) => typeof x === "string" ? x : x.id);
    for (const id of ["Gratuit", "gemini/gemini-2.5-flash", "groq/llama-3.3-70b-versatile", "openrouter/meta-llama/llama-3.3-70b-instruct:free", "pol/openai", "mistral/mistral-small-latest", "github/openai/gpt-4.1"])
      expect(ids.includes(id), `a normal account must see ${id}: ${ids.join(", ")}`);
    for (const id of ["Ai principal", "auto/fast", "cx/gpt-5.5", "cc/claude-sonnet-4.6", "gh/gpt-5", "github/gpt-4.1", "kr/claude-sonnet-4.5", "grok-web/grok-4", "openai/gpt-5", "openai/gpt-5-mini"])
      expect(!ids.includes(id), `a normal account must not be able to pick ${id}: ${ids.join(", ")}`);
    // …but it sees them, locked, each with the reason.
    const locked = new Map((listed.locked || []).map((x) => [x.id, x.reason]));
    for (const [id, why] of [["Ai principal", /abonamentele Owner-ului/], ["auto/fast", /abonamentele Owner-ului/], ["cx/gpt-5.5", /abonamentul personal/], ["gh/gpt-5", /abonamentul personal/],
      ["github/gpt-4.1", /abonamentul personal/], ["grok-web/grok-4", /abonamentul personal/], ["openai/gpt-5", /plătit/], ["openai/gpt-5-mini", /plătit/]])
      expect(why.test(locked.get(id) || ""), `${id} must be listed locked with its reason: ` + JSON.stringify(listed.locked));
    expect(!ids.some((id) => locked.has(id)), "a model is either usable or locked, never both");

    let out = await chat("normal-token", "mistral/mistral-small-latest");
    expect(out.status === 200 && out.text === "mistral mistral-small-latest" && omniAsked.length === 0, "a free direct API answers a normal account: " + JSON.stringify(out));
    out = await chat("normal-token", "github/openai/gpt-4.1");
    expect(out.status === 200 && out.text === "github openai/gpt-4.1", "GitHub Models (free) answers a normal account: " + JSON.stringify(out));
    out = await chat("normal-token", "gemini/gemini-2.5-flash");
    expect(out.status === 200 && omniAsked.at(-1) === "gemini/gemini-2.5-flash", "a free OmniRoute model answers a normal account: " + JSON.stringify(out));
    out = await chat("normal-token", "Gratuit");
    expect(out.status === 200 && omniAsked.at(-1) === "Gratuit", "the shared combination answers a normal account: " + JSON.stringify(out));
    const asked = omniAsked.length;
    for (const [model, why] of [["Ai principal", /abonamentele Owner-ului/], ["cx/gpt-5.5", /abonamentul personal/], ["github/gpt-4.1", /abonamentul personal/], ["kr/claude-sonnet-4.5", /abonamentul personal/], ["openai/gpt-5", /plătit/]]) {
      out = await chat("normal-token", model);
      expect(out.status === 403 && /nu îți este permis de Owner/.test(out.error) && why.test(out.error), `${model} must be refused for a normal account: ` + JSON.stringify(out));
    }
    expect(omniAsked.length === asked && !direct.some((x) => x.startsWith("openai/")), "nothing refused may reach OmniRoute or OpenAI: " + JSON.stringify({ omniAsked, direct }));

    // No model chosen and no combination shared: the free direct APIs answer, never the Owner's combination.
    cfg.sharedCombos = "";
    out = await chat("normal-token", "");
    expect(out.status === 200 && /^(mistral|github) /.test(out.text) && omniAsked.length === asked, "no model: a free direct API answers: " + JSON.stringify(out));
    ids = (await (await call("/api/models", "normal-token")).json()).data.map((x) => typeof x === "string" ? x : x.id);
    expect(!ids.includes("Gratuit"), "a combination no longer shared leaves the list");
    cfg.sharedCombos = "Gratuit";

    // The Owner keeps everything: his subscriptions, every combination and the paid direct APIs.
    const ownerList = await (await call("/api/models", "owner-token")).json();
    ids = ownerList.data.map((x) => typeof x === "string" ? x : x.id);
    expect(!(ownerList.locked || []).length, "nothing is locked for the Owner: " + JSON.stringify(ownerList.locked));
    for (const id of ["Ai principal", "cx/gpt-5.5", "gh/gpt-5", "github/gpt-4.1", "openai/gpt-5", "openai/gpt-5-mini", "mistral/mistral-small-latest"])
      expect(ids.includes(id), `the Owner must see ${id}: ${ids.join(", ")}`);
    out = await chat("owner-token", "cx/gpt-5.5");
    expect(out.status === 200 && omniAsked.at(-1) === "cx/gpt-5.5", "the Owner uses his subscription: " + JSON.stringify(out));
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); cloud.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // The two lists of personal subscriptions (site policy and gateway) are the same; the setting reaches the site.
  const src = fs.readFileSync(path.join(__dirname, "..", "local-gateway.cjs"), "utf8");
  const list = (name) => JSON.parse("[" + src.match(new RegExp(name + "=new Set\\(\\[([\\s\\S]*?)\\]\\)"))[1] + "]");
  expect(JSON.stringify(list("PERSONAL_PREFIXES")) === JSON.stringify(policy.PERSONAL_PREFIXES), "PERSONAL_PREFIXES differ between local-gateway.cjs and apps/server/ai-policy.cjs");
  expect(JSON.stringify(list("KEYLESS_PREFIXES")) === JSON.stringify(policy.KEYLESS_PREFIXES), "KEYLESS_PREFIXES differ between local-gateway.cjs and apps/server/ai-policy.cjs");
  const repo = path.join(__dirname, "..", "..", "..");
  const { EDITABLE } = require("../lib/serversettings.cjs");
  expect(EDITABLE.includes("sharedCombos"), "the Owner can share combinations from the site");
  expect(/sharedCombos:[^\n]*AI_STOICA_SHARED_COMBOS/.test(fs.readFileSync(path.join(repo, "apps", "cloud", "server.cjs"), "utf8")), "apps/cloud reads AI_STOICA_SHARED_COMBOS");
  for (const f of [["apps", "cloud", "docker-compose.yml"], ["deploy", "hetzner", "docker-compose.yml"]])
    expect(fs.readFileSync(path.join(repo, ...f), "utf8").includes("AI_STOICA_SHARED_COMBOS: ${AI_STOICA_SHARED_COMBOS-}"), f.join("/") + " passes AI_STOICA_SHARED_COMBOS");
  const ui = fs.readFileSync(path.join(__dirname, "..", "renderer", "src", "main.jsx"), "utf8");
  expect(/function SharedCombos/.test(ui), "Settings show «Combinații pentru toate conturile»");
  expect(ui.includes("locked={lockedModels}") && ui.includes('className="modelOption locked" onClick={()=>notAllowed(x)}') && ui.includes("nu îți este permis de Owner"), "the model list shows the locked models and says why when one is chosen");
  console.log("0.7.16 free models for every account, the Owner's subscriptions his alone OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
