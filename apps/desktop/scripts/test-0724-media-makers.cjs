// 0.7.24, asked by the Owner on 2026-10-17 ("videos only work with Gemini; I want ChatGPT too, and pictures with more
// models"): «Făcute de» is every maker by default (the old saved "gemini" becomes every maker once), OpenAI is no video
// maker any more (Sora closed on 24.09.2026; with a ChatGPT model the video comes from the others, with a note), the
// free AI Horde catalogue is cut to its general models (no adult ones), and the Poză / Video picker under the message
// box chooses who makes it (GET /api/media/options, the "maker" field), tried first.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path"), vm = require("vm");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const mp4 = Buffer.concat([Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex"), Buffer.alloc(64)]);
const root = path.join(__dirname, "..", "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function sources() {
  // Windows: the old default "gemini" saved before 0.7.24 (no mediaMakers) becomes every maker; a choice made after stays.
  const main = read("apps/desktop/main.cjs");
  const fn = main.match(/function mediaMakersValue\(cfg, key\) \{[\s\S]*?\n\}/)[0];
  const mediaMakersValue = vm.runInNewContext(`(${fn})`);
  expect(mediaMakersValue({ imageProviders: "gemini" }, "imageProviders") === "", "old saved gemini → every maker");
  expect(mediaMakersValue({ imageProviders: "gemini", mediaMakers: 2 }, "imageProviders") === "gemini", "«Doar Gemini» chosen after 0.7.24 stays");
  expect(mediaMakersValue({ videoProviders: "gemini,openai,xai", mediaMakers: 2 }, "videoProviders") === "gemini,xai", "OpenAI is dropped from the video makers");
  expect(mediaMakersValue({}, "imageProviders") === "" && /imageProviders: "",\s*videoProviders: "",\s*mediaMakers: 2/.test(main), "new installs: every maker");
  expect(!/openAiVideoModel/.test(main) && !/openAiVideoModel/.test(read("apps/desktop/lib/serversettings.cjs")), "no Sora setting left");
  // The site: "gemini" in an old .env counts as every maker; the compose files pass an empty default.
  const cloud = read("apps/cloud/server.cjs");
  expect(/const mediaMakersEnv = [^\n]*v === "gemini" \? "" : v/.test(cloud) && /imageProviders: mediaMakersEnv\("SERASMART_IMAGE_PROVIDERS"\)/.test(cloud), "apps/cloud maps the old default");
  expect(/^SERASMART_IMAGE_PROVIDERS=$/m.test(read("deploy/hetzner/.env.example")), ".env.example: every maker");
  // The interface: the picker, remembered per kind, sent with every picture / video.
  const ui = read("apps/desktop/renderer/src/main.jsx");
  expect(/function MediaMakerPick\(\{kind\}\)/.test(ui) && /api\(`\/api\/media\/options\?kind=\$\{kind\}`\)/.test(ui) && /mediaMode&&<div className="makerRow"><MediaMakerPick kind=\{mediaMode\}\/>/.test(ui), "the picker is under the message box in the Poză / Video mode");
  expect(/maker:savedMaker\(kind\)\|\|"auto"/.test(ui) && /content:d\.data\?\.note\|\|""/.test(ui), "the picker's choice is sent and the note shown");
  expect(!/OpenAI \(Sora\)/.test(ui) && /Sora closed on 24 September 2026/.test(ui), "Settings say OpenAI makes no video");
}

async function gateway() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "serasmart-makers-"));
  const omniAsked = [];
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [
        { id: "Ai principal", owned_by: "combo" },
        { id: "codex/gpt-5.6-sol-image", owned_by: "codex", type: "image" },
        { id: "aihorde/2DN", owned_by: "aihorde", type: "image" },
        { id: "aihorde/WAI-NSFW-illustrious-SDXL", owned_by: "aihorde", type: "image" },
        { id: "aihorde/SDXL 1.0", owned_by: "aihorde", type: "image" },
        { id: "aihorde/Flux.1-Schnell fp8 (Compact)", owned_by: "aihorde", type: "image" },
        { id: "veo-free/veo", owned_by: "veo-free", type: "video" }
      ] }));
      const j = body ? JSON.parse(body) : {};
      if (req.url === "/v1/images/generations" || req.url === "/v1/videos/generations") {
        if (req.method === "GET") { res.statusCode = 404; return res.end("{}"); }
        omniAsked.push(j.model);
        if (j.model === "veo-free/veo") { res.statusCode = 502; return res.end(JSON.stringify({ error: { message: "Serviciul nu poate fi contactat" } })); }
        if (req.url === "/v1/images/generations") return res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
        res.setHeader("content-type", "video/mp4"); return res.end(mp4);
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  // «Făcute de» not set: every maker. Keys for Gemini and Grok; pictures free only (Grok pictures are paid).
  const cfg = {
    baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "sk-omni", model: "", webSearchEnabled: false, githubAutoContext: false, ownerEmail: "owner@example.com",
    geminiApiKey: "AIza-test", xaiApiKey: "xai-test", openAiApiKey: "sk-openai-test", pollinationsFreeEnabled: true,
    imageCostPolicy: "free_only", videoCostPolicy: "allow_paid"
  };
  const calls = { sora: 0, xaiVideo: 0, xaiImage: 0, gemini: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    if (u.startsWith("https://api.openai.com/v1/videos")) { calls.sora++; return new Response("{}", { status: 404 }); }
    if (u === "https://api.x.ai/v1/videos/generations") { calls.xaiVideo++; return new Response(JSON.stringify({ request_id: "v1" }), { status: 200 }); }
    if (u === "https://api.x.ai/v1/videos/v1") return new Response(JSON.stringify({ status: "done", video: { url: "https://vidgen.x.ai/v1.mp4" } }), { status: 200 });
    if (u === "https://vidgen.x.ai/v1.mp4") return new Response(mp4, { status: 200, headers: { "content-type": "video/mp4" } });
    if (u.startsWith("https://api.x.ai/v1/images")) { calls.xaiImage++; return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 }); }
    if (u.startsWith("https://generativelanguage.googleapis.com/")) { calls.gemini++; return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 }); }
    if (u.startsWith("https://image.pollinations.ai/")) return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    return new Response("{}", { status: 503 });
  };
  const gw = startLocalGateway({ dataDir: dir, port: 8871, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8871";
  const call = async (p, { method = "GET", body, token } = {}) => { const r = await realFetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, j }; };
  try {
    const token = (await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } })).j.token;

    // The picture picker: the ChatGPT subscription, AI Horde's general models only (no adult ones, no 2DN), the keys.
    let r = await call("/api/media/options?kind=image", { token });
    const values = (r.j.data || []).map((o) => o.value);
    expect(r.status === 200 && values.includes("omni:codex/gpt-5.6-sol-image") && values.includes("omni:aihorde/Flux.1-Schnell fp8 (Compact)") && values.includes("omni:aihorde/SDXL 1.0"), "picture makers: " + values.join(", "));
    expect(!values.some((v) => /NSFW|2DN/.test(v)), "no adult or unknown AI Horde models: " + values.join(", "));
    expect(values.indexOf("omni:aihorde/Flux.1-Schnell fp8 (Compact)") < values.indexOf("omni:aihorde/SDXL 1.0"), "AI Horde's best first");
    const chatgpt = r.j.data.find((o) => o.value === "omni:codex/gpt-5.6-sol-image"), grok = r.j.data.find((o) => o.value === "direct:xai");
    expect(chatgpt.group === "Abonamente" && chatgpt.label === "ChatGPT · gpt-5.6-sol-image" && grok && /Protecție costuri/.test(grok.blocked), "labels, groups and the paid one blocked under «Doar gratuit»: " + JSON.stringify(r.j.data));
    expect((await call("/api/generate/image", { method: "POST", token, body: { prompt: "x", model: "aihorde/WAI-NSFW-illustrious-SDXL" } })).status === 403, "an adult model asked by name is refused");

    // Automatic: the ChatGPT subscription first. Picked: AI Horde Flux first.
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "Un pătrat albastru" } });
    expect(r.status === 200 && r.j.data.model === "codex/gpt-5.6-sol-image", "automatic picture: the subscription: " + JSON.stringify(r.j).slice(0, 300));
    omniAsked.length = 0;
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "Un pătrat albastru", maker: "omni:aihorde/Flux.1-Schnell fp8 (Compact)" } });
    expect(r.status === 200 && r.j.data.model === "aihorde/Flux.1-Schnell fp8 (Compact)" && omniAsked[0] === "aihorde/Flux.1-Schnell fp8 (Compact)", "the picked maker goes first: " + JSON.stringify({ j: r.j, omniAsked }).slice(0, 300));
    // Picked but paid under «Doar gratuit»: refused with the reason, nothing called. Gone: ignored.
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "x", maker: "direct:xai" } });
    expect(r.status === 403 && /Protecție costuri/.test(r.j.error) && calls.xaiImage === 0, "a blocked maker: " + JSON.stringify(r.j));
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "x", maker: "omni:gone/model" } });
    expect(r.status === 200, "an unknown maker falls back to automatic");

    // Video: no OpenAI anywhere; the picker has the free web video and Grok (paid allowed here).
    r = await call("/api/media/options?kind=video", { token });
    const vvalues = (r.j.data || []).map((o) => o.value);
    expect(vvalues.includes("omni:veo-free/veo") && vvalues.includes("direct:xai") && vvalues.includes("direct:gemini") && !vvalues.some((v) => /openai/.test(v)), "video makers: " + vvalues.join(", "));
    // A ChatGPT model in the chat: the free web video fails, Gemini fails, Grok makes it; no Sora; the note says why.
    omniAsked.length = 0;
    r = await call("/api/generate/video", { method: "POST", token, body: { prompt: "Un val", duration: 4, via: "cx/gpt-5.6-sol" } });
    expect(r.status === 200 && r.j.data.model === "xai/grok-imagine-video" && calls.sora === 0 && /Sora a fost închis pe 24 septembrie 2026/.test(r.j.data.note) && /Grok · grok-imagine-video/.test(r.j.data.note), "ChatGPT video: " + JSON.stringify({ j: r.j, calls }).slice(0, 500));
    // Picked Grok: straight to Grok, the free web video not asked first.
    omniAsked.length = 0; const before = calls.xaiVideo;
    r = await call("/api/generate/video", { method: "POST", token, body: { prompt: "Un val", duration: 4, maker: "direct:xai" } });
    expect(r.status === 200 && calls.xaiVideo === before + 1 && !omniAsked.length, "picked Grok video: " + JSON.stringify({ j: r.j, omniAsked }).slice(0, 300));
    // «Doar Gemini» chosen and everything failing: the error names the way out.
    Object.assign(cfg, { videoProviders: "", videoCostPolicy: "free_only", xaiApiKey: "" });
    r = await call("/api/generate/video", { method: "POST", token, body: { prompt: "Un val", duration: 4 } });
    expect(r.status === 502 && /Permite provideri cu plată/.test(r.j.error) && /Gemini Veo/.test(r.j.error), "the failure says what to turn on: " + JSON.stringify(r.j).slice(0, 500));
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => { sources(); await gateway(); console.log("0.7.24 media makers OK"); })().catch((e) => { console.error(e); process.exit(1); });
