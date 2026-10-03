// Regression tests for the 0.7.11 fixes (schedules, permissions, sessions, images, SSRF, exports, timeouts).
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const JSZip = require("jszip");
const { startLocalGateway } = require("../local-gateway.cjs");
const { nextRun, validateAutomation } = require("../lib/schedule.cjs");
const { safeRequest, isBlockedAddress } = require("../lib/netguard.cjs");
const { extractText } = require("../lib/extract.cjs");
const docs = require("../lib/documents.cjs");
const memory = require("../lib/memory.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
function listen(server, host = "127.0.0.1") { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, host, () => resolve(server.address().port)); }); }
function closeServer(server) { return new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }); }
async function jsonBody(req) { let b = ""; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function testSchedule() {
  const from = Date.UTC(2026, 9, 3, 10, 0);
  const t0 = Date.now();
  expect(nextRun({ frequency: "weekly", weekday: 7, time: "09:00" }, from) === null, "weekday 7 must not loop forever");
  expect(nextRun({ frequency: "selected_days", days: ["luni"], time: "09:00" }, from) === null, "invalid days must not loop forever");
  expect(Date.now() - t0 < 200, "nextRun took too long");
  expect(new Date(nextRun({ frequency: "daily", time: "09:00", timeZone: "Europe/Bucharest" }, from)).toISOString() === "2026-10-04T06:00:00.000Z", "Bucharest daily schedule wrong");
  expect(new Date(nextRun({ frequency: "daily", time: "09:00", timeZone: "Europe/Bucharest" }, Date.UTC(2026, 9, 25, 12))).toISOString() === "2026-10-26T07:00:00.000Z", "Schedule after DST change wrong");
  expect(new Date(nextRun({ frequency: "monthly", monthday: 28, time: "09:00", timeZone: "Europe/Bucharest" }, from)).toISOString() === "2026-10-28T07:00:00.000Z", "Monthly schedule wrong");
  expect(nextRun({ frequency: "hourly", intervalHours: 5 }, from) === from + 3600000, "Hourly must be one hour");
  expect(validateAutomation({ title: "t", prompt: "p", frequency: "weekly", weekday: 7 }).error, "weekday 7 must be rejected");
  expect(validateAutomation({ title: "t", prompt: "p", frequency: "daily", time: "25:70" }).error, "time 25:70 must be rejected");
  expect(validateAutomation({ title: "t", prompt: "p", frequency: "yearly" }).error, "unknown frequency must be rejected");
  expect(validateAutomation({ title: "t", prompt: "p", frequency: "once", runAt: Date.now() - 1000 }).error, "past one-time run must be rejected");
  expect(validateAutomation({ title: "x".repeat(121), prompt: "p" }).error, "long title must be rejected");
  expect(validateAutomation({ title: "t", prompt: "p", enabled: "false" }).value.enabled === false, "string boolean not converted");
  expect(validateAutomation({ title: "t", prompt: "p", timingMode: "flexible_schedule" }).value.timingMode === "exact_schedule", "flexible_schedule must become exact");
}

async function testNetguard() {
  for (const ip of ["127.0.0.1", "0.0.0.0", "10.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.5.4", "192.168.1.1", "::1", "[::1]", "::ffff:127.0.0.1", "::ffff:7f00:1", "fd00::1", "fe80::1"]) expect(isBlockedAddress(ip), "Address must be blocked: " + ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(!isBlockedAddress(ip), "Public address must be allowed: " + ip);
  const target = http.createServer((req, res) => res.end("SECRET")); const tPort = await listen(target);
  const hop = http.createServer((req, res) => { res.statusCode = 302; res.setHeader("location", `http://127.0.0.2:${tPort}/x`); res.end(); }); const hPort = await listen(hop);
  const loop = http.createServer((req, res) => { res.statusCode = 302; res.setHeader("location", "/again"); res.end(); }); const lPort = await listen(loop);
  try {
    for (const url of [`http://127.0.0.1:${tPort}/`, `http://0.0.0.0:${tPort}/`, `http://localhost:${tPort}/`]) {
      let err = null; try { await safeRequest(url, { timeout: 3000 }); } catch (e) { err = e; }
      expect(err && err.code === "EBLOCKED", "Local address was not blocked: " + url);
    }
    // 127.0.0.1 is treated as public here, so only the redirect target (127.0.0.2) is refused.
    const onlySecond = (ip) => ip !== "127.0.0.1";
    let err = null; try { await safeRequest(`http://127.0.0.1:${hPort}/`, { timeout: 3000, isBlocked: onlySecond }); } catch (e) { err = e; }
    expect(err && err.code === "EBLOCKED", "Redirect to a private address was not re-checked");
    err = null; try { await safeRequest(`http://127.0.0.1:${lPort}/`, { timeout: 3000, isBlocked: onlySecond }); } catch (e) { err = e; }
    expect(err && err.code === "EREDIRECT", "Redirect loop must stop after 5 hops");
    const ok = await safeRequest(`http://127.0.0.1:${tPort}/`, { timeout: 3000, isBlocked: onlySecond, maxBytes: 3, truncate: true });
    expect(ok.ok && (await ok.text()) === "SEC", "Response size cap not applied");
  } finally { await closeServer(target); await closeServer(hop); await closeServer(loop); }
}

async function testExtraction(dir) {
  // 200 MB of compressed zeros in a 200 KB PDF must not be inflated beyond the cap.
  const comp = zlib.deflateSync(Buffer.alloc(200 * 1024 * 1024, 0x20), { level: 9 });
  const pdf = Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${comp.length} /Filter /FlateDecode >>\nstream\n`), comp, Buffer.from("\nendstream\nendobj\n%%EOF\n")]);
  fs.writeFileSync(path.join(dir, "bomb.pdf"), pdf);
  const before = process.memoryUsage().rss;
  const r = await extractText(path.join(dir, "bomb.pdf"), "application/pdf", "bomb.pdf");
  expect(r.status === "empty", "PDF bomb should yield no text: " + r.status);
  expect(process.memoryUsage().rss - before < 400 * 1024 * 1024, "PDF bomb used too much memory");
  const zip = new JSZip(); zip.file("word/document.xml", Buffer.alloc(80 * 1024 * 1024, 0x20));
  fs.writeFileSync(path.join(dir, "bomb.docx"), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  const t0 = Date.now(), bomb = await extractText(path.join(dir, "bomb.docx"), "", "bomb.docx");
  expect(bomb.status === "empty" && Date.now() - t0 < 15000, "DOCX bomb must be cut at the cap quickly: " + bomb.status + " " + (Date.now() - t0) + "ms");
  // A big but honest spreadsheet (sheet XML above the per-entry cap) still gives its first rows instead of an error.
  const rows = []; for (let i = 1; i <= 70000; i++) rows.push(`<row r="${i}"><c r="A${i}" t="inlineStr"><is><t>Client ${i}</t></is></c><c r="B${i}"><v>${i * 10}</v></c><c r="C${i}" t="inlineStr"><is><t>${"x".repeat(600)}</t></is></c></row>`);
  const big = new JSZip(); big.file("xl/workbook.xml", '<workbook><sheets><sheet name="Date" r:id="rId1"/></sheets></workbook>'); big.file("xl/worksheets/sheet1.xml", "<worksheet><sheetData>" + rows.join("") + "</sheetData></worksheet>");
  fs.writeFileSync(path.join(dir, "big.xlsx"), await big.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  const bigText = await extractText(path.join(dir, "big.xlsx"), "", "big.xlsx");
  expect(bigText.status === "ok" && bigText.text.includes("Client 1\t10"), "Large XLSX must keep its first rows: " + bigText.status);
  const docx = new JSZip(); docx.file("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>Bun &#x110000; rest</w:t></w:r></w:p></w:body></w:document>");
  fs.writeFileSync(path.join(dir, "cp.docx"), await docx.generateAsync({ type: "nodebuffer" }));
  expect((await extractText(path.join(dir, "cp.docx"), "", "cp.docx")).text === "Bun � rest", "Invalid code point must become U+FFFD");
  fs.writeFileSync(path.join(dir, "ro.csv"), Buffer.from([0x46, 0x61, 0x63, 0x74, 0x75, 0x72, 0xe3, 0x3b, 0xba, 0x6f, 0x73, 0x65, 0x61]));
  expect((await extractText(path.join(dir, "ro.csv"), "text/csv", "ro.csv")).text === "Factură;şosea", "Windows-1250 text not decoded");
  fs.writeFileSync(path.join(dir, "u16.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Țară mică", "utf16le")]));
  expect((await extractText(path.join(dir, "u16.txt"), "text/plain", "u16.txt")).text === "Țară mică", "UTF-16 text not decoded");
  const x = new JSZip();
  x.file("xl/workbook.xml", '<workbook><sheets><sheet name="Vânzări" sheetId="1" r:id="rId2"/><sheet name="Prima" sheetId="2" r:id="rId1"/></sheets></workbook>');
  x.file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>');
  x.file("xl/styles.xml", '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>');
  x.file("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><r><t>Pri</t></r><r><t>ma</t></r></is></c></row></sheetData></worksheet>');
  x.file("xl/worksheets/sheet2.xml", '<worksheet><sheetData><row r="1"><c r="A1"><v>2</v></c><c r="C1"><f t="shared" si="0"/><v>20</v></c><c r="D1" s="1"><v>45931</v></c></row></sheetData></worksheet>');
  fs.writeFileSync(path.join(dir, "x.xlsx"), await x.generateAsync({ type: "nodebuffer" }));
  const xt = (await extractText(path.join(dir, "x.xlsx"), "", "x.xlsx")).text;
  expect(xt.indexOf("Foaia 1: Vânzări") < xt.indexOf("Foaia 2: Prima"), "Sheets not in workbook order: " + xt);
  expect(xt.includes("2\t\t20\t2025-10-01"), "Shared formula value, empty column or date lost: " + JSON.stringify(xt));
  expect(xt.includes("Prima\n") || xt.endsWith("Prima"), "Rich inline text not joined");
}

async function testDocuments() {
  const content = "# Titlu ăâîșț\nText \u0001cu\f control → ≥ ✅ Привет\n\n| Produs | Preț |\n|---|---|\n| Cafea | 1.500 |\n\n```python\n# comentariu\nprint(1)\n```\n" + "x".repeat(400);
  for (const format of ["docx", "xlsx", "pptx"]) {
    const { bytes } = await docs.createExportBytes(format, "T\u0002itlu", content);
    const z = await JSZip.loadAsync(bytes);
    for (const name of Object.keys(z.files).filter((n) => n.endsWith(".xml"))) {
      const xml = await z.file(name).async("string");
      expect(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml), `${format}/${name} contains XML control characters`);
    }
  }
  const pdf = await docs.createExportBytes("pdf", "Fallback", content, { standardFonts: true });
  expect(pdf.bytes.subarray(0, 5).toString() === "%PDF-", "PDF fallback font export failed");
  expect(docs.parseNumberCell("1.500") === 1500 && docs.parseNumberCell("1,5") === 1.5 && docs.parseNumberCell("1.234,56") === 1234.56, "Romanian numbers parsed wrong");
  expect(docs.parseNumberCell("0721123456") === null && docs.parseNumberCell("1960101123456") === null && docs.parseNumberCell("4111111111111111") === null, "Long digit strings must stay text");
  expect(docs.safeZipPath("....//....//evil.sh") === "evil.sh" && docs.safeZipPath("../a/../b.txt") === "a/b.txt", "Zip path escaped the archive");
  const csv = (await docs.createExportBytes("csv", "t", "| a | b |\n|---|---|\n| =HYPERLINK(1) | -5 |")).bytes.toString("utf8");
  expect(csv.includes("a;b") && csv.includes("'=HYPERLINK(1);-5"), "CSV must use ';' and guard formulas: " + csv);
  expect(docs.sheetNameFrom("'Raport'") === "Raport" && docs.sheetNameFrom("History") === "Foaie1", "Sheet name not sanitised");
}

function testMemory() {
  for (const t of ["Prefer răspunsuri scurte și la obiect.", "Ține minte că parola Wi-Fi e în sertar", "Lucrez la firma Webserano ca dezvoltator web"]) expect(memory.durableMemoryCandidate(t), "Durable fact not kept: " + t);
  for (const t of ["Vreau un rezumat al articolului de azi", "Poți să-mi faci un program pentru mâine?", "Fă-mi un plan pentru proiectul meu"]) expect(!memory.durableMemoryCandidate(t), "One-off request stored as memory: " + t);
}

async function testGateway(dir) {
  let omniBody = null, streamMode = "slow-ok";
  const omni = http.createServer(async (req, res) => {
    if (req.url === "/v1/models") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ data: [{ id: "test/model" }] })); }
    if (req.url === "/v1/chat/completions") {
      const body = await jsonBody(req); omniBody = body;
      if (!body.stream) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] })); }
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (streamMode === "stall") { res.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'); return; }
      let i = 0; const iv = setInterval(() => { res.write(`data: {"choices":[{"delta":{"content":"t${i}"}}]}\n\n`); if (++i === 6) { clearInterval(iv); res.end("data: [DONE]\n\n"); } }, 150);
      return;
    }
    res.statusCode = 404; res.end("{}");
  });
  const omniPort = await listen(omni);
  const internal = http.createServer((req, res) => res.end("INTERNAL")); const internalPort = await listen(internal);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, model: "test/model", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false, ownerEmail: " Owner@Example.com ", userUploadQuotaBytes: 0, allowPrivatePlugins: false };
  const port = 8841;
  const gw = startLocalGateway({ dataDir: dir, port, host: "127.0.0.1", getOmniConfig: () => cfg, streamIdleMs: 400, encryptSecret: (v) => Buffer.from(v).toString("base64"), decryptSecret: (v) => Buffer.from(v, "base64").toString("utf8") });
  const base = "http://127.0.0.1:" + port;
  const call = async (p, o = {}) => { const r = await fetch(base + p, { ...o, headers: { "content-type": "application/json", ...(o.headers || {}) } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t, h: r.headers }; };
  try {
    await sleep(150);
    // C9: JSON for unknown routes and malformed bodies.
    let r = await call("/api/nu-exista");
    expect(r.s === 404 && r.j?.error && !/<html/i.test(r.t), "Unknown route must return JSON 404");
    r = await call("/auth/login", { method: "POST", body: "{rupt" });
    expect(r.s === 400 && r.j?.error && !/at .*\.js/.test(r.t), "Bad JSON must return a JSON 400 without stack");

    r = await call("/auth/register", { method: "POST", body: JSON.stringify({ email: "user@example.com", password: "password123" }) });
    expect(r.s === 200 && r.j.user.role === "user" && r.j.permissions?.automations === true, "Local register must return role and permissions");
    const token = r.j.token, A = { authorization: "Bearer " + token };
    r = await call("/auth/register", { method: "POST", body: JSON.stringify({ email: "owner@example.com", password: "password123" }) });
    expect(r.j.user.role === "owner", "cfg.ownerEmail must make the local account Owner");
    const ownerToken = r.j.token;

    // Login of a Cloud-created account (no local password) is a clean 401, never a 500.
    const storePath = path.join(dir, "ai-stoica-data.json");
    const db0 = JSON.parse(fs.readFileSync(storePath, "utf8"));
    db0.users.push({ id: "shadow-1", email: "cloud@example.com", passwordHash: null, cloudUserId: "c1", createdAt: Date.now() });
    fs.writeFileSync(storePath, JSON.stringify(db0));
    await sleep(20);
    r = await call("/auth/login", { method: "POST", body: JSON.stringify({ email: "cloud@example.com", password: "password123" }) });
    expect(r.s === 401 && /Cloud/.test(r.j.error), "Cloud account login must return 401 with an explanation");

    // C5: provider receives only role/content; empty chats are refused.
    r = await call("/api/chat", { method: "POST", headers: A, body: JSON.stringify({ messages: [] }) });
    expect(r.s === 400 && r.j.error === "Mesajul este gol.", "Empty chat must return 400");
    r = await call("/api/chat", { method: "POST", headers: A, body: JSON.stringify({ messages: [null, { role: "assistant", content: "" }, { role: "tool", content: "x" }, { role: "user", content: [{ type: "text", text: "salut", extra: 1 }, { type: "file", x: 1 }], attachments: [], id: "m1" }] }) });
    expect(r.s === 200, "Sanitised chat failed: " + r.t);
    expect(omniBody.messages.length === 2 && omniBody.messages.every((m) => Object.keys(m).sort().join() === "content,role"), "Messages were not sanitised: " + JSON.stringify(omniBody.messages));
    expect(JSON.stringify(omniBody.messages[1].content) === JSON.stringify([{ type: "text", text: "salut" }]), "Unknown parts must be dropped");

    // C4: images are saved as Library references and rehydrated only for their owner.
    r = await fetch(base + "/api/library/upload", { method: "POST", headers: { ...A, "content-type": "application/octet-stream", "x-file-name": "poza.png", "x-file-type": "image/png" }, body: png });
    const img = (await r.json()).data;
    r = await call("/api/conversations", { method: "POST", headers: A, body: JSON.stringify({ title: "Imagine", messages: [{ role: "user", content: [{ type: "text", text: "ce vezi?" }, { type: "image_url", image_url: { url: "data:image/png;base64," + png.toString("base64") } }], attachments: [{ name: "poza.png", type: "image", libraryId: img.id }] }] }) });
    expect(r.j.data.messages[0].content[1].image_url.url === "aistoica-library://" + img.id, "data: image was not converted to a Library reference");
    r = await call("/api/conversations/" + r.j.data.id, { method: "PUT", headers: A, body: JSON.stringify({ title: { x: 1 } }) });
    expect(r.s === 400, "Conversation title must be text");
    r = await call("/api/chat", { method: "POST", headers: A, body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "descrie" }, { type: "image_url", image_url: { url: "aistoica-library://" + img.id } }] }] }) });
    expect(String(omniBody.messages[1].content[1].image_url.url).startsWith("data:image/png;base64,"), "Library image was not rehydrated");
    r = await call("/api/chat", { method: "POST", headers: { authorization: "Bearer " + ownerToken }, body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "descrie" }, { type: "image_url", image_url: { url: "aistoica-library://" + img.id } }] }] }) });
    expect(omniBody.messages[1].content[1].type === "text", "Another account's image must not be sent");

    // Automations: validation, string booleans, time zone, "run now" keeps a one-time task.
    r = await call("/api/automations", { method: "POST", headers: A, body: JSON.stringify({ title: "Rău", prompt: "x", frequency: "weekly", weekday: 7, model: "test/model" }) });
    expect(r.s === 400, "weekday 7 must be a 400");
    r = await call("/api/automations", { method: "POST", headers: A, body: JSON.stringify({ title: "Unic", prompt: "Spune OK", frequency: "once", runAt: Date.now() + 3600000, model: "test/model", timeZone: "Europe/Bucharest" }) });
    expect(r.s === 200 && r.j.data.timeZone === "Europe/Bucharest" && !("cloudToken" in r.j.data), "One-time automation creation failed: " + r.t);
    const once = r.j.data;
    r = await call(`/api/automations/${once.id}/run`, { method: "POST", headers: A, body: "{}" });
    expect(r.s === 200 && r.j.data.enabled === true && r.j.data.nextRunAt === once.nextRunAt, "Run now must not consume a one-time automation");
    r = await call(`/api/automations/${once.id}`, { method: "PATCH", headers: A, body: JSON.stringify({ enabled: "false" }) });
    expect(r.j.data.enabled === false && r.j.data.nextRunAt === null, "enabled:'false' must disable the automation");
    r = await call(`/api/automations/${once.id}`, { method: "PATCH", headers: A, body: JSON.stringify({ runAt: Date.now() - 60000 }) });
    r = await call(`/api/automations/${once.id}`, { method: "PATCH", headers: A, body: JSON.stringify({ enabled: true }) });
    expect(r.s === 400, "Re-enabling a past one-time automation must be a 400");

    // Plugins: private addresses refused, secrets encrypted at rest, whole-token validation.
    r = await call("/api/plugins", { method: "POST", headers: A, body: JSON.stringify({ name: "Intern", url: `http://127.0.0.1:${internalPort}/x`, method: "GET", apiKey: "cheie-secreta" }) });
    expect(r.s === 200, "Plugin creation failed: " + r.t);
    const pluginId = r.j.data.id;
    const stored = JSON.parse(fs.readFileSync(storePath, "utf8")).plugins.find((p) => p.id === pluginId);
    expect(String(stored.apiKey).startsWith("enc1:") && !String(stored.apiKey).includes("cheie-secreta"), "Plugin key not encrypted at rest");
    r = await call(`/api/plugins/${pluginId}/test`, { method: "POST", headers: A, body: "{}" });
    expect(r.s === 403 && /blocată/.test(r.j.error) && !r.t.includes("INTERNAL"), "Plugin SSRF to loopback not blocked: " + r.t);
    r = await call(`/api/plugins/${pluginId}`, { method: "PATCH", headers: A, body: JSON.stringify({ method: "TRACE" }) });
    expect(r.s === 400, "Invalid plugin method must be refused");
    r = await call(`/api/plugins/${pluginId}`, { method: "PATCH", headers: A, body: JSON.stringify({ apiKey: null }) });
    expect(r.j.data.hasKey === false, "apiKey:null must clear the key");
    r = await call("/api/plugins/nope", { method: "DELETE", headers: A });
    expect(r.s === 404, "Deleting a missing plugin must be 404");

    // Mobile upload (raw body, JSON content type) and per-account quota.
    r = await fetch(base + "/api/files?name=" + encodeURIComponent("date.json") + "&type=application/json", { method: "POST", headers: { ...A, "content-type": "application/json" }, body: '{"a":1}' });
    let j = await r.json();
    expect(r.ok && j.data.name === "date.json" && j.data.mimeType === "application/json" && j.data.size === 7, "Mobile /api/files upload failed: " + JSON.stringify(j));
    r = await fetch(base + "/api/files/" + j.data.id, { headers: A });
    expect(/filename="date\.json"; filename\*=UTF-8''date\.json/.test(r.headers.get("content-disposition")) && (await r.text()) === '{"a":1}', "Download headers/content wrong");
    cfg.userUploadQuotaBytes = 50; await sleep(2100);
    r = await fetch(base + "/api/library/upload", { method: "POST", headers: { ...A, "content-type": "application/octet-stream", "x-file-name": "mare.bin" }, body: Buffer.alloc(5000) });
    expect(r.status === 413, "Upload over quota must be 413");
    cfg.userUploadQuotaBytes = 0;

    // Stream idle timeout (400 ms here): a slow but steady stream completes, a stalled one is stopped.
    streamMode = "slow-ok";
    r = await call("/api/chat/stream", { method: "POST", headers: A, body: JSON.stringify({ messages: [{ role: "user", content: "salut" }] }) });
    expect((r.t.match(/"t\d"/g) || []).length === 6 && !/"error"/.test(r.t), "Steady stream was cut: " + r.t);
    streamMode = "stall";
    const t0 = Date.now();
    r = await call("/api/chat/stream", { method: "POST", headers: A, body: JSON.stringify({ messages: [{ role: "user", content: "salut" }] }) });
    expect(Date.now() - t0 < 5000 && /"error"/.test(r.t), "Stalled stream was not stopped by the idle timeout");

    // Login rate limit (10 failures per 15 minutes per address).
    for (let i = 0; i < 10; i++) await call("/auth/login", { method: "POST", body: JSON.stringify({ email: "user@example.com", password: "gresit-" + i }) });
    r = await call("/auth/login", { method: "POST", body: JSON.stringify({ email: "user@example.com", password: "password123" }) });
    expect(r.s === 429 && Number(r.h.get("retry-after")) > 0, "Login rate limit missing");

    // C3: logout revokes the session and its renewals.
    r = await call("/auth/me", { headers: A });
    const renewed = r.j.token;
    r = await call("/auth/logout", { method: "POST", headers: A, body: "{}" });
    expect(r.s === 200 && r.j.ok === true, "Logout failed");
    expect((await call("/auth/me", { headers: A })).s === 401, "Logged-out token still works");
    expect((await call("/auth/me", { headers: { authorization: "Bearer " + renewed } })).s === 401, "Renewed token of the logged-out session still works");
  } finally {
    await gw.close(); await closeServer(omni); await closeServer(internal);
  }
}

async function testCloudPermissions(dir) {
  const cloud = http.createServer(async (req, res) => {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    res.setHeader("content-type", "application/json");
    if (req.url === "/auth/me") {
      if (token === "proxy-down") { res.statusCode = 502; res.setHeader("content-type", "text/html"); return res.end("<html>Bad Gateway</html>"); }
      if (token === "stall") { res.write('{"user":'); return; }
      if (token !== "limited") { res.statusCode = 401; return res.end(JSON.stringify({ error: "bad token" })); }
      return res.end(JSON.stringify({ user: { id: "u-limited", email: "limited@example.com", role: "user", status: "active" }, permissions: { automations: false, plugins: false, file_upload: false, document_generation: false, image_generation: true } }));
    }
    if (req.url === "/api/ai/access") { const b = await jsonBody(req); return res.end(JSON.stringify({ data: (b.models || []).map((model) => ({ model, allowed: true })) })); }
    res.statusCode = 404; res.end("{}");
  });
  const cloudPort = await listen(cloud);
  const port = 8842;
  const gw = startLocalGateway({ dataDir: dir, port, host: "127.0.0.1", getOmniConfig: () => ({ baseUrl: "http://127.0.0.1:65530/v1", controlApiUrl: `http://127.0.0.1:${cloudPort}`, model: "test/model" }) });
  const base = "http://127.0.0.1:" + port, H = { authorization: "Bearer limited", "content-type": "application/json" };
  try {
    await sleep(150);
    let r = await fetch(base + "/auth/me", { headers: H }); let j = await r.json();
    expect(j.permissions.automations === false && j.permissions.web_search === true && j.user.role === "user", "Cloud permissions not normalised: " + JSON.stringify(j));
    const denied = (key) => `Funcția „${{ automations: "Automatizări", plugins: "Pluginuri", file_upload: "Încărcare fișiere", document_generation: "Fișiere descărcabile" }[key]}” este dezactivată de Owner pentru contul tău.`;
    r = await fetch(base + "/api/automations", { method: "POST", headers: H, body: JSON.stringify({ title: "t", prompt: "p", model: "test/model" }) }); j = await r.json();
    expect(r.status === 403 && j.error === denied("automations"), "Automations permission not enforced: " + JSON.stringify(j));
    r = await fetch(base + "/api/plugins", { method: "POST", headers: H, body: JSON.stringify({ name: "x", url: "https://example.com" }) }); j = await r.json();
    expect(r.status === 403 && j.error === denied("plugins"), "Plugins permission not enforced");
    r = await fetch(base + "/api/export", { method: "POST", headers: H, body: JSON.stringify({ format: "txt", content: "x" }) }); j = await r.json();
    expect(r.status === 403 && j.error === denied("document_generation"), "Export permission not enforced");
    r = await fetch(base + "/api/library/upload", { method: "POST", headers: { authorization: "Bearer limited", "content-type": "application/octet-stream", "x-file-name": "a.txt" }, body: "abc" }); j = await r.json();
    expect(r.status === 403 && j.error === denied("file_upload"), "Upload permission not enforced");
    r = await fetch(base + "/api/conversations", { headers: { authorization: "Bearer proxy-down" } });
    expect(r.status === 503, "Cloud 502 must become 503, got " + r.status);
    const t0 = Date.now();
    r = await fetch(base + "/api/conversations", { headers: { authorization: "Bearer stall" } });
    expect(r.status === 503 && Date.now() - t0 < 12000, "A stalled Cloud body must time out with 503");
  } finally { await gw.close(); await closeServer(cloud); }
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-0711-"));
  try {
    await testSchedule();
    await testNetguard();
    fs.mkdirSync(path.join(dir, "files"));
    await testExtraction(path.join(dir, "files"));
    await testDocuments();
    testMemory();
    fs.mkdirSync(path.join(dir, "gw"));
    await testGateway(path.join(dir, "gw"));
    fs.mkdirSync(path.join(dir, "cloud"));
    await testCloudPermissions(path.join(dir, "cloud"));
    console.log("REGRESSION_0711_TESTS_PASSED");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
