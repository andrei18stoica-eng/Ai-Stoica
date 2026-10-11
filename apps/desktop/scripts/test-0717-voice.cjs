// 0.7.17, at the Owner's request: the microphone writes what you say in the chat while you speak and sends it when you stop.
// Where the browser cannot recognise speech, the recording goes to /api/transcribe (no file permission, nothing saved).
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-voice17-"));
  const omni = http.createServer((req, res) => { req.on("data", () => {}); req.on("end", () => { res.statusCode = 404; res.end("{}"); }); });
  const omniPort = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "k", model: "", webSearchEnabled: false, githubAutoContext: false, groqApiKey: "gsk-test" };
  const realFetch = globalThis.fetch, groq = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    if (u === "https://api.groq.com/openai/v1/audio/transcriptions") { groq.push(init.body.get("language")); return new Response(JSON.stringify({ text: "Ce vreme e mâine?" }), { status: 200, headers: { "content-type": "application/json" } }); }
    throw new Error("unexpected " + u);
  };
  const gw = startLocalGateway({ dataDir: dir, port: 8879, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8879";
  try {
    await new Promise((r) => setTimeout(r, 200));
    const token = (await (await realFetch(base + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@example.com", password: "password123", name: "A" }) })).json()).token;
    const post = (payload) => realFetch(base + "/api/transcribe", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(payload) });
    const audio = Buffer.concat([Buffer.from("1a45dfa3", "hex"), Buffer.alloc(300)]).toString("base64");
    let r = await post({ audio, mime: "audio/webm;codecs=opus", language: "ro" }), j = await r.json();
    expect(r.ok && j.text === "Ce vreme e mâine?", "the recording must come back as text: " + r.status + JSON.stringify(j));
    expect(groq[0] === "ro", "the language is passed on");
    r = await post({}); expect(r.status === 400, "an empty request is refused clearly: " + r.status);
    const lib = await (await realFetch(base + "/api/library", { headers: { authorization: "Bearer " + token } })).json().catch(() => ({}));
    expect(!(lib.data || []).length, "the microphone saves nothing in the Library");
  } finally {
    globalThis.fetch = realFetch; await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const ui = fs.readFileSync(path.join(__dirname, "../renderer/src/main.jsx"), "utf8");
  const micFn = ui.slice(ui.indexOf("async function mic(){"), ui.indexOf("const hasContent="));
  expect(!/file_upload/.test(micFn), "the microphone must not need the file permission");
  expect(/r\.interimResults=true/.test(ui) && /setDraft\(base\+heard\)/.test(ui), "the words must appear in the box while speaking");
  expect(/api\("\/api\/transcribe"/.test(ui) && /startRecorder\(\);return;/.test(ui), "when recognition fails the recording is transcribed by AI Stoica");
  expect(/function finishVoice\(text\)/.test(ui) && /setVoiceTick/.test(ui), "stopping sends the message");
  console.log("test-0717-voice: OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
