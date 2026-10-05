// 0.7.16, at the Owner's request: pictures are made by Gemini (Nano Banana) and videos by Gemini (Veo), nothing else,
// unless the Owner chooses otherwise in Settings → Poze / Video → «Făcute de». The free fallbacks (Pollinations) and the
// other providers are not called; when Gemini cannot answer, the error says what to do.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const mp4 = Buffer.concat([Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex"), Buffer.alloc(64)]);
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-gemini-media-"));
  const omniAsked = [];
  // OmniRoute with a Gemini Web picture model (its sign-in expired), a ChatGPT one and a free web video one.
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [
        { id: "Ai principal", owned_by: "combo" }, { id: "gweb/gemini-3.1-flash-image", owned_by: "gemini-web" },
        { id: "cx/gpt-image-2", owned_by: "codex", type: "image" }, { id: "veoaifree-web/veo", owned_by: "veoaifree-web", type: "video" }
      ] }));
      const j = body ? JSON.parse(body) : {};
      if (req.url === "/v1/images/generations" || req.url === "/v1/videos/generations") {
        if (req.method === "GET") { res.statusCode = 404; return res.end("{}"); }
        omniAsked.push(j.model);
        res.statusCode = 401; return res.end(JSON.stringify({ error: { message: "the sign-in expired" } }));
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  // No «Făcute de» value: Gemini only, the default. Every other provider has a key and would answer.
  const cfg = {
    baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "sk-omni", model: "", webSearchEnabled: false, githubAutoContext: false, ownerEmail: "owner@example.com",
    geminiApiKey: "AIza-test", xaiApiKey: "xai-test", openAiApiKey: "sk-openai-test", pollinationsFreeEnabled: true,
    imageCostPolicy: "allow_paid", videoCostPolicy: "allow_paid"
  };
  const calls = { gemini: [], veo: [], other: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    const g = "https://generativelanguage.googleapis.com/v1beta/";
    if (u.startsWith(g + "models/") && u.endsWith(":generateContent")) {
      const model = decodeURIComponent(u.slice((g + "models/").length).split(":")[0]); calls.gemini.push(model);
      expect(init?.headers?.["x-goog-api-key"] === "AIza-test", "Gemini needs its key");
      return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] });
    }
    if (u.startsWith(g + "models/") && u.endsWith(":predictLongRunning")) {
      const model = decodeURIComponent(u.slice((g + "models/").length).split(":")[0]); calls.veo.push(model);
      if (model === "veo-3.1-fast-generate-preview") return json({ error: { message: "not found" } }, 404);
      return json({ name: "models/" + model + "/operations/op1", done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: g + "files/vid1:download?alt=media" } }] } } });
    }
    if (u === g + "files/vid1:download?alt=media") return new Response(mp4, { status: 200, headers: { "content-type": "video/mp4" } });
    calls.other.push(u);
    if (u.startsWith("https://image.pollinations.ai/")) return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    if (u === "https://api.x.ai/v1/images/generations") return json({ data: [{ b64_json: png.toString("base64") }] });
    return new Response("{}", { status: 503 });
  };
  const gw = startLocalGateway({ dataDir: dir, port: 8877, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8877";
  const call = (p, { method = "GET", body, token } = {}) => realFetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    const token = (await (await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } })).json()).token;
    const image = async (extra = {}) => { const r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "Un pătrat albastru", ...extra } }); return { status: r.status, j: await r.json() }; };
    const video = async () => { const r = await call("/api/generate/video", { method: "POST", token, body: { prompt: "Un val pe plajă", duration: 4 } }); return { status: r.status, j: await r.json() }; };

    // Picture: Gemini Web in OmniRoute is tried first (it refuses), then Nano Banana through the Gemini key.
    // ChatGPT, Grok and the free Pollinations are never asked.
    let out = await image();
    expect(out.status === 200 && out.j.data?.model === "gemini/gemini-3.1-flash-image" && out.j.data.provider === "gemini-image-direct", "Nano Banana must make the picture: " + JSON.stringify(out).slice(0, 400));
    expect(omniAsked.join() === "gweb/gemini-3.1-flash-image" && calls.other.length === 0, "only Gemini may be asked: " + JSON.stringify({ omniAsked, other: calls.other }));
    // Again (the remembered model is Gemini's): still nobody else.
    out = await image();
    expect(out.status === 200 && calls.other.length === 0 && !omniAsked.includes("cx/gpt-image-2"), "the second picture too: " + JSON.stringify(calls.other));

    // A non-Gemini model asked for by name is refused, with the reason.
    out = await image({ model: "cx/gpt-image-2" });
    expect(out.status === 403 && /doar de Gemini/.test(out.j.error) && !omniAsked.includes("cx/gpt-image-2"), "a ChatGPT picture model must be refused: " + JSON.stringify(out));

    // Nano Banana Pro chosen in Settings: used first.
    cfg.geminiImageModel = "gemini-3-pro-image-preview"; calls.gemini = [];
    out = await image();
    expect(out.status === 200 && calls.gemini[0] === "gemini-3-pro-image-preview", "the chosen Nano Banana model goes first: " + calls.gemini.join());

    // Without a Gemini key: no picture from anyone else, and the error says to add the key.
    const key = cfg.geminiApiKey; cfg.geminiApiKey = "";
    out = await image();
    expect(out.status === 502 && /cheia Gemini/.test(out.j.error) && /doar de Gemini/.test(out.j.error) && calls.other.length === 0, "no Gemini key: " + JSON.stringify(out).slice(0, 500));
    cfg.geminiApiKey = key;
    // Under «Nu permite costuri directe» the Gemini API is not called and the error says why.
    cfg.imageCostPolicy = "free_only"; const before = calls.gemini.length;
    out = await image();
    expect(out.status === 502 && /cu plată/.test(out.j.error) && calls.gemini.length === before && calls.other.length === 0, "paid Gemini under free-only: " + JSON.stringify(out).slice(0, 500));
    cfg.imageCostPolicy = "allow_paid";

    // Video: Veo through the Gemini key; a Veo name Google does not know is skipped. The free web video is not used.
    out = await video();
    expect(out.status === 200 && out.j.data?.kind === "video" && out.j.data.provider === "gemini-veo-direct" && calls.veo.join() === "veo-3.1-fast-generate-preview,veo-3.1-generate-preview", "Veo must make the video: " + JSON.stringify({ out, veo: calls.veo }).slice(0, 500));
    expect(!omniAsked.includes("veoaifree-web/veo") && calls.other.length === 0, "the free web video must not be used: " + JSON.stringify({ omniAsked, other: calls.other }));
    // Under the video cost protection: nothing to try, and the message says how to turn Veo on.
    cfg.videoCostPolicy = "free_only";
    out = await video();
    expect(out.status === 400 && /Veo/.test(out.j.error) && /cu plată/.test(out.j.error) && !omniAsked.includes("veoaifree-web/veo"), "Veo under free-only: " + JSON.stringify(out));
    cfg.videoCostPolicy = "allow_paid";

    // The Owner lets every provider in again: the free picture service answers when it comes first.
    Object.assign(cfg, { imageProviders: "", imageProviderOrder: "pollinations-free" });
    out = await image();
    expect(out.status === 200 && out.j.data?.provider === "pollinations-free" && calls.other.some((u) => u.startsWith("https://image.pollinations.ai/")), "with every provider allowed the others work again: " + JSON.stringify(out).slice(0, 300));
    // Or a chosen few: Grok in, Gemini out.
    Object.assign(cfg, { imageProviders: "xai", imageProviderOrder: "gemini,xai" }); calls.gemini = [];
    out = await image();
    expect(out.status === 200 && out.j.data?.model === "xai/grok-imagine-image" && calls.gemini.length === 0, "Grok only: " + JSON.stringify(out).slice(0, 300));
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // The settings reach the site: apps/cloud reads the variables, both compose files pass them, the site can save them.
  const repo = path.join(__dirname, "..", "..", "..");
  const server = fs.readFileSync(path.join(repo, "apps", "cloud", "server.cjs"), "utf8");
  expect(/imageProviders:[^\n]*AI_STOICA_IMAGE_PROVIDERS/.test(server) && /videoProviders:[^\n]*AI_STOICA_VIDEO_PROVIDERS/.test(server), "apps/cloud/server.cjs must read AI_STOICA_IMAGE_PROVIDERS / AI_STOICA_VIDEO_PROVIDERS");
  for (const f of [["apps", "cloud", "docker-compose.yml"], ["deploy", "hetzner", "docker-compose.yml"]]) {
    const text = fs.readFileSync(path.join(repo, ...f), "utf8");
    expect(text.includes("AI_STOICA_IMAGE_PROVIDERS: ${AI_STOICA_IMAGE_PROVIDERS-gemini}") && text.includes("AI_STOICA_VIDEO_PROVIDERS: ${AI_STOICA_VIDEO_PROVIDERS-gemini}"), f.join("/") + ": Gemini by default, an empty value kept");
  }
  const { EDITABLE } = require("../lib/serversettings.cjs");
  expect(EDITABLE.includes("imageProviders") && EDITABLE.includes("videoProviders"), "the Owner can change them on the site");
  console.log("0.7.16 pictures by Gemini Nano Banana, videos by Gemini Veo OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
