// 0.7.16: math written by the AI becomes real Word equations (Office Math), shows as formulas in chat, and money,
// code and broken LaTeX stay as text.
const path = require("path");
const JSZip = require("jszip");
const { createExportBytes } = require("../lib/documents.cjs");
const { latexToOmml, splitInlineMath, mathBlockAt } = require("../lib/math.cjs");

function expect(v, m) { if (!v) throw new Error(m); }

// Every tag closed, in order: Word refuses to open a document with broken XML.
function wellFormed(xml) {
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([\w:.-]+)(?:\s[^<>]*?)?(\/?)>/g)) {
    if (m[0].startsWith("<?")) continue;
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2]);
    else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

async function main() {
  // LaTeX → Office Math, with Word's own structures.
  const om = (tex) => latexToOmml(tex, { display: true }) || "";
  expect(om("\\frac{a}{b}").includes("<m:f>") && om("\\frac{a}{b}").includes("<m:num>"), "fraction");
  expect(om("\\sqrt{x}").includes('<m:degHide m:val="1"/>') && om("\\sqrt[3]{x}").includes("<m:deg><m:r>"), "roots");
  expect(om("x^2").includes("<m:sSup>") && om("x_i").includes("<m:sSub>") && om("x_i^2").includes("<m:sSubSup>"), "scripts");
  const sum = om("\\sum_{i=1}^{n} i^2 = 5");
  expect(/<m:nary><m:naryPr><m:chr m:val="∑"\/>/.test(sum) && /<m:e>.*<m:sSup>.*<\/m:e><\/m:nary><m:r>.*=/.test(sum), "a sum takes what follows it, up to the = sign: " + sum);
  expect(om("\\int_0^1 f(x)\\,dx").includes('<m:chr m:val="∫"/><m:limLoc m:val="subSup"/>'), "integral");
  expect(om("\\left(\\frac12\\right)").includes('<m:begChr m:val="("/>') && om("\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}").includes("<m:m>"), "brackets and matrices");
  expect(om("\\sin x").includes("<m:func><m:fName>") && om("\\lim_{x\\to0} f").includes("<m:func><m:fName><m:limLow>"), "functions as Word writes them");
  expect(om("\\begin{align} a&=b\\\\ c&=d \\end{align}").includes("<m:eqArr>") && om("\\begin{align} a&=b\\\\ c&=d \\end{align}").includes("<m:aln/>"), "aligned equations line up at =");
  expect(om("\\hat{x}").includes("<m:acc>") && om("\\overline{AB}").includes("<m:bar>") && om("\\boxed{x}").includes("<m:borderBox>"), "accents, bars, boxes");
  expect(om("\\text{dacă } x").includes("<m:nor/>") && om("a<b").includes("&lt;"), "text and escaping");
  expect(latexToOmml("\\frac{1") === null && latexToOmml("") === null && latexToOmml("x".repeat(5000)) === null, "invalid or huge LaTeX is left as text");
  expect(latexToOmml("\\href{javascript:alert(1)}{x}") === null || !/javascript/.test(latexToOmml("\\href{javascript:alert(1)}{x}")), "no links from LaTeX");

  // Finding math in text: money and code stay text.
  const parts = (s) => splitInlineMath(s).filter((p) => p.math != null).map((p) => p.math);
  expect(JSON.stringify(parts("Einstein: $E=mc^2$.")) === '["E=mc^2"]', "inline $…$");
  expect(parts("costă 5$ sau 10$").length === 0 && parts("între $5 și $10").length === 0 && parts("doar \\$5").length === 0, "money is not math");
  expect(parts("cod `$x$` aici").length === 0, "code spans are not math");
  expect(parts("Preț: 5$/lună și 10$/an").length === 0 && parts("între 5$-10$").length === 0 && parts("echo $HOME/$USER").length === 0, "money with / or -, and shell variables, are not math");
  expect(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test((latexToOmml('\\char"1') || "") + (latexToOmml('\\char"FFFE') || "")), "characters XML does not allow never reach the document");
  expect(JSON.stringify(parts("a \\(x+1\\) b \\[y\\] c $$z$$")) === '["x+1","y","z"]', "\\(…\\), \\[…\\] and $$…$$");
  const lines = ["$$", "x = 1", "$$", "după"];
  expect(mathBlockAt(lines, 0)?.end === 2 && mathBlockAt(lines, 0).tex.trim() === "x = 1", "equation block on its own lines");
  expect(mathBlockAt(["$$a$$ și text"], 0) === null && mathBlockAt(["$$", "", "x", "$$"], 0) === null, "not a block: text after it, or a blank line inside");
  expect(mathBlockAt(["\\begin{equation}", "E=mc^2", "\\end{equation}"], 0)?.end === 2, "\\begin{equation}");

  // The Word file: equations inside it, text untouched, valid XML.
  const content = [
    "# Formule", "",
    "Energia este $E=mc^2$, iar prețul e 5$ sau $10.", "",
    "$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$", "",
    "\\begin{align}", "a &= b + c \\\\", "d &= \\int_0^1 f(x)\\,dx", "\\end{align}", "",
    "- Limita: \\(\\lim_{x\\to 0} \\frac{\\sin x}{x} = 1\\)", "",
    "| Mărime | Formulă |", "|---|---|", "| Arie | $\\pi r^2$ |", "",
    "Greșit: $\\frac{1$ rămâne text. Cod: `$x$`.", "",
    "**Rezultat: $y=5$** gata."
  ].join("\n");
  const { bytes, mime } = await createExportBytes("docx", "Formule", content);
  expect(/wordprocessingml/.test(mime), "Word mime");
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml").async("string");
  expect(xml.includes('xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'), "the math namespace is declared");
  expect((xml.match(/<m:oMathPara>/g) || []).length === 2, "two equations on their own line: " + (xml.match(/<m:oMathPara>/g) || []).length);
  expect((xml.match(/<m:oMath>/g) || []).length === 6, "six equations in all (two on their own line, four in text): " + (xml.match(/<m:oMath>/g) || []).length);
  expect(!xml.includes("**") && xml.includes("Rezultat: "), "bold around a formula stays bold, without literal asterisks");
  expect(!/\ue000|\ue001/.test(xml), "no placeholder may be left in the document");
  expect(xml.includes("5$ sau $10") && xml.includes("$\\frac{1$") && xml.includes(">$x$<"), "money, broken LaTeX and code stay as written");
  expect(wellFormed(xml), "document.xml must be well-formed");

  // Other formats are unchanged: the PDF still gets the text.
  const pdf = await createExportBytes("pdf", "Formule", "Energia $E=mc^2$");
  expect(pdf.bytes.length > 500, "PDF still builds");

  // PDF text through the fonts' character maps: PDFs with ș, ț, ă (glyph-number fonts) are readable for the AI and
  // in the viewer (before 0.7.16 they gave no text, or binary font data).
  const { extractText } = require("../lib/extract.cjs");
  const { parseCMap } = require("../lib/pdftext.cjs");
  const fs = require("fs"), os = require("os");
  const ro = await createExportBytes("pdf", "Raport", "Vânzările în ședința de marți au crescut cu 12%.\n\n| Țară | Sumă |\n|---|---|\n| România | 100 |");
  const pdfPath = path.join(os.tmpdir(), "ai-stoica-0716-" + process.pid + ".pdf");
  fs.writeFileSync(pdfPath, ro.bytes);
  try {
    const got = await extractText(pdfPath, "application/pdf", "raport.pdf");
    expect(got.status === "ok" && got.text.includes("Vânzările în ședința de marți au crescut cu 12%.") && /Țară\s+Sumă/.test(got.text) && /România\s+100/.test(got.text), "PDF text with diacritics and table rows: " + JSON.stringify(got).slice(0, 300));
  } finally { fs.rmSync(pdfPath, { force: true }); }
  // A small PDF whose page content (or object stream) unpacks to 600 MB is read with the usual limits: it neither
  // takes seconds nor fills the memory (pdf-lib alone would unpack it completely).
  const zlib = require("zlib");
  const bomb = await new Promise((resolve, reject) => {
    const d = zlib.createDeflate({ level: 9 }), parts = [], chunk = Buffer.alloc(1024 * 1024, 0x20);
    d.on("data", (c) => parts.push(c)); d.on("end", () => resolve(Buffer.concat(parts))); d.on("error", reject);
    let left = 600; const pump = () => { while (left > 0) { left--; if (!d.write(chunk)) return d.once("drain", pump); } d.end(); }; pump();
  });
  const pdfWith = (stream, dict) => Buffer.concat([Buffer.from("%PDF-1.5\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n4 0 obj << " + dict + " /Length " + stream.length + " /Filter /FlateDecode >> stream\n", "latin1"), stream, Buffer.from("\nendstream endobj\ntrailer << /Root 1 0 R /Size 5 >>\n%%EOF\n", "latin1")]);
  for (const [label, dict] of [["page content", ""], ["object stream", "/Type /ObjStm /N 1 /First 4"]]) {
    const bombPath = path.join(os.tmpdir(), "ai-stoica-0716-bomb-" + process.pid + ".pdf");
    fs.writeFileSync(bombPath, pdfWith(bomb, dict));
    try {
      const t0 = Date.now(), got = await extractText(bombPath, "application/pdf", "bomb.pdf"), ms = Date.now() - t0;
      expect(ms < 4000 && got.text.length < 1000, `PDF bomb (${label}) must stay within limits: ${ms} ms, ${got.text.length} chars`);
    } finally { fs.rmSync(bombPath, { force: true }); }
  }
  const cmap = parseCMap("1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0003> <0020> <0010> <0219> endbfchar 2 beginbfrange <0020> <0022> <0041> <0030> <0031> [<0066006C> <D83DDE00>] endbfrange");
  // Pieces of text placed with Td on the same line stay one word; a new line stays a new line.
  const { extractPdfText } = require("../lib/pdftext.cjs");
  const pageText = "BT /F1 12 Tf 72 700 Td (Hello wor) Tj 55 0 Td (ld again) Tj ET BT /F1 12 Tf 72 680 Td (A) Tj 7 0 Td (B) Tj 40 0 Td (C) Tj ET BT /F1 12 Tf 72 660 Td (Linia unu) Tj 0 -14 Td (Linia doi) Tj ET";
  const handMade = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n4 0 obj << /Length " + pageText.length + " >> stream\n" + pageText + "\nendstream endobj\n5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\ntrailer << /Root 1 0 R /Size 6 >>\n%%EOF\n", "latin1");
  const placed = await extractPdfText(handMade, { decodeStream: (d) => d });
  expect(placed.includes("Hello world again") && placed.includes("AB C") && /Linia unu\nLinia doi/.test(placed), "text placed with Td: " + JSON.stringify(placed));
  expect(cmap.bytes === 2 && cmap.map.get(3) === " " && cmap.map.get(0x10) === "ș" && cmap.map.get(0x22) === "C" && cmap.map.get(0x30) === "fl" && cmap.map.get(0x31) === "😀", "ToUnicode maps: bfchar, bfrange with offset and with a list");

  // Chat: the same rules before Markdown.
  const { prepareMath, MARK } = await import(require("url").pathToFileURL(path.join(__dirname, "../renderer/src/mathText.mjs")).href);
  expect(prepareMath("Energia $E=mc^2$, 5$ sau $10.") === `Energia \`${MARK}IE=mc^2\`, 5$ sau $10.`, "chat: inline formula becomes a marked code span");
  expect(prepareMath("$$\\frac{a_1*b_2}{c}$$") === "```math\n\\frac{a_1*b_2}{c}\n```", "chat: an equation line becomes a ```math block, so _ and * stay");
  expect(prepareMath("```\n$x$\n```") === "```\n$x$\n```" && prepareMath("`$x$`") === "`$x$`", "chat: code stays code");
  expect(prepareMath("fără formule") === "fără formule", "chat: text without formulas is unchanged");
  console.log("0.7.16 math checks OK");
}
main().catch((e) => { console.error(e); process.exit(1); });
