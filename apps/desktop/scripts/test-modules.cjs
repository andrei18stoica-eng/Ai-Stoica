// Unit tests for the data store, memory search and library text extraction.
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const JSZip = require("jszip");
const { createStore } = require("../lib/store.cjs");
const memory = require("../lib/memory.cjs");
const { extractText } = require("../lib/extract.cjs");

function expect(v, m) { if (!v) throw new Error(m); }

async function testStore(dir) {
  const store = createStore(dir);
  // Two "requests" that read before either one saves: no change may be lost.
  const a = store.read(), b = store.read();
  a.memories.push({ id: "m1", userId: "u", text: "prima" });
  b.projects.push({ id: "p1", userId: "u", name: "Proiect" });
  store.write(a);
  store.write(b);
  const fresh = createStore(dir).read();
  expect(fresh.memories.length === 1 && fresh.projects.length === 1, "Store lost a concurrent change");

  // External edit (backup restore, another tool) is picked up.
  const file = path.join(dir, "ai-stoica-data.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  raw.users.push({ id: "x", email: "x@example.com" });
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(file, JSON.stringify(raw));
  expect(store.read().users.some((u) => u.id === "x"), "Store did not reload an external change");

  // A damaged file must not wipe the data: the backup is used and the damaged file is kept.
  store.write(store.read());
  fs.writeFileSync(file, "{ broken json");
  const recovered = createStore(dir).read();
  expect(recovered.memories.length === 1, "Store did not recover from backup after corruption");
  expect(fs.readdirSync(dir).some((f) => f.includes(".corrupt-")), "Damaged data file was not kept");
}

function testMemory() {
  const db = { memories: [] };
  memory.addMemory(db, "u", "Lucrez la proiectul Webserano cu mașina nouă");
  memory.addMemory(db, "u", "Prefer răspunsuri scurte");
  memory.addMemory(db, "alt", "Mașina altui utilizator");
  const hits = memory.memoryMatches(db, "u", "ce știi despre mașinile mele?");
  expect(hits.length === 1 && hits[0].text.includes("Webserano"), "Word-form memory match failed");
  expect(!hits.some((m) => m.userId !== "u"), "Memory leaked between users");
  expect(memory.addMemory(db, "u", "Prefer  răspunsuri SCURTE").id === db.memories[1].id, "Duplicate memory was not merged");
  expect(Math.abs(memory.cosine([1, 2], [2, 4]) - 1) < 1e-9, "Cosine similarity wrong");
}

function simplePdf(lines) {
  const content = "BT /F1 12 Tf 72 720 Td " + lines.map((l, i) => (i ? "T* " : "") + "(" + l.replace(/[()\\]/g, "\\$&") + ") Tj").join(" ") + " ET";
  const stream = zlib.deflateSync(Buffer.from(content, "latin1"));
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length " + stream.length + " /Filter /FlateDecode >>\nstream\n", "latin1"),
    stream,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1")
  ]);
}

async function testExtract(dir) {
  const pdfPath = path.join(dir, "contract.pdf");
  fs.writeFileSync(pdfPath, simplePdf(["Contract de mentenanta", "Pret lunar (300 lei)"]));
  let r = await extractText(pdfPath, "application/pdf", "contract.pdf");
  expect(r.status === "ok" && r.text.includes("Contract de mentenanta") && r.text.includes("(300 lei)"), "PDF text extraction failed: " + JSON.stringify(r));

  const docx = new JSZip();
  docx.file("word/document.xml", '<w:document><w:body><w:p><w:r><w:t>Raport &amp; ofertă</w:t></w:r></w:p><w:p><w:r><w:t>Al doilea paragraf</w:t></w:r></w:p></w:body></w:document>');
  const docxPath = path.join(dir, "raport.docx");
  fs.writeFileSync(docxPath, await docx.generateAsync({ type: "nodebuffer" }));
  r = await extractText(docxPath, "", "raport.docx");
  expect(r.text === "Raport & ofertă\nAl doilea paragraf", "DOCX extraction failed: " + JSON.stringify(r.text));

  const xlsx = new JSZip();
  xlsx.file("xl/sharedStrings.xml", "<sst><si><t>Client</t></si><si><t>Pret</t></si></sst>");
  xlsx.file("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Cafenea</t></is></c><c r="B2"><v>1500</v></c></row></sheetData></worksheet>');
  const xlsxPath = path.join(dir, "preturi.xlsx");
  fs.writeFileSync(xlsxPath, await xlsx.generateAsync({ type: "nodebuffer" }));
  r = await extractText(xlsxPath, "", "preturi.xlsx");
  expect(r.text.includes("Client\tPret") && r.text.includes("Cafenea\t1500"), "XLSX extraction failed: " + JSON.stringify(r.text));

  const pptx = new JSZip();
  pptx.file("ppt/slides/slide2.xml", "<p:sld><a:p><a:r><a:t>Al doilea slide</a:t></a:r></a:p></p:sld>");
  pptx.file("ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>Primul slide</a:t></a:r></a:p></p:sld>");
  const pptxPath = path.join(dir, "prezentare.pptx");
  fs.writeFileSync(pptxPath, await pptx.generateAsync({ type: "nodebuffer" }));
  r = await extractText(pptxPath, "", "prezentare.pptx");
  expect(r.text.indexOf("Primul slide") < r.text.indexOf("Al doilea slide"), "PPTX slide order wrong");

  const imgPath = path.join(dir, "poza.png");
  fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  r = await extractText(imgPath, "image/png", "poza.png");
  expect(r.status === "unsupported", "Images must not be read as text");
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-modules-"));
  try {
    await testStore(path.join(dir, "store"));
    testMemory();
    fs.mkdirSync(path.join(dir, "files"));
    await testExtract(path.join(dir, "files"));
    console.log("MODULE_TESTS_PASSED");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
