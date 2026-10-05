// 0.7.16, at the Owner's request: "Code AI Stoica" with Codex and Claude Code. The Owner codes with the subscriptions
// connected in OmniRoute; another account gets Code only when the Owner gives it "code", and then only through the paid
// APIs (OpenAI / Claude), never through the Owner's subscriptions.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const OMNI_MODELS = ["Ai principal", "cx/gpt-5.6-codex", "cc/claude-sonnet-4.6", "openai/gpt-5.6", "anthropic/claude-sonnet-4.6", "groq/llama-x"];

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-code-"));
  const omni = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: OMNI_MODELS.map((id) => ({ id, owned_by: id.includes("/") ? id.split("/")[0] : "combo" })) }));
    res.statusCode = 404; res.end("{}");
  });
  const omniPort = await listen(omni);
  // AI Stoica Cloud stand-in: one account the Owner gave Code to, one without it.
  const cloud = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (req.url === "/auth/me") {
        const users = { "granted-token": { id: "u-granted", email: "ana@example.com", code: true }, "plain-token": { id: "u-plain", email: "ion@example.com", code: false } };
        const u = users[token]; if (!u) { res.statusCode = 401; return res.end("{}"); }
        return res.end(JSON.stringify({ user: { id: u.id, email: u.email, name: u.email, role: "user", status: "active" }, permissions: { chat: true, openai: true, anthropic: true, code: u.code } }));
      }
      if (req.url === "/api/ai/access") { const b = JSON.parse(body || "{}"); const models = Array.isArray(b.models) ? b.models : [b.model]; return res.end(JSON.stringify({ data: models.map((model) => ({ model, allowed: true })), policyEnforced: true })); }
      res.statusCode = 404; res.end("{}");
    });
  });
  const cloudPort = await listen(cloud);
  const base = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "sk-omni", model: "", webSearchEnabled: false, githubAutoContext: false, githubRepo: "andrei/proiect", directChatEnabled: false };
  const localCfg = { ...base, ownerEmail: "owner@example.com" };
  const local = startLocalGateway({ dataDir: path.join(root, "local"), port: 8881, host: "127.0.0.1", getOmniConfig: () => localCfg });
  const web = startLocalGateway({ dataDir: path.join(root, "web"), port: 8882, host: "127.0.0.1", getOmniConfig: () => ({ ...base, controlApiUrl: `http://127.0.0.1:${cloudPort}` }) });
  const call = (port, p, token, method = "GET", body) => fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const register = async (email) => (await (await call(8881, "/auth/register", null, "POST", { email, password: "password123", name: email })).json()).token;
  try {
    const owner = await register("owner@example.com"), other = await register("maria@example.com");

    // The Owner: Codex and Claude Code from the subscriptions, plus the APIs.
    let r = await call(8881, "/api/code", owner); let j = await r.json();
    const ids = (j.data.models || []).map((m) => m.id);
    expect(j.data.allowed && j.data.subscriptions && j.data.repo === "andrei/proiect", "the Owner has Code: " + JSON.stringify(j));
    expect(ids.includes("cx/gpt-5.6-codex") && ids.includes("cc/claude-sonnet-4.6") && ids.includes("openai/gpt-5.6") && ids.includes("anthropic/claude-sonnet-4.6") && !ids.includes("groq/llama-x") && !ids.includes("Ai principal"), "the Owner's code models: " + ids.join(", "));
    expect(j.data.models.find((m) => m.id === "cx/gpt-5.6-codex").group === "codex" && j.data.models.find((m) => m.id === "cc/claude-sonnet-4.6").group === "claude-code", "Codex and Claude Code groups");
    r = await call(8881, "/auth/me", owner); j = await r.json();
    expect(j.permissions.code === true, "the Owner's permissions include Code");

    // A Code session: the "AI Stoica Code" assistant (made once) and the chosen model.
    r = await call(8881, "/api/code/session", owner, "POST", { model: "cc/claude-sonnet-4.6" }); j = await r.json();
    expect(r.status === 200 && j.data.model === "cc/claude-sonnet-4.6" && j.assistant?.codeAssistant && /AI Stoica Code/.test(j.assistant.systemPrompt) && j.data.assistantId === j.assistant.id, "Code session: " + JSON.stringify(j).slice(0, 300));
    const firstAssistant = j.assistant.id;
    r = await call(8881, "/api/code/session", owner, "POST", { model: "cx/gpt-5.6-codex" }); j = await r.json();
    expect(j.assistant.id === firstAssistant, "the Code assistant is made once per account");
    r = await call(8881, "/api/code/session", owner, "POST", { model: "groq/llama-x" });
    expect(r.status === 400, "only code models start a Code session: " + r.status);

    // Another account on a PC with an Owner email: no Code.
    r = await call(8881, "/api/code", other); j = await r.json();
    expect(j.data.allowed === false, "another local account must not have Code");
    r = await call(8881, "/api/code/session", other, "POST", { model: "openai/gpt-5.6" });
    expect(r.status === 403, "another local account must not start Code: " + r.status);
    r = await call(8881, "/auth/me", other); j = await r.json();
    expect(j.permissions.code === false, "and its permissions say so");

    // A provider left out in Settings disappears from Code too.
    localCfg.blockedProviders = "anthropic"; await new Promise((x) => setTimeout(x, 2100));
    r = await call(8881, "/api/code", owner); j = await r.json();
    expect(!j.data.models.some((m) => /^(cc|anthropic)\//.test(m.id)), "Claude left out: no Claude Code either");
    delete localCfg.blockedProviders;

    // Site with accounts (Cloud): Code given by the Owner = the APIs only; without it, nothing.
    r = await call(8882, "/api/code", "granted-token"); j = await r.json();
    const webIds = (j.data.models || []).map((m) => m.id);
    expect(j.data.allowed && j.data.subscriptions === false && webIds.includes("openai/gpt-5.6") && webIds.includes("anthropic/claude-sonnet-4.6") && !webIds.some((id) => /^(cx|cc)\//.test(id)), "an account given Code gets only the APIs: " + JSON.stringify(j));
    r = await call(8882, "/api/code/session", "granted-token", "POST", { model: "cx/gpt-5.6-codex" });
    expect(r.status === 400, "it cannot start Code on the Owner's subscription: " + r.status);
    r = await call(8882, "/api/code/session", "granted-token", "POST", { model: "anthropic/claude-sonnet-4.6" });
    expect(r.status === 200, "it can on the Claude API: " + r.status);
    r = await call(8882, "/api/chat", "granted-token", "POST", { model: "cc/claude-sonnet-4.6", messages: [{ role: "user", content: "salut" }] });
    expect(r.status === 403, "and the chat refuses the subscription model: " + r.status);
    r = await call(8882, "/api/code", "plain-token"); j = await r.json();
    expect(j.data.allowed === false, "an account without Code does not get it");
    r = await call(8882, "/auth/me", "plain-token"); j = await r.json();
    expect(j.permissions.code === false, "Code is opt-in, not on by default: " + JSON.stringify(j.permissions));
  } finally {
    await local.close(); await web.close(); omni.close(); cloud.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("0.7.16 Code AI Stoica OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
