// 0.7.16, the error "even for the Owner" when a model was chosen: OmniRoute's /v1/models also lists the models that make
// pictures, video, sound and embeddings (type "image", "video", "audio", "embedding"…). They sat in the chat list and
// failed at the provider when chosen. The chat list now holds only chat models; choosing another one says what it is.
// On Windows the list no longer keeps, forever, models that left OmniRoute.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

async function main() {
  const asked = [];
  const omni = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => b += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [
        { id: "Ai principal", owned_by: "combo" }, { id: "gemini/gemini-2.5-flash", owned_by: "gemini" }, { id: "cx/gpt-5.5", owned_by: "codex" },
        { id: "cx/gpt-image-2", owned_by: "codex", type: "image", output_modalities: ["image"] },
        { id: "gemini/veo-3.1-generate-preview", owned_by: "gemini", type: "video" },
        { id: "openai/text-embedding-3-small", owned_by: "openai", type: "embedding" },
        { id: "openai/gpt-4o-mini-tts", owned_by: "openai", type: "audio", subtype: "speech" },
        { id: "cohere/rerank-v3.5", owned_by: "cohere", type: "rerank" },
        { id: "pol/flux", owned_by: "pollinations", output_modalities: ["image"] }
      ] }));
      if (req.url === "/v1/chat/completions") {
        const j = b ? JSON.parse(b) : {}; asked.push(j.model);
        return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok " + j.model } }] }));
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  const port = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "sk-omni", model: "", webSearchEnabled: false, githubAutoContext: false, ownerEmail: "owner@example.com", directChatEnabled: false };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-chat-models-"));
  const gw = startLocalGateway({ dataDir: dir, port: 8880, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8880";
  const call = (p, token, payload) => fetch(base + p, { method: payload ? "POST" : "GET", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
  try {
    const token = (await (await call("/auth/register", "", { email: "owner@example.com", password: "password123", name: "Owner" })).json()).token;
    const ids = (await (await call("/api/models", token)).json()).data.map((x) => typeof x === "string" ? x : x.id);
    expect(ids.join() === "Ai principal,gemini/gemini-2.5-flash,cx/gpt-5.5", "the chat list holds only the chat models: " + ids.join(", "));

    for (const [model, what] of [["cx/gpt-image-2", /face poze/], ["gemini/veo-3.1-generate-preview", /face video/], ["openai/text-embedding-3-small", /embedding/], ["openai/gpt-4o-mini-tts", /sunet/]]) {
      const r = await call("/api/chat", token, { model, messages: [{ role: "user", content: "Salut" }] });
      const j = await r.json();
      expect(r.status === 400 && /nu este un model de chat/.test(j.error) && what.test(j.error), `${model} must be refused with the reason: ` + JSON.stringify({ status: r.status, j }));
    }
    expect(asked.length === 0, "a model that cannot chat is not sent to OmniRoute: " + asked.join());
    const r = await call("/api/chat", token, { model: "gemini/gemini-2.5-flash", messages: [{ role: "user", content: "Salut" }] });
    expect(r.status === 200 && (await r.json()).choices[0].message.content === "ok gemini/gemini-2.5-flash", "a chat model answers");

    // Code AI Stoica offers no picture model either.
    const code = await (await call("/api/code", token)).json();
    const codeIds = (code.data?.models || []).map((m) => m.id);
    expect(codeIds.includes("cx/gpt-5.5") && !codeIds.includes("cx/gpt-image-2"), "Code lists only chat models: " + codeIds.join());
  } finally {
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // The interface: the received list replaces the remembered one (that one only while OmniRoute is down), and a
  // conversation whose model left the list answers with the model chosen in the picker.
  const ui = fs.readFileSync(path.join(__dirname, "..", "renderer", "src", "main.jsx"), "utf8");
  expect(ui.includes("const merged=enforced||!ms.omniUnavailable?live:uniqueModels([...live,...cachedModels()]);"), "main.jsx must not keep models that left OmniRoute");
  expect(ui.includes("const effectiveModel=modelPolicyEnforced||models.length?(models.includes(desiredModel)?desiredModel"), "main.jsx must not send a model that left the list");
  console.log("0.7.16 chat list with chat models only OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
