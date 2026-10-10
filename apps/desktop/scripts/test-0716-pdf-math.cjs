// 0.7.16, at the Owner's request: formulas in a PDF look like Word's equations (Insert → Equation), not raw LaTeX, and
// the file the user asks for in the chat is downloaded right away (the card under the answer downloads it too).
const fs = require("fs"), path = require("path");
const { createExportBytes } = require("../lib/documents.cjs");
const { extractText } = require("../lib/extract.cjs");
const { layoutMath, loadMathFonts } = require("../lib/mathpdf.cjs");

function expect(v, m) { if (!v) throw new Error(m); }

async function main() {
  const content = "# Ecuația de gradul doi\n\nPentru $ax^2+bx+c=0$ cu $a \\neq 0$, discriminantul este $\\Delta = b^2-4ac$.\n\n$$x_{1,2}=\\frac{-b\\pm\\sqrt{\\Delta}}{2a}$$\n\n\\[\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\\]\n\nPrețul este 5$ sau 10$ pe lună.\n";
  const { bytes } = await createExportBytes("pdf", "Matematică", content);
  const file = path.join(require("os").tmpdir(), `ai-stoica-pdf-math-${process.pid}.pdf`);
  fs.writeFileSync(file, bytes);
  let text;
  try { const r = await extractText(file, "application/pdf", "test.pdf"); text = String(r?.text ?? r ?? ""); } finally { fs.rmSync(file, { force: true }); }
  expect(text && /discriminantul/.test(text), "the PDF text must be readable: " + String(text).slice(0, 200));
  expect(/5\$ sau 10\$/.test(text), "money with $ must stay text");

  // The serif math fonts are on Windows (Times New Roman) and in the site's image (Liberation/DejaVu Serif, Dockerfile).
  const { PDFDocument } = require("pdf-lib");
  const fontkit = require("@pdf-lib/fontkit");
  const probe = await PDFDocument.create(); probe.registerFontkit(fontkit.default || fontkit);
  const dirs = ["/usr/share/fonts/truetype/liberation", "/usr/share/fonts/truetype/liberation2", "/usr/share/fonts/truetype/dejavu", path.join(process.env.WINDIR || "C:\\Windows", "Fonts")];
  const read = (n) => { for (const d of dirs) { try { return fs.readFileSync(path.join(d, n)); } catch {} } return null; };
  const fonts = await loadMathFonts(probe, read);
  if (fonts) {
    expect(!/\\frac|\\sqrt|\\sum|\$\$|\\\[/.test(text), "with math fonts the LaTeX must be typeset, not written: " + text.slice(0, 300));
    expect(/2a/.test(text.replace(/\s+/g, "")), "the fraction's denominator must be in the PDF");
    const frac = layoutMath("\\frac{a+b}{2}", fonts, { display: true, size: 12 });
    const flat = layoutMath("a+b", fonts, { display: true, size: 12 });
    expect(frac && flat && frac.a + frac.d > (flat.a + flat.d) * 1.6, "a fraction must be on two levels");
    const sup = layoutMath("x^2", fonts, { size: 12 }), base = layoutMath("x", fonts, { size: 12 });
    expect(sup.a > base.a, "a power must be raised");
    expect(layoutMath("\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}", fonts, { display: true, size: 12 }).a > 12, "a matrix must be two rows tall");
    expect(layoutMath("\\frac{", fonts, { size: 12 }) === null, "invalid LaTeX must stay text");
  } else console.log("test-0716-pdf-math: no serif math font on this machine; only the text fallback was checked");

  // Without embeddable fonts the PDF is still made (the formulas stay as text).
  const plain = await createExportBytes("pdf", "Test", content, { standardFonts: true });
  expect(plain.bytes.length > 500, "the PDF must be made without the math fonts too");

  // The site image has the fonts; the chat downloads the requested file at once and the card's main action downloads.
  const docker = fs.readFileSync(path.join(__dirname, "../../cloud/Dockerfile"), "utf8");
  expect(/fonts-liberation2/.test(docker) && /fonts-dejavu-core/.test(docker), "the site image must install the PDF fonts");
  const ui = fs.readFileSync(path.join(__dirname, "../renderer/src/main.jsx"), "utf8");
  expect(/files=\[exported\.data\];\s*\/\/[^\n]*\n\s*downloadGeneratedFile\(exported\.data\)/.test(ui), "the requested file must be downloaded right away");
  expect(/className="generatedDownload" onClick=\{download\}/.test(ui) && /className="generatedOpen"/.test(ui), "the file card must download, with a separate Open button");
  console.log("test-0716-pdf-math: OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
