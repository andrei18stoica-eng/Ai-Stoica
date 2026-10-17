// 0.7.18, from the diagnosis of 2026-10-16: OmniRoute has no speech model and the server had no Groq key, so the
// microphone always failed once the browser's own recognition was not available. The keys the server already has
// (Gemini, Cloudflare) now transcribe too, and with none of them the error says what to add.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "serasmart-voice-fallback-"));
  const omniAsked = [];
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "Ai principal", owned_by: "combo" }] }));
      if (req.url === "/v1/audio/transcriptions") { omniAsked.push(1); res.statusCode = 404; return res.end(JSON.stringify({ error: { message: "model not found" } })); }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "sk-omni", model: "", webSearchEnabled: false, githubAutoContext: false, ownerEmail: "owner@example.com", geminiApiKey: "AIza-test" };
  const calls = { gemini: [], cloudflare: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    if (u.startsWith("https://generativelanguage.googleapis.com/")) {
      const body = JSON.parse(init.body); calls.gemini.push(body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Bună ziua, ce mai faci?" }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("api.cloudflare.com")) { calls.cloudflare++; return new Response(JSON.stringify({ result: { text: "Salut din Cloudflare" } }), { status: 200 }); }
    return new Response("{}", { status: 503 });
  };
  const gw = startLocalGateway({ dataDir: dir, port: 8881, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8881";
  const call = (p, { method = "GET", body, token } = {}) => realFetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    const token = (await (await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } })).json()).token;
    const audio = Buffer.alloc(2000, 7).toString("base64");
    const speak = async () => { const r = await call("/api/transcribe", { method: "POST", token, body: { audio, mime: "audio/webm;codecs=opus", language: "ro" } }); return { status: r.status, j: await r.json() }; };

    let out = await speak();
    expect(out.status === 200 && out.j.text === "Bună ziua, ce mai faci?", "Gemini must transcribe when OmniRoute cannot: " + JSON.stringify(out));
    expect(omniAsked.length > 0 && calls.gemini.length === 1, "OmniRoute is asked first, then Gemini");
    const part = calls.gemini[0].contents[0].parts[0].inlineData;
    expect(part.mimeType === "audio/webm" && part.data === audio, "the recording goes inline to Gemini, without the codec suffix");

    // Cloudflare when there is no Gemini key.
    cfg.geminiApiKey = ""; cfg.cloudflareAccountId = "acc"; cfg.cloudflareApiToken = "cf-test";
    out = await speak();
    expect(out.status === 200 && out.j.text === "Salut din Cloudflare" && calls.cloudflare === 1, "Cloudflare Whisper must transcribe: " + JSON.stringify(out));

    // Nothing configured but OmniRoute without a speech model: a clear error about what is missing.
    cfg.cloudflareAccountId = ""; cfg.cloudflareApiToken = "";
    out = await speak();
    expect(out.status === 502 && /transcrie/.test(out.j.error), "a failed transcription says so: " + JSON.stringify(out));
    cfg.baseUrl = "";
    out = await speak();
    expect(out.status === 503 && /Groq/.test(out.j.error) && /Gemini/.test(out.j.error), "with nothing configured the error says which key to add: " + JSON.stringify(out));
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("0.7.18 the microphone transcribes through the keys the server has OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
