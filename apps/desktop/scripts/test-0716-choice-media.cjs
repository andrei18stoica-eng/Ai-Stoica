// 0.7.16: the model you choose is the one that answers (no silent switch to Cerebras or another direct API), a request
// without a model goes to your own OmniRoute combination, images go through the ChatGPT subscription (OmniRoute Codex)
// before the free/paid APIs, and the free OmniRoute web video models work under «Doar gratuit».
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const mp4 = Buffer.concat([Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex"), Buffer.alloc(64)]);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-0716-"));
  const asked = { chat: [], image: [], video: [] };
  let codexDown = false, groqDown = false;
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models" && req.method === "GET") return res.end(JSON.stringify({ data: [
        { id: "auto/best-coding", owned_by: "combo" }, { id: "Ai principal", owned_by: "combo" },
        { id: "broken/model", owned_by: "broken" },
        { id: "fal-ai/kling-video", owned_by: "fal-ai", type: "video" },
        { id: "openrouter/flux-image", owned_by: "openrouter", type: "image" },
        { id: "codex/gpt-5.6-sol", owned_by: "codex", name: "GPT 5.6 Sol (Codex Image)", type: "image" },
        { id: "veoaifree-web/veo", owned_by: "veoaifree-web", name: "VEO 3.1", type: "video" }
      ] }));
      const j = body ? JSON.parse(body) : {};
      if (req.url === "/v1/chat/completions") {
        asked.chat.push(j.model);
        if (j.model === "broken/model") { res.statusCode = 500; return res.end(JSON.stringify({ error: { message: "upstream provider down" } })); }
        return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OMNI " + j.model } }] }));
      }
      if (req.url === "/v1/images/generations" && req.method === "POST" && codexDown) { asked.image.push(j.model); res.statusCode = 500; return res.end(JSON.stringify({ error: { message: "codex down" } })); }
      if (req.url === "/v1/images/generations" && req.method === "POST") { asked.image.push(j.model); return res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] })); }
      if (req.url === "/v1/videos/generations" && req.method === "POST") { asked.video.push(j.model); res.setHeader("content-type", "video/mp4"); return res.end(mp4); }
      res.statusCode = 404; res.end("{}");
    });
  });
  const omniPort = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "sk-omni", model: "", imageProviders: "", videoProviders: "", webSearchEnabled: false, githubAutoContext: false,
    directChatEnabled: true, directChatProviderOrder: "cerebras,groq", blockedProviders: "", cerebrasApiKey: "k-cerebras", groqApiKey: "k-groq",
    openAiApiKey: "sk-openai-test", pollinationsFreeEnabled: false, imageProviderOrder: "openai", imageCostPolicy: "allow_paid" };
  const calls = { cerebras: 0, groq: 0, openai: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u === "https://api.cerebras.ai/v1/chat/completions") { calls.cerebras++; return new Response(JSON.stringify({ choices: [{ message: { content: "CEREBRAS" } }] }), { status: 200, headers: { "content-type": "application/json" } }); }
    if (u === "https://api.groq.com/openai/v1/chat/completions") { calls.groq++; if (groqDown) return new Response(JSON.stringify({ error: { message: "groq down" } }), { status: 500, headers: { "content-type": "application/json" } }); return new Response(JSON.stringify({ choices: [{ message: { content: "GROQ " + JSON.parse(init.body).model } }] }), { status: 200, headers: { "content-type": "application/json" } }); }
    if (u.startsWith("https://api.openai.com/v1/images")) { calls.openai++; return new Response(png, { status: 200, headers: { "content-type": "image/png" } }); }
    if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
    return new Response("{}", { status: 503 });
  };
  const gw = startLocalGateway({ dataDir: dir, port: 8874, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8874";
  const call = (p, { method = "GET", body, token } = {}) => realFetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    let r = await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } });
    const token = (await r.json()).token; expect(token, "register failed");
    const chat = (model) => call("/api/chat", { method: "POST", token, body: { model, messages: [{ role: "user", content: "salut" }] } });

    // A chosen model that fails: its error, not an answer from Cerebras.
    r = await chat("broken/model"); let j = await r.json();
    expect(r.status === 502 && /Modelul ales «broken\/model» nu a răspuns/.test(j.error) && /upstream provider down/.test(j.error), "a failing chosen model must report its own error: " + JSON.stringify(j));
    expect(calls.cerebras === 0 && calls.groq === 0, "no direct API may answer in place of the chosen model: " + JSON.stringify(calls));
    // Streaming too.
    r = await call("/api/chat/stream", { method: "POST", token, body: { model: "broken/model", messages: [{ role: "user", content: "salut" }] } });
    expect(r.status === 502 && calls.cerebras === 0, "streaming must not switch provider either: " + r.status);

    // A direct-API model from the list (not in OmniRoute) is answered by that API, and only by it.
    r = await chat("groq/llama-test"); j = await r.json();
    expect(r.status === 200 && r.headers.get("x-ai-stoica-route") === "direct" && j.choices[0].message.content === "GROQ llama-test" && calls.cerebras === 0, "a chosen direct-API model must answer: " + JSON.stringify({ status: r.status, j, calls }));
    r = await call("/api/chat/stream", { method: "POST", token, body: { model: "groq/llama-test", messages: [{ role: "user", content: "salut" }] } });
    expect(r.status === 200 && /GROQ llama-test/.test(await r.text()), "streaming with a chosen direct-API model");
    groqDown = true;
    r = await chat("groq/llama-test"); j = await r.json();
    expect(r.status === 502 && /Modelul ales «groq\/llama-test»/.test(j.error) && calls.cerebras === 0, "a failing direct-API model must not be replaced by another API: " + JSON.stringify({ j, calls }));
    groqDown = false;

    // «Rezervă automată» on: the direct APIs answer when the chosen model fails.
    cfg.chatFallbackOnFailure = true; await new Promise((x) => setTimeout(x, 2100));
    r = await chat("broken/model"); j = await r.json();
    expect(r.status === 200 && r.headers.get("x-ai-stoica-route") === "direct-fallback" && j.choices[0].message.content === "CEREBRAS", "with «Rezervă automată» the direct APIs answer: " + JSON.stringify(j));
    cfg.chatFallbackOnFailure = false; await new Promise((x) => setTimeout(x, 2100));

    // No model chosen: your own combination ("Ai principal"), before auto/* and the direct APIs.
    const before = { ...calls };
    r = await chat(""); j = await r.json();
    expect(r.status === 200 && j.choices[0].message.content === "OMNI Ai principal" && asked.chat.at(-1) === "Ai principal", "without a model the main combination must answer: " + JSON.stringify(j) + " asked " + asked.chat);
    expect(r.headers.get("x-ai-stoica-route") === "auto" && calls.cerebras === before.cerebras, "the route must be the automatic combination, not a direct API");

    // Images: the ChatGPT subscription (Codex) before OpenAI and before OmniRoute's other image models.
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "un logo albastru" } }); j = await r.json();
    expect(r.status === 200 && asked.image[0] === "codex/gpt-5.6-sol" && calls.openai === 0, "the image must come from the ChatGPT subscription first: " + JSON.stringify({ status: r.status, asked: asked.image, calls, j }).slice(0, 400));

    // The model that worked stays bound: when it fails once, the next one that works (OpenAI) is tried first after that.
    codexDown = true;
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "un logo verde" } });
    expect(r.status === 200 && calls.openai === 1, "when the bound model fails, the next one must answer: " + JSON.stringify({ status: r.status, asked: asked.image, calls }));
    const askedBefore = asked.image.length;
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "un logo roșu" } });
    expect(r.status === 200 && calls.openai === 2 && asked.image.length === askedBefore, "the model that worked last must be tried first: " + JSON.stringify({ asked: asked.image, calls }));
    const prefs = JSON.parse(fs.readFileSync(path.join(dir, "media-prefs.json"), "utf8"));
    expect(Object.keys(prefs).length === 1 && Object.values(prefs)[0].image?.id === "openai", "the bound image model must be saved for this account: " + JSON.stringify(prefs));
    codexDown = false;

    // An image model chosen in Settings goes before the subscription models and the bound one.
    cfg.imageModel = "openrouter/flux-image"; await new Promise((x) => setTimeout(x, 2100));
    const firstAsked = asked.image.length;
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "un logo galben" } });
    expect(r.status === 200 && asked.image[firstAsked] === "openrouter/flux-image", "the image model chosen in Settings must be tried first: " + JSON.stringify(asked.image.slice(firstAsked)));
    cfg.imageModel = ""; await new Promise((x) => setTimeout(x, 2100));

    // The Owner's personal subscriptions (ChatGPT/Codex connected in OmniRoute) are for the Owner only: another account
    // does not see them, cannot choose them, and its images skip them.
    cfg.ownerEmail = "boss@example.com"; await new Promise((x) => setTimeout(x, 2100));
    r = await call("/api/models", { token }); j = await r.json();
    expect(r.status === 200 && !(j.data || []).some((x) => /^codex\//.test(x.id || x)), "another account must not see the Owner's subscription models: " + JSON.stringify(j.data).slice(0, 300));
    r = await chat("codex/gpt-5.6-sol"); j = await r.json();
    expect(r.status === 403 && /abonamentul personal al Owner-ului/.test(j.error), "another account must not chat through the Owner's subscription: " + JSON.stringify(j));
    const beforePersonal = asked.image.length;
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "un logo mov" } });
    expect(r.status === 200 && !asked.image.slice(beforePersonal).includes("codex/gpt-5.6-sol"), "another account's images must skip the Owner's subscription: " + JSON.stringify(asked.image.slice(beforePersonal)));
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "un logo mov", model: "codex/gpt-5.6-sol" } });
    expect(r.status === 403, "another account must not pick the Owner's subscription image model: " + r.status);
    // The Owner keeps them all: the Owner's account sees, chooses and draws with the subscription models.
    cfg.ownerEmail = "owner@example.com"; await new Promise((x) => setTimeout(x, 2100));
    r = await call("/api/models", { token }); j = await r.json();
    expect(r.status === 200 && (j.data || []).some((x) => (x.id || x) === "codex/gpt-5.6-sol"), "the Owner must see the subscription models: " + JSON.stringify(j.data).slice(0, 300));
    r = await chat("codex/gpt-5.6-sol"); j = await r.json();
    expect(r.status === 200 && j.choices[0].message.content === "OMNI codex/gpt-5.6-sol", "the Owner must chat through the subscription: " + JSON.stringify(j));
    const beforeOwner = asked.image.length;
    r = await call("/api/generate/image", { method: "POST", token, body: { prompt: "un logo auriu", model: "codex/gpt-5.6-sol" } });
    expect(r.status === 200 && asked.image.slice(beforeOwner).includes("codex/gpt-5.6-sol"), "the Owner's images may use the subscription: " + JSON.stringify(asked.image.slice(beforeOwner)));
    cfg.ownerEmail = ""; await new Promise((x) => setTimeout(x, 2100));

    // Video under «Doar gratuit» (no cost policy set): the free OmniRoute web model, never the paid one.
    r = await call("/api/generate/video", { method: "POST", token, body: { prompt: "un apus pe mare" } }); j = await r.json();
    expect(r.status === 200 && asked.video.length === 1 && asked.video[0] === "veoaifree-web/veo", "free web video must work under «Doar gratuit»: " + JSON.stringify({ status: r.status, asked: asked.video, j }).slice(0, 400));

    // Files open inside AI Stoica: a Word file shows its text through /preview, only for its owner.
    const { createExportBytes } = require("../lib/documents.cjs");
    const docx = (await createExportBytes("docx", "Raport", "# Raport\n\nVânzări în creștere cu 12%.")).bytes;
    r = await realFetch(base + "/api/library/upload", { method: "POST", headers: { authorization: "Bearer " + token, "x-file-name": encodeURIComponent("raport.docx"), "x-file-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x-file-size": String(docx.length) }, body: docx });
    const fileId = (await r.json()).data?.id; expect(fileId, "upload failed");
    r = await call(`/api/library/${fileId}/preview`, { token }); j = await r.json();
    expect(r.status === 200 && /Vânzări în creștere cu 12%/.test(j.data?.text || ""), "the Word preview must show the text: " + JSON.stringify(j).slice(0, 300));
    r = await call("/auth/register", { method: "POST", body: { email: "other@example.com", password: "password123", name: "Other" } });
    const other = (await r.json()).token;
    r = await call(`/api/library/${fileId}/preview`, { token: other });
    expect(r.status === 404 || r.status === 403, "another account must not open the file: " + r.status);

    // Renaming a file: the extension stays, forbidden characters go, the conversations showing it follow.
    r = await call("/api/conversations", { method: "POST", token, body: { title: "Raport", messages: [{ id: "m1", role: "assistant", content: "Iată raportul.", attachments: [{ id: fileId, libraryId: fileId, name: "raport.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }] }] } });
    const convId = (await r.json()).data?.id; expect(convId, "conversation with the file");
    r = await call(`/api/library/${fileId}`, { method: "PATCH", token, body: { name: "  Raport final: T4/2026  " } }); j = await r.json();
    expect(r.status === 200 && j.data.name === "Raport final T4 2026.docx", "rename keeps the extension and drops : / — got " + JSON.stringify(j));
    r = await call("/api/library", { token }); j = await r.json();
    expect(j.data.find((x) => x.id === fileId)?.name === "Raport final T4 2026.docx", "the Library shows the new name");
    r = await call("/api/conversations", { token }); j = await r.json();
    const att = ((j.data || []).find((c) => c.id === convId)?.messages || [])[0]?.attachments?.[0];
    expect(att && att.name === "Raport final T4 2026.docx", "the conversation shows the new name: " + JSON.stringify(att));
    r = await call(`/api/library/${fileId}`, { method: "PATCH", token, body: { name: "contract.pdf" } }); j = await r.json();
    expect(j.data.name === "contract.pdf", "a name with its own extension is kept as written");
    r = await call(`/api/library/${fileId}`, { method: "PATCH", token, body: { name: " ../ " } });
    expect(r.status === 400, "an empty name is refused: " + r.status);
    r = await call(`/api/library/${fileId}`, { method: "PATCH", token: other, body: { name: "furat" } });
    expect(r.status === 404, "another account must not rename the file: " + r.status);
    console.log("0.7.16 model choice and media checks OK");
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
