// 0.7.17: on the web server (accounts in apps/server) every approved account uses everything free — the free direct APIs
// too — while GPT and Claude (paid) need paid access: bought, or offered by the Owner with the button. The Owner has
// everything. The access decision is apps/server's own policy (ai-policy.cjs), as in production.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");
const { evaluateModelAccess } = require("../../server/ai-policy.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const body = async (req) => { let b = ""; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const DEFAULTS = { chat: true, cerebras: true, gemini: true, groq: true, cloudflare: true, openrouter: false, image_generation: true, video_generation: true, openai: false, anthropic: false };
const ACCOUNTS = {
  "free-token": { user: { id: "u-free", email: "free@example.com", name: "Free", role: "user", status: "active", paidAccess: false } },
  "paid-token": { user: { id: "u-paid", email: "paid@example.com", name: "Paid", role: "user", status: "active", paidAccess: true } },
  "owner-token": { user: { id: "u-owner", email: "owner@example.com", name: "Owner", role: "owner", status: "active", paidAccess: true } }
};

async function main() {
  const cloud = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    const account = ACCOUNTS[String(req.headers.authorization || "").replace(/^Bearer /, "")];
    if (!account) { res.statusCode = 401; return res.end(JSON.stringify({ error: "bad token" })); }
    if (req.url === "/auth/me") return res.end(JSON.stringify({ user: account.user, permissions: DEFAULTS }));
    if (req.url === "/api/ai/access" && req.method === "POST") {
      const b = await body(req), models = Array.isArray(b.models) ? b.models : [b.model];
      const context = { user: { role: account.user.role }, paidEnabled: false, personalPaid: account.user.paidAccess && account.user.role !== "owner", permissions: DEFAULTS, combinations: [] };
      return res.end(JSON.stringify({ data: models.filter(Boolean).map((m) => evaluateModelAccess(context, m)), policyEnforced: true }));
    }
    res.statusCode = 404; res.end("{}");
  });
  const cloudPort = await listen(cloud);
  const omni = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "groq/llama-omni", owned_by: "groq" }, { id: "openai/gpt-5", owned_by: "openai" }] }));
    if (req.url === "/v1/chat/completions") { const b = await body(req); return res.end(JSON.stringify({ choices: [{ message: { content: "OMNI " + b.model } }] })); }
    res.statusCode = 404; res.end("{}");
  });
  const omniPort = await listen(omni);

  const cfg = {
    baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "sk-omni", controlApiUrl: `http://127.0.0.1:${cloudPort}`, model: "",
    webSearchEnabled: false, githubAutoContext: false, directChatEnabled: true, directChatCostPolicy: "allow_paid",
    directChatProviderOrder: "groq,openai", groqApiKey: "k-groq", groqModel: "llama-direct", openAiApiKey: "sk-openai", openAiChatModels: "gpt-4.1",
    imageCostPolicy: "allow_paid", imageProviderOrder: "openai", pollinationsFreeEnabled: true
  };
  const calls = { groq: 0, openaiChat: 0, openaiImage: 0, pollinations: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u === "https://api.groq.com/openai/v1/chat/completions") { calls.groq++; return new Response(JSON.stringify({ choices: [{ message: { content: "GROQ " + JSON.parse(init.body).model } }] }), { status: 200, headers: { "content-type": "application/json" } }); }
    if (u === "https://api.openai.com/v1/chat/completions") { calls.openaiChat++; return new Response(JSON.stringify({ choices: [{ message: { content: "OPENAI " + JSON.parse(init.body).model } }] }), { status: 200, headers: { "content-type": "application/json" } }); }
    if (u.startsWith("https://api.openai.com/v1/images")) { calls.openaiImage++; return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200, headers: { "content-type": "application/json" } }); }
    if (u.startsWith("https://image.pollinations.ai/")) { calls.pollinations++; return new Response(png, { status: 200, headers: { "content-type": "image/png" } }); }
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    return new Response("{}", { status: 503 });
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-0717-"));
  const gw = startLocalGateway({ dataDir: dir, port: 8875, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8875";
  const call = (p, token, payload) => realFetch(base + p, { method: payload ? "POST" : "GET", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
  const chat = (token, model) => call("/api/chat", token, { model, messages: [{ role: "user", content: "salut" }] });
  const ids = async (token) => ((await (await call("/api/models", token)).json()).data || []).map((x) => x.id || x);
  try {
    await new Promise((r) => setTimeout(r, 150));

    // A free account: the free direct APIs (Groq) and OmniRoute's free models, never GPT or Claude.
    let list = await ids("free-token");
    expect(list.includes("groq/llama-direct") && list.includes("groq/llama-omni"), "a free account must see the free models, direct ones too: " + list);
    expect(!list.some((m) => /^openai\//.test(m)), "a free account must not see paid models: " + list);
    let r = await chat("free-token", "groq/llama-direct"); let j = await r.json();
    expect(r.status === 200 && j.choices[0].message.content === "GROQ llama-direct" && calls.groq === 1, "a free account must chat with a free direct API: " + JSON.stringify(j));
    r = await chat("free-token", "openai/gpt-4.1"); j = await r.json();
    expect(r.status === 403 && /abonament sau acces oferit de Owner/.test(j.error) && calls.openaiChat === 0, "a free account must not use paid GPT: " + JSON.stringify(j));
    r = await chat("free-token", "openai/gpt-5"); j = await r.json();
    expect(r.status === 403, "nor GPT through OmniRoute: " + JSON.stringify(j));
    r = await call("/api/generate/image", "free-token", { prompt: "un logo" }); j = await r.json();
    expect(r.status === 200 && calls.openaiImage === 0 && calls.pollinations === 1, "a free account's images come from the free providers only: " + JSON.stringify({ status: r.status, calls, j }).slice(0, 300));

    // Paid access (bought, or offered by the Owner): GPT too, direct and through OmniRoute.
    list = await ids("paid-token");
    expect(list.includes("openai/gpt-4.1") && list.includes("openai/gpt-5") && list.includes("groq/llama-direct"), "paid access must list GPT as well as the free models: " + list);
    r = await chat("paid-token", "openai/gpt-4.1"); j = await r.json();
    expect(r.status === 200 && j.choices[0].message.content === "OPENAI gpt-4.1" && calls.openaiChat === 1, "paid access must chat with GPT: " + JSON.stringify(j));
    r = await chat("paid-token", "openai/gpt-5"); j = await r.json();
    expect(r.status === 200 && j.choices[0].message.content === "OMNI openai/gpt-5", "paid access must use GPT through OmniRoute: " + JSON.stringify(j));
    r = await call("/api/generate/image", "paid-token", { prompt: "un logo" });
    expect(r.status === 200 && calls.openaiImage === 1, "paid access may use the paid image API: " + JSON.stringify(calls));

    // The Owner: everything.
    r = await chat("owner-token", "openai/gpt-4.1");
    expect(r.status === 200 && calls.openaiChat === 2, "the Owner has everything");
    console.log("0.7.17 free / paid access checks OK");
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); omni.close(); cloud.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
