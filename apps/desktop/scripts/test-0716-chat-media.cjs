// 0.7.16, at the Owner's request: "when I ask OpenAI, Gemini or Grok for a picture, it makes it". A picture or video
// asked for in the chat is made by the company of the chosen model: first its subscription connected in OmniRoute (no
// API), then its API. Combinations and models that make no pictures (Claude…) keep Setări → Poze → «Făcute de».
// The chat recognises the request in plain Romanian ("fă o poză cu…", "poți să-mi faci un video…?").
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path"), { pathToFileURL } = require("url");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const mp4 = Buffer.concat([Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex"), Buffer.alloc(64)]);
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

async function main() {
  // The chat's request detection.
  const { requestedMediaGeneration: ask } = await import(pathToFileURL(path.join(__dirname, "../renderer/src/mediaIntent.mjs")).href);
  for (const [text, kind] of [["Generează o poză cu un cățel pe plajă", "image"], ["fă-mi o imagine cu Bucureștiul noaptea", "image"], ["Fă o poză cu un apus", "image"],
    ["creează-mi un video cu valuri", "video"], ["Vreau o poză cu o mașină roșie", "image"], ["aș vrea un videoclip cu un dragon", "video"],
    ["Poți să-mi faci o poză cu un munte?", "image"], ["îmi poți genera o imagine cu o pisică?", "image"], ["make me a picture of a cat", "image"]])
    expect(ask(text) === kind, `"${text}" must make a ${kind}, got ${ask(text)}`);
  for (const text of ["Cum fac o poză bună?", "Scrie-mi un script pentru un video", "generează un prompt pentru o imagine", "vreau o imagine de ansamblu asupra proiectului", "ce e o poză RAW?", "poți să-mi explici cum funcționează un video codec?", "fă-mi un plan"])
    expect(ask(text) === null, `"${text}" must stay a text answer, got ${ask(text)}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-chat-media-"));
  const omniAsked = [], state = { codexExpired: false };
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [
        { id: "Ai principal", owned_by: "combo" }, { id: "cx/gpt-5.6", owned_by: "codex" }, { id: "cx/gpt-image-2", owned_by: "codex", type: "image" },
        { id: "gweb/gemini-3.1-flash-image", owned_by: "gemini-web" }, { id: "gc/gemini-3-pro", owned_by: "gemini-cli" }, { id: "cc/claude-sonnet-4.6", owned_by: "claude" }
      ] }));
      if (req.method === "GET") { res.statusCode = 404; return res.end("{}"); }
      const j = body ? JSON.parse(body) : {};
      if (req.url === "/v1/images/generations") {
        omniAsked.push(j.model);
        if (j.model === "cx/gpt-image-2" && state.codexExpired) { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: "[codex] All 1 connection(s) authentication expired" } })); }
        return res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  const cfg = {
    baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "sk-omni", model: "", webSearchEnabled: false, githubAutoContext: false, ownerEmail: "owner@example.com",
    geminiApiKey: "AIza-test", openAiApiKey: "sk-openai-test", xaiApiKey: "xai-test", pollinationsFreeEnabled: true,
    imageCostPolicy: "allow_paid", videoCostPolicy: "allow_paid"
  };
  const calls = { gemini: 0, openai: 0, xai: 0, xaiVideo: 0, sora: 0, other: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    if (u.includes("generativelanguage.googleapis.com") && u.endsWith(":generateContent")) { calls.gemini++; return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] }); }
    if (u === "https://api.openai.com/v1/images/generations") { calls.openai++; return json({ data: [{ b64_json: png.toString("base64") }] }); }
    if (u === "https://api.x.ai/v1/images/generations") { calls.xai++; return json({ data: [{ b64_json: png.toString("base64") }] }); }
    if (u === "https://api.x.ai/v1/videos/generations") { calls.xaiVideo++; return json({ request_id: "req-1" }); }
    if (u === "https://api.x.ai/v1/videos/req-1") return json({ status: "done", video: { url: "https://vidgen.x.ai/test.mp4" } });
    if (u === "https://vidgen.x.ai/test.mp4") return new Response(mp4, { status: 200, headers: { "content-type": "video/mp4" } });
    if (u === "https://api.openai.com/v1/videos") { calls.sora++; return json({ id: "video_1", status: "completed" }); }
    if (u === "https://api.openai.com/v1/videos/video_1") return json({ id: "video_1", status: "completed" });
    if (u === "https://api.openai.com/v1/videos/video_1/content") return new Response(mp4, { status: 200, headers: { "content-type": "video/mp4" } });
    calls.other.push(u);
    return new Response("{}", { status: 503 });
  };
  const gw = startLocalGateway({ dataDir: dir, port: 8876, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8876";
  const call = (p, { method = "GET", body, token } = {}) => realFetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    const token = (await (await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } })).json()).token;
    const image = async (via) => { const r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "Un pătrat albastru", via } }); return { status: r.status, j: await r.json() }; };
    const video = async (via) => { const r = await call("/api/generate/video", { method: "POST", token, body: { prompt: "Un val", duration: 4, via } }); return { status: r.status, j: await r.json() }; };
    const reset = () => { omniAsked.length = 0; Object.assign(calls, { gemini: 0, openai: 0, xai: 0, xaiVideo: 0, sora: 0, other: [] }); };

    // ChatGPT chosen: the ChatGPT subscription (Codex in OmniRoute) makes it, no API, no Gemini.
    let out = await image("cx/gpt-5.6");
    expect(out.status === 200 && out.j.data?.model === "cx/gpt-image-2" && omniAsked.join() === "cx/gpt-image-2" && calls.openai === 0 && calls.gemini === 0, "ChatGPT model → Codex subscription: " + JSON.stringify({ out, omniAsked, calls }).slice(0, 500));
    // Its login expired: the OpenAI API, still not Gemini, Grok or the free services.
    state.codexExpired = true; reset();
    out = await image("cx/gpt-5.6");
    expect(out.status === 200 && out.j.data?.provider === "openai-direct" && calls.gemini === 0 && calls.xai === 0 && calls.other.length === 0, "then the OpenAI API: " + JSON.stringify({ out, calls }).slice(0, 500));
    state.codexExpired = false; reset();

    // Grok chosen: Grok Imagine.
    out = await image("xai/grok-4.6");
    expect(out.status === 200 && out.j.data?.model === "xai/grok-imagine-image" && calls.xai === 1 && calls.gemini === 0 && omniAsked.length === 0, "Grok model → Grok Imagine: " + JSON.stringify({ out, calls, omniAsked }).slice(0, 400));
    reset();

    // Gemini chosen (also through a subscription like gc/): Gemini Web in OmniRoute first.
    out = await image("gc/gemini-3-pro");
    expect(out.status === 200 && out.j.data?.model === "gweb/gemini-3.1-flash-image" && calls.gemini === 0 && calls.openai === 0, "Gemini model → Gemini Web: " + JSON.stringify({ out, calls, omniAsked }).slice(0, 400));
    reset();

    // A combination or Claude: «Făcute de» (Gemini by default), never ChatGPT, Grok or Pollinations.
    for (const via of ["Ai principal", "cc/claude-sonnet-4.6", ""]) {
      out = await image(via);
      expect(out.status === 200 && /gemini/.test(out.j.data?.model) && !omniAsked.includes("cx/gpt-image-2") && calls.openai === 0 && calls.xai === 0 && calls.other.length === 0, `"${via}" → Setări (Gemini): ` + JSON.stringify({ out, calls, omniAsked }).slice(0, 400));
      reset();
    }

    // Grok chosen without an xAI key: no picture from anyone else, and the error says why.
    cfg.xaiApiKey = "";
    out = await image("xai/grok-4.6");
    expect(out.status === 502 && /Grok Imagine/.test(out.j.error) && /cheia xAI/.test(out.j.error) && /compania modelului ales/.test(out.j.error) && calls.gemini === 0 && calls.openai === 0, "Grok without a key: " + JSON.stringify(out).slice(0, 500));
    cfg.xaiApiKey = "xai-test"; reset();

    // Video follows the same rule: Grok → Grok Imagine Video, ChatGPT → Sora.
    out = await video("xai/grok-4.6");
    expect(out.status === 200 && out.j.data?.kind === "video" && calls.xaiVideo === 1 && calls.sora === 0, "Grok video: " + JSON.stringify({ out, calls }).slice(0, 400));
    reset();
    out = await video("cx/gpt-5.6");
    expect(out.status === 200 && out.j.data?.kind === "video" && calls.sora === 1 && calls.xaiVideo === 0, "ChatGPT video → Sora: " + JSON.stringify({ out, calls }).slice(0, 400));

    // The interface sends the chosen model with every picture / video request.
    const src = fs.readFileSync(path.join(__dirname, "../renderer/src/main.jsx"), "utf8");
    expect(/body:JSON\.stringify\(\{prompt,via:baseConv\.model\|\|model\|\|""\}\)/.test(src) && src.includes('from "./mediaIntent.mjs"'), "main.jsx must send the chat model and use mediaIntent.mjs");
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("0.7.16 pictures and video from the chosen model's company OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
