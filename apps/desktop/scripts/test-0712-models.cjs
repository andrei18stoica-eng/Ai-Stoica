// 0.7.12: every model of every configured provider and every OmniRoute combination is listed and usable.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");
const { DIRECT_MODEL_DEFAULTS, upgradeModelDefaults, PROVIDER_KEY_PAGES } = require("../lib/providers.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

async function main() {
  // Old single-model defaults are upgraded; a model the user chose is kept.
  const up = upgradeModelDefaults({ nvidiaModel: "meta/llama-3.3-70b-instruct", groqModel: "modelul-meu", cerebrasModel: "" });
  expect(up.nvidiaModel === DIRECT_MODEL_DEFAULTS.nvidiaModel, "old NVIDIA default must be upgraded");
  expect(!("groqModel" in up), "a model chosen by the user must be kept");
  expect(up.cerebrasModel === DIRECT_MODEL_DEFAULTS.cerebrasModel, "empty model field must get the default list");
  for (const id of ["cerebras", "groq", "gemini", "mistral", "nvidia", "github", "openrouter", "cloudflare", "cohere", "huggingface", "openai"]) {
    expect(/^https:\/\//.test(PROVIDER_KEY_PAGES[id] || ""), "missing key page for " + id);
  }

  const asked = [];
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "Ai principal" }, { id: "combo-rapid" }, { id: "groq/llama-3.3-70b-versatile" }] }));
      if (req.url.endsWith("/chat/completions")) { const j = JSON.parse(body || "{}"); asked.push(j.model); return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK " + j.model } }] })); }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-0712-"));
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, model: "", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: true, groqApiKey: "gsk-test", nvidiaApiKey: "nvapi-test" };
  const port = 8861, base = "http://127.0.0.1:" + port;
  const gw = startLocalGateway({ dataDir: dir, port, host: "127.0.0.1", getOmniConfig: () => cfg });
  try {
    await new Promise((r) => setTimeout(r, 150));
    let r = await fetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "m@example.com", password: "parola-buna-1" }) });
    let j = await r.json(); expect(r.ok, "register: " + j.error);
    const H = { authorization: "Bearer " + j.token, "content-type": "application/json" };

    r = await fetch(base + "/api/models", { headers: H }); j = await r.json();
    expect(r.ok, "models: " + j.error);
    const ids = (j.data || []).map((x) => typeof x === "string" ? x : x.id);
    for (const want of ["Ai principal", "combo-rapid", "groq/llama-3.3-70b-versatile", "groq/openai/gpt-oss-120b", "groq/qwen/qwen3.8-27b", "nvidia/deepseek-ai/deepseek-v4.1-flash", "nvidia/moonshotai/kimi-k2.6"]) {
      expect(ids.includes(want), "model list must include " + want + " — got " + ids.join(", "));
    }
    expect(!ids.some((x) => x.startsWith("cerebras/")), "providers without a key must not be listed");
    expect((j.data || []).find((x) => x.id === "combo-rapid")?.kind === "combo", "combinations must be marked");

    r = await fetch(base + "/api/chat", { method: "POST", headers: H, body: JSON.stringify({ model: "Ai principal", messages: [{ role: "user", content: "salut" }] }) });
    j = await r.json();
    expect(r.ok && asked.includes("Ai principal"), "choosing the 'Ai principal' combination must send it to OmniRoute: " + JSON.stringify(j).slice(0, 200));
    r = await fetch(base + "/api/chat", { method: "POST", headers: H, body: JSON.stringify({ model: "combo-rapid", messages: [{ role: "user", content: "salut" }] }) });
    expect(r.ok && asked.includes("combo-rapid"), "any OmniRoute combination must be usable");
    console.log("MODELS_0712_TESTS_PASSED");
  } finally {
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
