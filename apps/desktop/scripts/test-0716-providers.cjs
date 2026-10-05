// 0.7.16, at the Owner's request: Cerebras is left out of the chat unless turned back on (Settings → API-uri AI →
// "Furnizori folosiți"), any provider can be left out the same way, and Grok (xAI) works as a direct API for chat,
// pictures and video. Pictures also come from Gemini ("Nano Banana") and video from OpenAI Sora.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const mp4 = Buffer.concat([Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex"), Buffer.alloc(64)]);
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-providers-"));
  const omniAsked = [];
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization !== "Bearer sk-omni") { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: "Invalid API key" } })); }
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [
        { id: "Ai principal", owned_by: "combo" }, { id: "cerebras/gpt-oss-120b", owned_by: "cerebras" },
        { id: "openai/gpt-4o-mini", owned_by: "openai" }, { id: "groq/llama-omni", owned_by: "groq" }, { id: "broken/model", owned_by: "broken" },
        { id: "gc/grok-4.6-low", owned_by: "grok-build" }, { id: "gc/gemini-3-pro", owned_by: "gemini-cli" }, { id: "anthropic/claude-x", owned_by: "anthropic" }
      ] }));
      const j = body ? JSON.parse(body) : {};
      if (req.url === "/v1/chat/completions") {
        omniAsked.push(j.model);
        if (j.model === "broken/model") { res.statusCode = 500; return res.end(JSON.stringify({ error: { message: "down" } })); }
        // What OmniRoute 3.8 answers when a subscription login expired, and when a provider refuses its API key.
        if (j.model === "gc/grok-4.6-low") { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: "gc/grok-4.6-low: auth — [grok-cli] All 1 connection(s) authentication expired — please reconnect in the dashboard (HTTP 401)" } })); }
        if (j.model === "anthropic/claude-x") { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: "invalid x-api-key" } })); }
        return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OMNI " + j.model } }] }));
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  const cfg = {
    baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "sk-omni", model: "", webSearchEnabled: false, githubAutoContext: false, ownerEmail: "owner@example.com",
    directChatEnabled: true, directChatCostPolicy: "allow_paid", directChatProviderOrder: "cerebras,groq,xai",
    cerebrasApiKey: "k-cerebras", groqApiKey: "k-groq", xaiApiKey: "xai-test", openAiApiKey: "sk-openai-test", geminiApiKey: "AIza-test",
    pollinationsFreeEnabled: false, imageCostPolicy: "allow_paid", videoCostPolicy: "allow_paid"
  };
  const calls = { cerebras: 0, groq: 0, xaiChat: [], xaiImage: [], geminiImage: [], xaiVideo: 0, xaiPoll: 0, sora: [], soraPoll: 0, soraContent: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url), body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    if (u === "https://api.cerebras.ai/v1/chat/completions") { calls.cerebras++; return json({ choices: [{ message: { content: "CEREBRAS" } }] }); }
    if (u === "https://api.groq.com/openai/v1/chat/completions") { calls.groq++; return json({ choices: [{ message: { content: "GROQ " + body.model } }] }); }
    // OpenAI answers 429 "insufficient_quota" when the account has no credit (not a daily limit).
    if (u === "https://api.openai.com/v1/chat/completions") return json({ error: { message: "You have no credits remaining. Add credits to continue using the API.", type: "insufficient_quota" } }, 429);
    if (u === "https://api.x.ai/v1/chat/completions") { calls.xaiChat.push(body.model); return json({ model: body.model, choices: [{ message: { content: "GROK " + body.model } }] }); }
    if (u === "https://api.x.ai/v1/images/generations") { calls.xaiImage.push(body); return json({ data: [{ b64_json: png.toString("base64") }] }); }
    if (u.startsWith("https://generativelanguage.googleapis.com/v1beta/models/") && u.endsWith(":generateContent")) {
      const model = decodeURIComponent(u.split("/models/")[1].split(":")[0]); calls.geminiImage.push(model);
      if (model === "missing-model") return json({ error: { message: "not found" } }, 404);
      return json({ candidates: [{ content: { parts: [{ text: "iată" }, { inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] });
    }
    if (u === "https://api.x.ai/v1/videos/generations") { calls.xaiVideo++; expect(body.model === "grok-imagine-video", "Grok video model"); return json({ request_id: "req-1" }); }
    if (u === "https://api.x.ai/v1/videos/req-1") { calls.xaiPoll++; return json({ status: "done", video: { url: "https://vidgen.x.ai/test.mp4", duration: 5 } }); }
    if (u === "https://vidgen.x.ai/test.mp4") return new Response(mp4, { status: 200, headers: { "content-type": "video/mp4" } });
    if (u === "https://api.openai.com/v1/videos") { calls.sora.push(body); return json({ id: "video_1", status: "queued" }); }
    if (u === "https://api.openai.com/v1/videos/video_1") { calls.soraPoll++; return json({ id: "video_1", status: "completed" }); }
    if (u === "https://api.openai.com/v1/videos/video_1/content") { calls.soraContent++; expect(/Bearer sk-openai-test/.test(init?.headers?.Authorization || ""), "Sora download needs the key"); return new Response(mp4, { status: 200, headers: { "content-type": "video/mp4" } }); }
    return new Response("{}", { status: 503 });
  };
  const gw = startLocalGateway({ dataDir: dir, port: 8878, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8878";
  const call = (p, { method = "GET", body, token } = {}) => realFetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const wait = () => new Promise((x) => setTimeout(x, 2100)); // the gateway caches the model list for 2 s
  try {
    let r = await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } });
    const token = (await r.json()).token; expect(token, "register failed");
    const ids = async () => (await (await call("/api/models", { token })).json()).data.map((x) => typeof x === "string" ? x : x.id);
    const chat = (model) => call("/api/chat", { method: "POST", token, body: { model, messages: [{ role: "user", content: "salut" }] } });

    // Cerebras is out by default: neither OmniRoute's Cerebras models nor the direct Cerebras API are listed.
    let list = await ids();
    expect(!list.some((id) => /^cerebras\//i.test(id)), "Cerebras must not be listed by default: " + list.join(", "));
    expect(list.includes("Ai principal") && list.includes("openai/gpt-4o-mini") && list.includes("groq/llama-omni"), "the other models stay: " + list.join(", "));
    expect(list.includes("xai/grok-4.6") && list.includes("xai/grok-4.3"), "Grok models are listed with an xAI key: " + list.join(", "));

    // Chosen anyway (an old conversation): refused with the reason, not answered by something else.
    r = await chat("cerebras/gpt-oss-120b"); let j = await r.json();
    expect(r.status === 403 && /Furnizori folosiți/.test(j.error) && calls.cerebras === 0, "a Cerebras model must be refused: " + JSON.stringify({ status: r.status, j }));

    // Grok answers when chosen, through api.x.ai, with the model name without the prefix.
    r = await chat("xai/grok-4.6"); j = await r.json();
    expect(r.status === 200 && r.headers.get("x-ai-stoica-route") === "direct" && j.choices[0].message.content === "GROK grok-4.6" && calls.xaiChat.join() === "grok-4.6", "Grok must answer: " + JSON.stringify({ status: r.status, j, calls }));

    // «Rezervă automată»: the fallback skips Cerebras even though it is first in the order.
    cfg.chatFallbackOnFailure = true; await wait();
    r = await chat("broken/model"); j = await r.json();
    expect(r.status === 200 && calls.cerebras === 0 && calls.groq === 1, "the fallback must skip Cerebras: " + JSON.stringify({ status: r.status, j, calls }));
    cfg.chatFallbackOnFailure = false;

    // gc/ is shared by Gemini CLI and Grok Build in OmniRoute: the model's name says whose it is.
    cfg.blockedProviders = "cerebras,xai"; await wait();
    list = await ids();
    expect(!list.includes("gc/grok-4.6-low") && list.includes("gc/gemini-3-pro"), "Grok left out hides gc/grok but not gc/gemini: " + list.join(", "));
    delete cfg.blockedProviders; await wait();

    // A 401 from the provider behind the model (an expired subscription login) is not reported as a bad OmniRoute key,
    // and OmniRoute's own reason reaches the user.
    r = await chat("gc/grok-4.6-low"); j = await r.json();
    expect(r.status === 502 && /loginul a expirat în OmniRoute pentru: grok-cli \(HTTP 401\)/.test(j.error) && /authentication expired/.test(j.error) && !/OmniRoute a refuzat cheia API/.test(j.error), "an expired login must say so: " + j.error);
    r = await chat("anthropic/claude-x"); j = await r.json();
    expect(r.status === 502 && /furnizorul acestui model a refuzat accesul \(HTTP 401\)/.test(j.error) && /invalid x-api-key/.test(j.error), "provider 401 must say so: " + j.error);
    r = await call("/api/chat/stream", { method: "POST", token, body: { model: "gc/grok-4.6-low", messages: [{ role: "user", content: "salut" }] } });
    j = await r.json();
    expect(r.status === 502 && /authentication expired/.test(j.error), "streaming too: " + j.error);
    // A wrong OmniRoute key is reported as such, with OmniRoute's answer.
    cfg.apiKey = "sk-wrong"; await wait();
    r = await chat("openai/gpt-4o-mini"); j = await r.json();
    expect(/OmniRoute a refuzat cheia API \(HTTP 401\)/.test(j.error) && /Invalid API key/.test(j.error), "a bad OmniRoute key must say so: " + j.error);
    cfg.apiKey = "sk-omni"; await wait();
    // Settings → «Testează cheile»: the OmniRoute key, then one model per company inside OmniRoute, so the Owner sees
    // which connection refuses (here Grok Build) and that the key itself is fine.
    r = await call("/api/providers/test", { method: "POST", token, body: {} }); j = await r.json();
    const checks = Object.fromEntries((j.omni?.checks || []).map((c) => [c.model, c]));
    expect(j.omni?.ok && checks["Ai principal"]?.ok && checks["gc/gemini-3-pro"]?.ok && checks["openai/gpt-4o-mini"]?.ok, "OmniRoute checks: " + JSON.stringify(j.omni));
    expect(checks["gc/grok-4.6-low"]?.ok === false && /login expirat în OmniRoute \(grok-cli\)/.test(checks["gc/grok-4.6-low"].error) && j.omni.expired.join() === "grok-cli", "the expired connection is named: " + JSON.stringify(j.omni));
    expect(checks["anthropic/claude-x"]?.ok === false && /furnizorul a refuzat accesul \(cheia OmniRoute e bună\)/.test(checks["anthropic/claude-x"].error), "the refusing provider is named: " + JSON.stringify(checks["anthropic/claude-x"]));
    expect(!Object.keys(checks).some((m) => /^cerebras\//.test(m)) && Object.keys(checks).length === 5, "one model per company, none from a left-out provider: " + Object.keys(checks).join(", "));
    // Pictures and video: the line under the test names the «Făcute de» providers (Gemini) and whether the key is saved.
    expect(j.media.map((m) => m.label + ":" + m.configured).join() === "Poze: Gemini (Nano Banana):true,Video: Gemini (Veo):true", "media line: " + JSON.stringify(j.media));
    const openAiRow = (j.data || []).find((x) => x.provider === "openai");
    expect(openAiRow && openAiRow.ok === false && /nu are credit/.test(openAiRow.error), "an OpenAI key without credit is not reported as a daily limit: " + JSON.stringify(j.data));
    omniAsked.length = 0;

    // Everything ticked again: Cerebras comes back.
    cfg.blockedProviders = ""; await wait();
    list = await ids();
    expect(list.includes("cerebras/gpt-oss-120b"), "with nothing left out, Cerebras is listed again");
    // Any provider can be left out, including one inside OmniRoute.
    cfg.blockedProviders = "groq,cerebras,openai"; await wait();
    list = await ids();
    expect(!list.some((id) => /^(groq|cerebras|openai)\//i.test(id)) && list.includes("Ai principal") && list.includes("xai/grok-4.6"), "left-out providers disappear, the combination stays: " + list.join(", "));
    r = await chat("openai/gpt-4o-mini");
    expect(r.status === 403 && !omniAsked.includes("openai/gpt-4o-mini"), "a left-out provider's model must not reach OmniRoute");
    delete cfg.blockedProviders;

    // Pictures: Grok Imagine.
    const image = async () => { const res = await call("/api/generate/image", { method: "POST", token, body: { prompt: "Un pătrat albastru" } }); return { status: res.status, j: await res.json() }; };
    // (Pictures and video are Gemini-only by default; test-0716-gemini-media.cjs covers that. Here every provider is in.)
    Object.assign(cfg, { imageProviders: "", videoProviders: "", imageProviderOrder: "xai", imageProviderMode: "auto" });
    let out = await image();
    expect(out.status === 200 && out.j.data?.kind === "image" && out.j.data.model === "xai/grok-imagine-image" && calls.xaiImage[0]?.response_format === "b64_json", "Grok Imagine picture: " + JSON.stringify(out));
    // Pictures: Gemini, trying the next name when Google does not know the first.
    Object.assign(cfg, { imageProviderOrder: "gemini", geminiImageModel: "missing-model,good-model" });
    out = await image();
    expect(out.status === 200 && out.j.data?.model === "gemini/good-model" && calls.geminiImage.join() === "missing-model,good-model", "Gemini picture: " + JSON.stringify({ out, calls: calls.geminiImage }));

    // Video: Grok Imagine Video (start, poll, download) and OpenAI Sora (start, poll, download /content with the key).
    const video = async () => { const res = await call("/api/generate/video", { method: "POST", token, body: { prompt: "Un val pe plajă", duration: 5, aspectRatio: "16:9" } }); return { status: res.status, j: await res.json() }; };
    Object.assign(cfg, { videoProviderOrder: "xai", videoMode: "auto" });
    out = await video();
    expect(out.status === 200 && out.j.data?.kind === "video" && out.j.data.model === "xai/grok-imagine-video" && calls.xaiVideo === 1 && calls.xaiPoll >= 1, "Grok video: " + JSON.stringify({ out, calls }));
    Object.assign(cfg, { videoProviderOrder: "openai" });
    out = await video();
    expect(out.status === 200 && out.j.data?.model === "openai/sora-2" && calls.sora[0]?.model === "sora-2" && calls.sora[0]?.seconds === "4" && calls.soraContent === 1, "Sora video: " + JSON.stringify({ out, calls }));

    // Paid pictures and video stay off under «Nu permite costuri directe».
    Object.assign(cfg, { imageCostPolicy: "free_only", imageProviderOrder: "xai" });
    const before = calls.xaiImage.length;
    out = await image();
    expect(out.status !== 200 && calls.xaiImage.length === before, "Grok pictures are paid: not used under the free-only protection");
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("0.7.16 providers (Cerebras off, Grok, Gemini pictures, Sora) OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
