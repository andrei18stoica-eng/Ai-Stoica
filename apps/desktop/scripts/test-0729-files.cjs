// 0.7.29, reported by the Owner: the AI did not send the Word / PowerPoint / Excel / PDF file and could not change one.
// File requests are recognised in English too, a change to an attached file (or the last file made in the chat) comes
// back as the same kind of file, the AI is told its answer becomes the file, an Excel gets one sheet per table, and an
// account with a plan is not held to the free daily file limit.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path"), { pathToFileURL } = require("url");
const JSZip = require("jszip");

function expect(v, m) { if (!v) throw new Error(m); }
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

async function intents() {
  const { requestedDocumentFormat: ask, editedDocumentFormat: edit } = await import(pathToFileURL(path.join(__dirname, "../renderer/src/documentIntent.mjs")).href);
  for (const [text, format] of [
    ["Make me a Word document about healthy food", "docx"], ["Can you make me a presentation about our product?", "pptx"],
    ["I want a PDF with the menu", "pdf"], ["Write an essay in Word about climate", "docx"], ["Could you create a PowerPoint about sales?", "pptx"],
    ["I need a Word file with a cover letter", "docx"], ["Please make a pdf", "pdf"], ["Give me a docx with the contract", "docx"],
    ["Turn this into a PDF", "pdf"], ["Create an Excel with my monthly budget", "xlsx"], ["Fă-mi un document cu o cerere", "docx"]
  ]) expect(ask(text) === format, `"${text}" must make a ${format}, got ${ask(text)}`);
  for (const text of ["How do I export a PDF?", "What is a docx file?", "Write an article about the PDF format", "I need help with Excel",
    "Can you explain what PowerPoint is?", "Summarize this document", "Ce este un document?"])
    expect(ask(text) === null, `"${text}" must stay a text answer, got ${ask(text)}`);
  for (const [text, names, last, format] of [
    ["Edit the attached file and fix the typos", ["cv.docx"], null, "docx"], ["Modifică documentul atașat: schimbă titlul", ["oferta.docx"], null, "docx"],
    ["Add a slide about prices", [], "pptx", "pptx"], ["Change the second column to euros", ["budget.xlsx"], null, "xlsx"],
    ["traduce-l în engleză", [], "docx", "docx"], ["How do I change the font?", ["cv.docx"], null, null], ["Thanks, looks good", [], "docx", null],
    ["What does this file say?", ["x.pdf"], null, null]
  ]) expect(edit(text, names, last) === format, `"${text}" must change a ${format}, got ${edit(text, names, last)}`);
}

async function builders() {
  const D = require("../lib/documents.cjs");
  const md = "# Budget\n\n## Income\n\n| Month | Lei |\n|---|---|\n| Jan | 100 |\n\n## Costs\n\n| Item | Lei |\n|---|---|\n| Rent | 50 |\n";
  const z = await JSZip.loadAsync((await D.createExportBytes("xlsx", "Budget", md)).bytes);
  const wb = await z.file("xl/workbook.xml").async("string");
  expect(z.file("xl/worksheets/sheet2.xml") && /name="Income"/.test(wb) && /name="Costs"/.test(wb), "one Excel sheet per table, named after its heading");
  const one = await JSZip.loadAsync((await D.createExportBytes("xlsx", "Simple", "| a | b |\n|---|---|\n| 1 | 2 |")).bytes);
  expect(one.file("xl/worksheets/sheet1.xml") && !one.file("xl/worksheets/sheet2.xml"), "a single table stays one sheet");
}

async function gateway() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "files-"));
  let lastSystem = "";
  const omni = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      if (req.url === "/v1/models") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ data: [{ id: "Ai principal", owned_by: "combo" }] })); }
      try { lastSystem = JSON.parse(b).messages.filter((m) => m.role === "system").map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n"); } catch {}
      res.setHeader("content-type", "text/event-stream");
      res.end('data: {"choices":[{"delta":{"content":"# Title\\n\\nText."}}]}\n\ndata: [DONE]\n\n');
    });
  });
  const omniPort = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "k", model: "Ai principal", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false, ownerEmail: "owner@example.com", creditsEnabled: true, freeDocumentsPerDay: 1 };
  const gw = require("../local-gateway.cjs").startLocalGateway({ dataDir: dir, port: 8872, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8872";
  const call = async (p, { method = "GET", body, token } = {}) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {} return { status: r.status, j, text }; };
  try {
    const owner = (await call("/auth/register", { method: "POST", body: { email: "owner@example.com", password: "password123", name: "Owner" } })).j.token;
    const user = (await call("/auth/register", { method: "POST", body: { email: "user@example.com", password: "password123", name: "User" } })).j.token;
    // The AI is told its answer becomes the file, and how to shape it; a change returns the whole file.
    await call("/api/credits/accounts/plan", { method: "POST", token: owner, body: { email: "user@example.com", plan: "plus" } });
    await call("/api/chat/stream", { method: "POST", token: user, body: { messages: [{ role: "user", content: "Add a slide about prices" }], fileFormat: "pptx", fileEdit: true } });
    expect(/FILE ANSWER/.test(lastSystem) && /PowerPoint \(PPTX\)/.test(lastSystem) && /never say you cannot create/.test(lastSystem) && /«## Slide title»/.test(lastSystem) && /complete updated file/.test(lastSystem), "the AI is told to write the whole file: " + lastSystem.slice(0, 300));
    await call("/api/chat/stream", { method: "POST", token: user, body: { messages: [{ role: "user", content: "hello" }] } });
    expect(!/FILE ANSWER/.test(lastSystem), "a normal message gets no file instruction");
    // A plan makes files freely; the daily free limit (1 here) applies only without a plan.
    for (let i = 0; i < 3; i++) {
      const r = await call("/api/export", { method: "POST", token: user, body: { format: "docx", title: "Doc " + i, content: "# Doc\n\nText", fileName: "cv (edited)" } });
      expect(r.status === 200 && r.j.data?.name === "cv (edited).docx", `a plan makes file ${i + 1}: ${r.status} ${r.text.slice(0, 200)}`);
    }
    const free = (await call("/auth/register", { method: "POST", body: { email: "free@example.com", password: "password123", name: "Free" } })).j.token;
    expect((await call("/api/export", { method: "POST", token: free, body: { format: "docx", title: "A", content: "# A" } })).status === 200, "without a plan, the first file of the day");
    expect((await call("/api/export", { method: "POST", token: free, body: { format: "docx", title: "B", content: "# B" } })).status === 429, "without a plan, the free daily limit still applies");
  } finally {
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sources() {
  const ui = fs.readFileSync(path.join(__dirname, "..", "renderer", "src", "main.jsx"), "utf8");
  expect(/function fileRequestFor\(text,attachmentNames,messages\)/.test(ui) && /fileFormat:format\|\|undefined,fileEdit:edit\|\|undefined/.test(ui), "the app sends what file is wanted");
  expect(/fileName:sourceName\.replace\(/.test(ui), "an edited attached file keeps its name");
}

(async () => { await intents(); await builders(); await gateway(); sources(); console.log("0.7.29 files OK"); })().catch((e) => { console.error(e); process.exit(1); });
