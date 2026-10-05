// 0.7.14: OmniRoute 3.8 (client API key, combinations marked owned_by "combo", key test) and providers whose
// credits ran out being skipped for the next image/answer instead of being tried first every time.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-0714-"));
  // OmniRoute 3.8 stand-in: every /v1 route needs the client key, combinations are owned_by "combo".
  const omniSeen = [];
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization !== "Bearer sk-omni-good") { res.statusCode = 401; return res.end(JSON.stringify({ error: { code: "AUTH_002", message: "Authentication required" } })); }
      if (req.url === "/v1/models") return res.end(JSON.stringify({ object: "list", data: [
        { id: "auto/best-coding", owned_by: "combo" }, { id: "Ai principal", owned_by: "combo" },
        { id: "groq/llama-3.3-70b-versatile", owned_by: "groq" }, { id: "openai/gpt-5", owned_by: "openai" }
      ] }));
      if (req.url === "/v1/chat/completions") { omniSeen.push(JSON.parse(body).model); return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Răspuns prin OmniRoute" } }] })); }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "", model: "", imageProviders: "", videoProviders: "", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false,
    openAiApiKey: "sk-openai-test", openRouterApiKey: "sk-or-test", pollinationsFreeEnabled: false, imageProviderOrder: "openai,openrouter", imageCostPolicy: "allow_paid" };
  const calls = { openai: 0, openrouter: 0, cerebras: 0, groq: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://api.openai.com/v1/images")) { calls.openai++; return new Response(JSON.stringify({ error: { message: "You exceeded your current quota, please check your plan and billing details.", code: "insufficient_quota" } }), { status: 402, headers: { "content-type": "application/json" } }); }
    if (u.startsWith("https://openrouter.ai/api/v1/images")) { calls.openrouter++; return new Response(png, { status: 200, headers: { "content-type": "image/png" } }); }
    if (u === "https://api.cerebras.ai/v1/chat/completions") { calls.cerebras++; return new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), { status: 402, headers: { "content-type": "application/json" } }); }
    if (u === "https://api.groq.com/openai/v1/chat/completions") { calls.groq++; return new Response(JSON.stringify({ choices: [{ message: { content: "GROQ_OK" } }] }), { status: 200, headers: { "content-type": "application/json" } }); }
    return realFetch(url, init);
  };
  const gw = startLocalGateway({ dataDir: dir, port: 8873, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8873";
  const call = (p, { method = "GET", body, token } = {}) => realFetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    let r = await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } });
    const token = (await r.json()).token; expect(token, "register failed");

    // Without the client key OmniRoute is running but refuses: say so, do not call it "stopped".
    let h = await (await call("/health")).json();
    expect(h.omni === false && h.omniNeedsKey === true, "health must report that OmniRoute needs its API key: " + JSON.stringify(h));
    r = await call("/api/models", { token });
    let j = await r.json();
    expect(r.status === 502 && /cere cheia API/.test(j.error) && /API Manager/.test(j.error), "models without key must explain the OmniRoute key: " + JSON.stringify(j));

    cfg.apiKey = "sk-omni-good"; await wait(2100); // the gateway re-reads its configuration every 2 seconds
    h = await (await call("/health")).json();
    expect(h.omni === true && h.omniNeedsKey === false, "health with key: " + JSON.stringify(h));
    j = await (await call("/api/models", { token })).json();
    const ids = j.data.map((x) => x.id);
    expect(["auto/best-coding", "Ai principal", "groq/llama-3.3-70b-versatile", "openai/gpt-5"].every((x) => ids.includes(x)), "free, paid and combination models must all be listed: " + ids);
    expect(JSON.stringify(j.combos) === JSON.stringify(["Ai principal", "auto/best-coding"]), "OmniRoute combinations (owned_by combo, auto/* too) must be marked, your own first: " + JSON.stringify(j.combos));
    expect(ids[0] === "Ai principal", "your own combination must come first (default pick): " + ids[0]);

    r = await call("/api/providers/test", { method: "POST", token, body: {} });
    j = await r.json();
    expect(j.omni && j.omni.ok && j.omni.models === 4 && j.omni.combos === 2, "key test must include OmniRoute: " + JSON.stringify(j.omni));

    r = await call("/api/chat", { method: "POST", token, body: { model: "Ai principal", messages: [{ role: "user", content: "salut" }] } });
    j = await r.json();
    expect(r.status === 200 && omniSeen.includes("Ai principal"), "chat through the OmniRoute combination failed: " + JSON.stringify(j));

    // Images: OpenAI has no credits left (402) → OpenRouter makes the image; the next image skips OpenAI.
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "un logo albastru" } });
    j = await r.json();
    expect(r.status === 200 && calls.openai === 1 && calls.openrouter === 1, "first image must fall through to the next provider: " + JSON.stringify({ status: r.status, calls, j }).slice(0, 400));
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "un logo verde" } });
    expect(r.status === 200 && calls.openai === 1 && calls.openrouter === 2, "a provider without credits must not be tried first again: " + JSON.stringify(calls));
    // Chat on direct APIs: Cerebras out of credits (402) → Groq answers; the next message skips Cerebras.
    Object.assign(cfg, { baseUrl: "http://127.0.0.1:9/v1", directChatEnabled: true, directChatProviderOrder: "cerebras,groq", blockedProviders: "", cerebrasApiKey: "k1", groqApiKey: "k2" });
    await wait(2100);
    for (const n of [1, 2]) {
      r = await call("/api/chat", { method: "POST", token, body: { model: "", messages: [{ role: "user", content: "salut " + n }] } });
      j = await r.json();
      expect(r.status === 200 && j.choices?.[0]?.message?.content === "GROQ_OK", "chat must fall through to Groq: " + JSON.stringify(j).slice(0, 300));
    }
    expect(calls.cerebras === 1 && calls.groq === 2, "a chat provider without credits must not be tried first again: " + JSON.stringify(calls));
    console.log("0.7.14 OmniRoute and media fallback checks OK");
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
