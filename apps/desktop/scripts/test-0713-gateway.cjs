// 0.7.13 gateway: Scheduled run history, plugin name trigger, memory across chats, Design, free images, clarifying questions.
const fs = require("fs"), http = require("http"), net = require("net"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");
const { parseQuestions, sanitizeQuestions } = require("../lib/questions.cjs");
const { extractHtml, previewToken } = require("../lib/design.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
async function freePort() {
  for (;;) {
    const srv = net.createServer(), p = await listen(srv);
    await new Promise((r) => srv.close(r));
    if (![8787, 5173, 20128].includes(p)) return p;
  }
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const QBLOCK = (header, labels) => "Am nevoie de un detaliu.\n```intrebari\n" + JSON.stringify({ questions: [{ header, question: "Ce format vrei?", options: labels.map((label) => ({ label, description: "d" })) }] }) + "\n```";

function questionTests() {
  const ok = parseQuestions(QBLOCK("Format", ["Prezentare (Recomandat)", "Document"]));
  expect(ok && ok.questions.length === 1 && ok.questions[0].options.length === 2 && ok.questions[0].multiSelect === false, "valid block must parse");
  expect(ok.questions[0].options[0].label === "Prezentare (Recomandat)", "recommended label kept");
  expect(parseQuestions("fără bloc") === null, "no block -> null");
  expect(parseQuestions("```intrebari\n{\"questions\":[\n```") === null, "invalid JSON -> null");
  expect(parseQuestions(QBLOCK("Format", ["Doar una"])) === null, "one option -> null");
  expect(parseQuestions("```intrebari\n{\"questions\":[]}\n```") === null, "no questions -> null");
  const clipped = parseQuestions(QBLOCK("Formatul documentului", ["A", "B", "C", "D", "E"]));
  expect(clipped.questions[0].header.length <= 12 && clipped.questions[0].options.length === 4, "header ≤ 12 chars, max 4 options");
  const words = parseQuestions(QBLOCK("Stil", ["Un raport foarte lung și detaliat (Recomandat)", "Scurt"]));
  expect(words.questions[0].options[0].label === "Un raport foarte lung și (Recomandat)", "label limited to 5 words: " + words.questions[0].options[0].label);
  const many = "```intrebari\n" + JSON.stringify({ questions: [1, 2, 3, 4].map((i) => ({ header: "Q" + i, question: "Întrebarea " + i + "?", options: ["A", "B"] })) }) + "\n```";
  expect(parseQuestions(many).questions.length === 3, "max 3 questions");
  const bad = "Text\n```intrebari\n{nu e json}\n```";
  expect(sanitizeQuestions(bad) === bad, "invalid block must be left as is");
  expect(extractHtml("Iată:\n```html\n<!doctype html><html><head><title>X</title></head><body>a</body></html>\n```\nGata") === "<!doctype html><html><head><title>X</title></head><body>a</body></html>", "fenced HTML extraction");
  expect(extractHtml("<html><body><div>b</div></body></html> text").startsWith("<!doctype html>\n<html>"), "raw <html> extraction adds doctype");
  expect(extractHtml("Nu pot face asta.") === "", "no HTML -> empty");
}

async function main() {
  questionTests();
  const asked = [], pluginHits = [];
  const html = (title, body) => `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0}</style></head><body><main>${body}</main></body></html>`;
  const omni = http.createServer((req, res) => {
    let raw = ""; req.on("data", (c) => raw += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "test/model" }] }));
      if (!req.url.endsWith("/chat/completions")) { res.statusCode = 404; return res.end("{}"); }
      const body = JSON.parse(raw || "{}"); asked.push(body);
      const sys = String(body.messages?.[0]?.role === "system" ? body.messages[0].content : "");
      const last = String([...body.messages].reverse().find((m) => m.role === "user")?.content || "");
      let content = "OK";
      if (sys.includes("Ești designerul AI Stoica")) {
        if (/fără html/i.test(last)) content = "Îmi pare rău, nu pot.";
        else if (body.messages.length > 2) content = "```html\n" + html("Cafenea Aroma", "Versiune nouă: " + last.split("\n")[1]) + "\n```";
        else content = "Iată designul:\n```html\n" + html("Cafenea Aroma", "Prima versiune") + "\n```";
      } else if (/EROARE/.test(last)) { res.statusCode = 500; return res.end("{\"error\":\"down\"}"); }
      else if (/LUNG/.test(last)) content = "x".repeat(5000);
      else if (/intrebari-test/.test(last)) content = QBLOCK("Formatul documentului", ["Prezentare (Recomandat)", "Document"]);
      res.end(JSON.stringify({ model: body.model, choices: [{ message: { role: "assistant", content } }] }));
    });
  });
  const plugins = http.createServer((req, res) => { pluginHits.push(req.url.split("?")[0]); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: req.url.split("?")[0] })); });
  const omniPort = await listen(omni), pluginPort = await listen(plugins);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-0713-"));
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, model: "test/model", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false };
  const port = await freePort(), base = "http://127.0.0.1:" + port;
  const gw = startLocalGateway({ dataDir: dir, port, host: "127.0.0.1", getOmniConfig: () => cfg });
  const realFetch = globalThis.fetch, pollinationsUrls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.startsWith("https://image.pollinations.ai/prompt/")) { pollinationsUrls.push(target); return new Response(png, { status: 200, headers: { "content-type": "image/png" } }); }
    return realFetch(url, init);
  };
  const call = async (p, { method = "GET", headers = {}, body } = {}) => {
    const r = await realFetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
    return { s: r.status, j, text, h: r.headers };
  };
  const lastSystem = () => String(asked[asked.length - 1]?.messages?.[0]?.content || "");
  try {
    await new Promise((r) => setTimeout(r, 150));
    const reg = async (email) => { const r = await call("/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: { email, password: "parola-buna-1" } }); expect(r.s === 200, "register: " + r.j.error); return { authorization: "Bearer " + r.j.token, "content-type": "application/json" }; };
    const A = await reg("a@example.com"), B = await reg("b@example.com");
    const chat = (H, content, extra = {}) => call("/api/chat", { method: "POST", headers: H, body: { messages: [{ role: "user", content }], ...extra } });

    // C3 + C8 preferences
    let r = await call("/auth/me", { headers: A });
    expect(JSON.stringify(r.j.user.preferences) === JSON.stringify({ searchPastChats: true, memoryEnabled: true, askClarifyingQuestions: true }), "default preferences: " + JSON.stringify(r.j.user.preferences));
    r = await call("/api/me/preferences", { method: "PATCH", headers: A, body: { searchPastChats: false, askClarifyingQuestions: false } });
    expect(r.s === 200 && r.j.data.preferences.searchPastChats === false && r.j.data.preferences.askClarifyingQuestions === false && r.j.data.preferences.memoryEnabled === true, "preferences PATCH: " + r.text);
    r = await call("/auth/me", { headers: A });
    expect(r.j.user.preferences.searchPastChats === false && r.j.user.preferences.askClarifyingQuestions === false, "preferences must persist");
    r = await call("/api/me/preferences", { method: "PATCH", headers: A, body: { memoryEnabled: "poate" } });
    expect(r.s === 400, "non-boolean preference must be refused");
    r = await call("/api/me/preferences", { method: "PATCH", headers: A, body: { searchPastChats: true, askClarifyingQuestions: true } });
    expect(r.j.data.preferences.searchPastChats === true, "preferences back on");

    // C8 question rule: chat only, and only when enabled
    r = await chat(A, "Fă-mi o prezentare despre energia solară");
    expect(r.s === 200 && lastSystem().includes("ÎNTREBĂRI DE CLARIFICARE") && lastSystem().includes("```intrebari"), "question rule missing from chat system prompt");
    r = await chat(A, "intrebari-test");
    const sanitized = parseQuestions(r.j.choices[0].message.content);
    expect(sanitized && sanitized.questions[0].header === "Formatul doc", "non-stream chat must return the cleaned question block: " + r.j.choices?.[0]?.message?.content);
    await call("/api/me/preferences", { method: "PATCH", headers: A, body: { askClarifyingQuestions: false } });
    await chat(A, "Fă-mi o prezentare despre energia solară");
    expect(!lastSystem().includes("ÎNTREBĂRI DE CLARIFICARE"), "question rule must disappear when the preference is off");
    await call("/api/me/preferences", { method: "PATCH", headers: A, body: { askClarifyingQuestions: true } });

    // C3 past chats
    const conv = async (H, title, messages) => (await call("/api/conversations", { method: "POST", headers: H, body: { title, messages } })).j.data;
    const now = Date.now();
    const pizza = await conv(A, "Rețetă pizza", [
      { role: "user", content: "Cum fac aluat de pizza napoletană acasă?", displayText: "Cum fac aluat de pizza napoletană acasă?", createdAt: now - 86400000 },
      { role: "assistant", content: "Folosește făină tip 00, apă, sare și drojdie; frământă 10 minute.", createdAt: now - 86400000 }
    ]);
    await conv(A, "Altceva", [{ role: "user", content: "Care e capitala Franței?" }, { role: "assistant", content: "Paris." }]);
    await conv(B, "Pizza lui B", [{ role: "user", content: "Aluat de pizza napoletană cu ingredient secret" }, { role: "assistant", content: "SECRET_B_ANSWER" }]);
    await call(`/api/conversations/${pizza.id}`, { method: "PUT", headers: A, body: { archived: true } });
    const question = "Ce făină folosesc pentru aluatul de pizza napoletană?";
    const current = await conv(A, "Curent", [{ role: "user", content: question, displayText: question }]);
    r = await chat(A, question, { conversationId: current.id });
    let sys = lastSystem();
    expect(r.s === 200 && sys.includes("DIN CONVERSAȚIILE ANTERIOARE ALE UTILIZATORULUI — folosește doar dacă are legătură cu întrebarea; poți spune din ce conversație vine:"), "past chats block missing:\n" + sys.slice(0, 3000));
    expect(sys.includes("[«Rețetă pizza» · ") && sys.includes("Utilizator: Cum fac aluat de pizza napoletană acasă? / AI Stoica: Folosește făină tip 00"), "past chats snippet format: " + sys);
    expect(!sys.includes("SECRET_B_ANSWER") && !sys.includes("ingredient secret"), "another user's chat leaked into the context");
    expect(!sys.includes("«Curent»") && !sys.includes("«Altceva»"), "current or unrelated conversation must not be included");
    const block = sys.slice(sys.indexOf("DIN CONVERSAȚIILE"));
    expect(block.split("\n\n")[0].length <= 3500, "past chats block too long");
    await chat(A, question);
    expect(lastSystem().includes("«Rețetă pizza»") && !lastSystem().includes("«Curent»"), "without conversationId the just-saved current conversation must be skipped");
    await chat(A, "salut!", { conversationId: current.id });
    expect(!lastSystem().includes("DIN CONVERSAȚIILE ANTERIOARE"), "short messages must not search past chats");
    await call("/api/me/preferences", { method: "PATCH", headers: A, body: { searchPastChats: false } });
    await chat(A, question, { conversationId: current.id });
    expect(!lastSystem().includes("DIN CONVERSAȚIILE ANTERIOARE"), "past chats block must be absent when the preference is off");
    await call("/api/me/preferences", { method: "PATCH", headers: A, body: { searchPastChats: true } });

    // C2 plugin name trigger
    const plugin = async (name, p, extra = {}) => { const x = await call("/api/plugins", { method: "POST", headers: A, body: { name, url: `http://127.0.0.1:${pluginPort}/${p}`, method: "GET", ...extra } }); expect(x.s === 200, "plugin create: " + x.text); return x.j.data; };
    for (const [n, p] of [["Alfa", "alfa"], ["Beta", "beta"], ["Gamma", "gamma"], ["Delta", "delta"], ["AI", "ai"], ["Știri", "stiri"]]) await plugin(n, p);
    const off = await plugin("Meteo", "meteo");
    await call(`/api/plugins/${off.id}`, { method: "PATCH", headers: A, body: { enabled: false } });
    pluginHits.length = 0;
    await chat(A, "Folosește alfa, BETA, gamma și Delta pentru meteo de mâine, apoi AI rezumă");
    const four = pluginHits.filter((x) => ["/alfa", "/beta", "/gamma", "/delta"].includes(x));
    expect(four.length === 3, "at most 3 plugins per message by name, got " + JSON.stringify(pluginHits));
    expect(!pluginHits.includes("/ai"), "names shorter than 3 characters must not trigger by name");
    expect(!pluginHits.includes("/meteo"), "a disabled plugin must not be triggered");
    expect(lastSystem().includes("Rezultate furnizate de pluginuri conectate") && lastSystem().includes("Plugin Alfa:"), "plugin results must go into the context block");
    pluginHits.length = 0;
    await chat(A, "Ce spun stirile? Arată-mi ultimele știri");
    expect(pluginHits.includes("/stiri") && pluginHits.length === 1, "diacritics-insensitive name trigger: " + JSON.stringify(pluginHits));
    pluginHits.length = 0;
    await chat(A, "Calendarul gammaului nu contează");
    expect(!pluginHits.length, "name must match as a whole word: " + JSON.stringify(pluginHits));
    pluginHits.length = 0;
    await chat(A, "@ai rezumă");
    expect(pluginHits.includes("/ai"), "@trigger must still work for short names");

    // C1 Scheduled: run history and duplicate
    r = await call("/api/automations", { method: "POST", headers: A, body: { title: "Raport zilnic", prompt: "Scrie LUNG raportul", frequency: "daily", time: "09:00" } });
    expect(r.s === 200, "automation create: " + r.text);
    const auto = r.j.data;
    expect(!("runs" in auto) && auto.nextRunAt && auto.enabled === true && auto.frequency === "daily" && auto.time === "09:00" && "timeZone" in auto, "publicAutomation fields: " + JSON.stringify(auto));
    r = await call(`/api/automations/${auto.id}/run`, { method: "POST", headers: A, body: {} });
    expect(r.s === 200 && !("runs" in r.j.data), "manual run: " + r.text);
    expect(!lastSystem().includes("ÎNTREBĂRI DE CLARIFICARE"), "automations must not get the question rule");
    await call(`/api/automations/${auto.id}`, { method: "PATCH", headers: A, body: { prompt: "Raport EROARE" } });
    r = await call(`/api/automations/${auto.id}/run`, { method: "POST", headers: A, body: {} });
    expect(r.s >= 500, "failing run must fail: " + r.s);
    r = await call(`/api/automations/${auto.id}/runs`, { headers: A });
    expect(r.s === 200 && r.j.data.length === 2, "two runs recorded: " + r.text.slice(0, 300));
    const [newest, older] = r.j.data;
    expect(newest.status === "error" && older.status === "ok" && newest.at >= older.at, "runs newest first with statuses");
    expect(older.result.length === 4000 && older.model === "test/model" && older.id && older.at, "run result trimmed to 4000 and model recorded");
    r = await call("/api/automations", { headers: A });
    expect(r.j.data.every((x) => !("runs" in x)), "automation list must not include runs");
    r = await call(`/api/automations/${auto.id}/duplicate`, { method: "POST", headers: A, body: {} });
    expect(r.s === 200 && r.j.data.title === "Raport zilnic (copie)" && r.j.data.enabled === false && r.j.data.nextRunAt === null && r.j.data.id !== auto.id, "duplicate: " + r.text);
    expect((await call(`/api/automations/${r.j.data.id}/runs`, { headers: A })).j.data.length === 0, "duplicate starts without history");
    expect((await call(`/api/automations/${auto.id}/runs`, { headers: B })).s === 404, "another user's runs must be 404");
    expect((await call(`/api/automations/${auto.id}/duplicate`, { method: "POST", headers: B, body: {} })).s === 404, "another user's duplicate must be 404");

    // C5 Design
    expect((await call("/api/designs", { method: "POST", headers: A, body: { prompt: " ", kind: "site" } })).s === 400, "empty design prompt -> 400");
    expect((await call("/api/designs", { method: "POST", headers: A, body: { prompt: "Un site", kind: "rachetă" } })).s === 400, "invalid kind -> 400");
    r = await call("/api/designs", { method: "POST", headers: A, body: { prompt: "Vreau ceva fără HTML", kind: "site" } });
    expect(r.s === 502 && /nu a returnat o pagină HTML/.test(r.j.error), "no HTML -> 502 with a Romanian message: " + r.text);
    r = await call("/api/designs", { method: "POST", headers: A, body: { prompt: "Site pentru o cafenea din Cluj", kind: "site" } });
    expect(r.s === 200 && r.j.data.latest === 1 && r.j.data.versions.length === 1 && r.j.data.title === "Cafenea Aroma" && !("html" in r.j.data), "design create: " + r.text);
    expect(lastSystem().includes("Ești designerul AI Stoica") && !lastSystem().includes("ÎNTREBĂRI DE CLARIFICARE") && !lastSystem().includes("DIN CONVERSAȚIILE ANTERIOARE"), "design must use only its own system prompt");
    const design = r.j.data;
    r = await call("/api/designs", { headers: A });
    expect(r.j.data.length === 1 && r.j.data[0].versionCount === 1 && !("versions" in r.j.data[0]) && !("html" in r.j.data[0]), "design list shape: " + r.text);
    r = await call(`/api/designs/${design.id}/revise`, { method: "POST", headers: A, body: { instructions: "Fundal verde" } });
    expect(r.s === 200 && r.j.data.latest === 2 && r.j.data.versions[1].prompt === "Fundal verde", "revise: " + r.text);
    expect(asked[asked.length - 1].messages.some((m) => m.role === "assistant" && String(m.content).includes("Prima versiune")), "revise must send the previous HTML");
    r = await call(`/api/designs/${design.id}/preview-token?v=2`, { headers: A });
    expect(r.s === 200 && r.j.data.url.startsWith(`http://127.0.0.1:${port}/api/designs/${design.id}/preview?v=2&t=`), "preview-token: " + r.text);
    const previewUrl = r.j.data.url;
    let p = await realFetch(previewUrl);
    let pbody = await p.text();
    expect(p.status === 200 && pbody.includes("Versiune nouă: Fundal verde"), "preview must serve version 2 without Authorization");
    expect(p.headers.get("content-type") === "text/html; charset=utf-8" && p.headers.get("content-security-policy") === "sandbox allow-scripts allow-forms allow-popups" && p.headers.get("x-content-type-options") === "nosniff" && p.headers.get("cache-control") === "no-store" && !p.headers.get("x-frame-options"), "preview headers: " + JSON.stringify([...p.headers]));
    p = await realFetch(previewUrl, { headers: { origin: "null" } });
    expect(p.status === 200, "preview must load from an iframe with Origin null");
    p = await realFetch(previewUrl.replace(/t=(\d+)\.[^&]+/, "t=$1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    pbody = await p.text();
    expect(p.status === 401 && pbody.includes("Linkul de previzualizare a expirat.") && !/json/.test(p.headers.get("content-type") || ""), "tampered token -> 401 page");
    const secret = fs.readFileSync(path.join(dir, "auth-secret.txt"), "utf8").trim();
    const userA = JSON.parse(fs.readFileSync(path.join(dir, "ai-stoica-data.json"), "utf8")).users.find((u) => u.email === "a@example.com");
    const expired = previewToken(secret, userA.id, design.id, 2, Date.now() - 16 * 60 * 1000);
    p = await realFetch(`${base}/api/designs/${design.id}/preview?v=2&t=${encodeURIComponent(expired)}`);
    expect(p.status === 401 && (await p.text()).includes("Linkul de previzualizare a expirat."), "expired token -> 401");
    expect((await call(`/api/designs/${design.id}/preview-token?v=9`, { headers: A })).s === 404, "unknown version -> 404");
    p = await realFetch(`${base}/api/designs/${design.id}/download?v=1`, { headers: A });
    const dl = await p.text();
    expect(p.status === 200 && /^attachment; filename="Cafenea Aroma\.html"/.test(p.headers.get("content-disposition") || "") && dl.startsWith("<!doctype html>") && dl.includes("Prima versiune"), "download: " + p.headers.get("content-disposition"));
    r = await call(`/api/designs/${design.id}`, { method: "PATCH", headers: A, body: { title: "Cafenea nouă" } });
    expect(r.s === 200 && r.j.data.title === "Cafenea nouă", "rename design");
    expect((await call(`/api/designs/${design.id}`, { method: "PATCH", headers: A, body: { title: "" } })).s === 400, "empty title -> 400");
    for (const [m, suffix] of [["GET", ""], ["GET", "/preview-token"], ["GET", "/download"], ["PATCH", ""], ["DELETE", ""], ["POST", "/revise"]]) {
      const x = await call(`/api/designs/${design.id}${suffix}`, { method: m, headers: B, body: m === "GET" || m === "DELETE" ? undefined : { title: "x", instructions: "x" } });
      expect(x.s === 404, `another user's design ${m} ${suffix} must be 404, got ${x.s}`);
    }
    expect((await call("/api/designs", { headers: B })).j.data.length === 0, "another user's designs must not be listed");
    for (let i = 0; i < 29; i++) { r = await call(`/api/designs/${design.id}/revise`, { method: "POST", headers: A, body: { instructions: "Pas " + i } }); expect(r.s === 200, "revise loop: " + r.text); }
    expect(r.j.data.versionCount === 30 && r.j.data.versions[0].n === 2 && r.j.data.latest === 31, "max 30 versions kept: " + JSON.stringify(r.j.data.versions.slice(0, 2)));
    expect(!fs.existsSync(path.join(dir, "designs", design.id, "v1.html")) && fs.existsSync(path.join(dir, "designs", design.id, "v31.html")), "oldest version file must be removed");
    expect((await call(`/api/designs/${design.id}`, { method: "DELETE", headers: A })).s === 200, "delete design");
    expect((await call(`/api/designs/${design.id}`, { headers: A })).s === 404 && !fs.existsSync(path.join(dir, "designs", design.id)), "deleted design is gone");
    expect((await realFetch(previewUrl)).status === 401, "preview of a deleted design must not be served");

    // C6 images without any key, video message
    cfg.imageCostPolicy = "free_only";
    r = await call("/api/generate/image", { method: "POST", headers: A, body: { prompt: "o pisică pe lună", size: "512x512" } });
    expect(r.s === 200 && r.j.data.provider === "pollinations-free" && r.j.data.kind === "image", "free image without keys: " + r.text);
    const pu = new URL(pollinationsUrls[pollinationsUrls.length - 1]);
    expect(decodeURIComponent(pu.pathname) === "/prompt/o pisică pe lună" && pu.searchParams.get("width") === "512" && pu.searchParams.get("height") === "512" && pu.searchParams.get("model") === "flux" && pu.searchParams.get("nologo") === "true" && /^\d+$/.test(pu.searchParams.get("seed")), "pollinations URL: " + pu);
    p = await realFetch(`${base}/api/files/${r.j.data.id}`, { headers: A });
    expect(p.ok && Buffer.from(await p.arrayBuffer()).subarray(0, 8).equals(png.subarray(0, 8)), "free image saved as a real PNG");
    r = await call("/api/generate/video", { method: "POST", headers: A, body: { prompt: "un apus la mare" } });
    expect(r.s === 400 && r.j.error === "Pentru video e nevoie de o cheie la Pollinations, fal.ai, Replicate sau Gemini (Veo) și de permisiunea pentru costuri din Setări → Video. Nu există în prezent un API video gratuit.", "video without providers: " + r.text);
    console.log("GATEWAY_0713_TESTS_PASSED");
  } finally {
    globalThis.fetch = realFetch;
    await gw.close(); omni.close(); plugins.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
