// 0.7.16, at the Owner's request: the microphone records, writes what was said and sends it.
// Transcription goes through OmniRoute first; when OmniRoute cannot transcribe, the free Groq key from Setări does it.
// The composer sends the spoken text by itself and keeps the recording in the Library (not attached to the message).
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-voice-"));
  const omniAsked = [];
  const omni = http.createServer((req, res) => {
    req.on("data", () => {}); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "Ai principal", owned_by: "combo" }] }));
      if (req.url === "/v1/audio/transcriptions") { omniAsked.push(1); res.statusCode = 404; return res.end("{}"); }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "sk-omni", model: "", webSearchEnabled: false, githubAutoContext: false, ownerEmail: "owner@example.com", groqApiKey: "gsk-test" };
  const groqAsked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    if (u === "https://api.groq.com/openai/v1/audio/transcriptions") {
      groqAsked.push({ auth: init.headers.Authorization, model: init.body.get("model"), language: init.body.get("language") });
      return new Response(JSON.stringify({ text: "Bună ziua, ce vreme e mâine?" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("unexpected network call " + u);
  };
  const gw = startLocalGateway({ dataDir: dir, port: 8879, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8879";
  try {
    await new Promise((r) => setTimeout(r, 200));
    const token = (await (await realFetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "password123", name: "Owner" }) })).json()).token;
    const audio = Buffer.concat([Buffer.from("1a45dfa3", "hex"), Buffer.alloc(256)]);
    const up = await realFetch(base + "/api/library/upload", { method: "POST", headers: { authorization: "Bearer " + token, "x-file-name": "Vocal_AI_Stoica.webm", "x-file-type": "audio/webm", "x-file-size": String(audio.length) }, body: audio });
    expect(up.ok, "the voice recording must upload, got " + up.status);
    const id = (await up.json()).data.id;
    const transcribe = () => realFetch(base + `/api/library/${id}/transcribe`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ language: "ro" }) });

    let r = await transcribe(), j = await r.json();
    expect(r.ok && j.text === "Bună ziua, ce vreme e mâine?", "Groq must transcribe when OmniRoute cannot: " + JSON.stringify(j));
    expect(omniAsked.length > 0, "OmniRoute must be asked first");
    expect(groqAsked.length === 1 && groqAsked[0].auth === "Bearer gsk-test" && groqAsked[0].model === "whisper-large-v3-turbo" && groqAsked[0].language === "ro", "Groq direct call: " + JSON.stringify(groqAsked));

    // Without the Groq key the error says what is missing, instead of a silent failure.
    cfg.groqApiKey = "";
    r = await transcribe(); j = await r.json();
    expect(r.status === 502 && /transcrie/.test(j.error || j.message || ""), "no transcription service must be a clear error: " + JSON.stringify(j));
    expect(groqAsked.length === 1, "Groq must not be called without its key");
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // The composer: the spoken text goes in the box and is sent; the recording is attached only when transcription fails.
  const ui = fs.readFileSync(path.join(__dirname, "../renderer/src/main.jsx"), "utf8");
  expect(/if\(attachment\.transcript\)\{autoSendRef\.current=true;setDraft/.test(ui), "the transcript must be written in the box and marked for sending");
  expect(/autoSendRef\.current&&!transcribing&&draft\.trim\(\)\)\{autoSendRef\.current=false;trySend\(\);\}/.test(ui), "the voice text must be sent by itself");
  expect(/else\{setAttachments\(v=>\[\.\.\.v,attachment\]\)/.test(ui), "a failed transcription keeps the recording attached");
  console.log("test-0716-voice: OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
