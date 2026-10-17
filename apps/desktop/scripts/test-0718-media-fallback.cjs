// 0.7.18, from the diagnosis of 2026-10-16: pictures and video were set to «Gemini only» and Gemini was down in
// OmniRoute (503) with no Gemini key working, so every picture and video failed. «Făcute de» is now the order of
// preference: Gemini first, and when it makes nothing the other providers that work (the ChatGPT subscription for the
// Owner, the free web video, Pollinations without a key). SERASMART_MEDIA_STRICT=true keeps the old rule.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const mp4 = Buffer.concat([Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex"), Buffer.alloc(64)]);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "serasmart-media-fallback-"));
  const omniAsked = [];
  // OmniRoute: Gemini Web is down (503), the ChatGPT subscription makes pictures, the free web video makes video.
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [
        { id: "Ai principal", owned_by: "combo" },
        { id: "gweb/gemini-3.1-flash-image", owned_by: "gemini-web", type: "image" },
        { id: "codex/gpt-5.6-luna-image", owned_by: "codex", type: "image" },
        { id: "gweb/veo-3.1", owned_by: "gemini-web", type: "video" },
        { id: "veo-free/veo", owned_by: "veo-free", type: "video" }
      ] }));
      const j = body ? JSON.parse(body) : {};
      if (req.url === "/v1/images/generations" || req.url === "/v1/videos/generations") {
        if (req.method === "GET") { res.statusCode = 404; return res.end("{}"); }
        omniAsked.push(j.model);
        if (/^gweb\//.test(j.model)) { res.statusCode = 503; return res.end(JSON.stringify({ error: { message: "Service Unavailable" } })); }
        if (req.url === "/v1/images/generations") return res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
        res.setHeader("content-type", "video/mp4"); return res.end(mp4);
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  // The server as it was on 2026-10-16: «Făcute de» not set (Gemini), the Gemini key failing.
  const cfg = {
    baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "sk-omni", model: "", webSearchEnabled: false, githubAutoContext: false, ownerEmail: "owner@example.com",
    geminiApiKey: "AIza-test", pollinationsFreeEnabled: true, imageCostPolicy: "allow_paid", videoCostPolicy: "allow_paid",
    imageProviders: "gemini", videoProviders: "gemini"
  };
  const calls = { gemini: 0, pollinations: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    if (u.startsWith("https://generativelanguage.googleapis.com/")) { calls.gemini++; return new Response(JSON.stringify({ error: { message: "The model is overloaded" } }), { status: 503 }); }
    if (u.startsWith("https://image.pollinations.ai/")) { calls.pollinations++; return new Response(png, { status: 200, headers: { "content-type": "image/png" } }); }
    return new Response("{}", { status: 503 });
  };
  const gw = startLocalGateway({ dataDir: dir, port: 8879, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8879";
  const call = (p, { method = "GET", body, token } = {}) => realFetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    const token = (await (await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } })).json()).token;
    const image = async () => { const r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "Un pătrat albastru" } }); return { status: r.status, j: await r.json() }; };
    const video = async () => { const r = await call("/api/generate/video", { method: "POST", token, body: { prompt: "Un val pe plajă", duration: 4 } }); return { status: r.status, j: await r.json() }; };

    // Picture: Gemini is asked first (OmniRoute and the key), then the ChatGPT subscription makes it.
    let out = await image();
    expect(out.status === 200 && out.j.data?.model === "codex/gpt-5.6-luna-image", "the subscription must make the picture after Gemini fails: " + JSON.stringify(out).slice(0, 500));
    expect(omniAsked[0] === "gweb/gemini-3.1-flash-image" && calls.gemini > 0, "Gemini stays first: " + JSON.stringify({ omniAsked, calls }));

    // Video: Gemini Veo first (down), then the free web video.
    omniAsked.length = 0;
    out = await video();
    expect(out.status === 200 && out.j.data?.model === "veo-free/veo", "the free web video must make the video after Gemini fails: " + JSON.stringify(out).slice(0, 500));
    expect(omniAsked.indexOf("gweb/veo-3.1") < omniAsked.indexOf("veo-free/veo"), "Gemini Veo is asked before the fallback: " + omniAsked.join());

    // Strict: only Gemini, and the error says so.
    cfg.mediaStrict = true; omniAsked.length = 0;
    out = await image();
    expect(out.status === 502 && /doar de Gemini/.test(out.j.error) && !omniAsked.includes("codex/gpt-5.6-luna-image"), "strict keeps Gemini only: " + JSON.stringify(out).slice(0, 500));
    delete cfg.mediaStrict;

    // A provider that is down is remembered: the next picture goes straight to the one that answers.
    omniAsked.length = 0;
    out = await image();
    expect(out.status === 200 && omniAsked[0] === "codex/gpt-5.6-luna-image", "a provider that is down waits at the back: " + omniAsked.join());
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const repo = path.join(__dirname, "..", "..", "..");
  const server = fs.readFileSync(path.join(repo, "apps", "cloud", "server.cjs"), "utf8");
  expect(/mediaStrict:[^\n]*SERASMART_MEDIA_STRICT/.test(server), "apps/cloud/server.cjs reads SERASMART_MEDIA_STRICT");
  for (const f of [["apps", "cloud", "docker-compose.yml"], ["deploy", "hetzner", "docker-compose.yml"]]) {
    expect(fs.readFileSync(path.join(repo, ...f), "utf8").includes("SERASMART_MEDIA_STRICT: ${SERASMART_MEDIA_STRICT:-${AI_STOICA_MEDIA_STRICT:-false}}"), f.join("/") + " passes SERASMART_MEDIA_STRICT");
  }
  const { EDITABLE } = require("../lib/serversettings.cjs");
  expect(EDITABLE.includes("mediaStrict"), "the Owner can change it on the site");
  console.log("0.7.18 pictures and video fall back to the providers that work OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
