// Document export (PDF, Word, PowerPoint, Excel, CSV, JSON, HTML, XML, RTF, ZIP, notebook, SVG, code files).
const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = require("pdf-lib");
const fontkitModule = require("@pdf-lib/fontkit");
const fontkit = fontkitModule.default || fontkitModule;
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle } = require("docx");
const PptxGenJS = require("pptxgenjs");
const JSZip = require("jszip");
const { latexToOmml, ommlInline, ommlDisplay, splitInlineMath, mathBlockAt, hasMath } = require("./math.cjs");
const { layoutMath, loadMathFonts } = require("./mathpdf.cjs");

// Characters that are not allowed in XML (all Office formats, SVG, XML) and unpaired surrogates.
function sanitizeText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
}
function safeGeneratedName(value) {
  let name = sanitizeText(value || "AI Stoica").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120).replace(/[. ]+$/, "");
  if (!name) name = "AI Stoica";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name.split(".")[0])) name = "_" + name;
  return name;
}

function splitTableRow(line) {
  return String(line).trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}
function isTableSeparator(line) { return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(String(line || "")); }
function parseDocumentBlocks(content, opts = {}) {
  const lines = sanitizeText(content).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const fence = line.match(/^\s*(```|~~~)\s*([\w+#.-]*)/);
    if (fence) {
      const code = []; let j = i + 1;
      for (; j < lines.length && !lines[j].trim().startsWith(fence[1]); j++) code.push(lines[j].replace(/\t/g, "    ").trimEnd());
      blocks.push({ type: "code", lang: fence[2] || "", lines: code });
      i = j; continue;
    }
    // Word only: an equation on its own lines ($$…$$, \[…\], \begin{equation}…).
    const eq = opts.math ? mathBlockAt(lines, i) : null;
    if (eq) { blocks.push({ type: "math", tex: eq.tex, text: lines.slice(i, eq.end + 1).map((l) => l.trim()).join(" ") }); i = eq.end; continue; }
    if (line.includes("|") && isTableSeparator(lines[i + 1])) {
      const rows = [splitTableRow(line)]; let j = i + 2;
      for (; j < lines.length && lines[j].includes("|") && lines[j].trim(); j++) rows.push(splitTableRow(lines[j]));
      blocks.push({ type: "table", rows });
      i = j - 1; continue;
    }
    if (!line.trim()) { blocks.push({ type: "blank", text: "" }); continue; }
    let m = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (m) { blocks.push({ type: "heading", level: Math.min(4, m[1].length), text: m[2].trim() }); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ type: "rule", text: "" }); continue; }
    m = line.match(/^(\s*)[-*•+]\s+(\[[ xX]\]\s+)?(.+)$/);
    if (m) { blocks.push({ type: "bullet", text: (m[2] ? (/x/i.test(m[2]) ? "[x] " : "[ ] ") : "") + m[3].trim(), level: Math.min(3, Math.floor(m[1].length / 2)) }); continue; }
    m = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (m) { blocks.push({ type: "number", text: m[3].trim(), number: Number(m[2]), level: Math.min(3, Math.floor(m[1].length / 2)) }); continue; }
    m = line.match(/^\s*>\s?(.*)$/);
    if (m) { blocks.push({ type: "quote", text: m[1] }); continue; }
    blocks.push({ type: "paragraph", text: line });
  }
  return blocks;
}

const UNESCAPE = /\\([\\`*_{}\[\]()#+\-.!|>~])/g;
function linkText(t, u) { return t === u || (/^mailto:/i.test(u) && t === u.slice(7)) ? t : `${t} (${u})`; }
function plainMarkdownText(value) {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, t, u) => linkText(t, u))
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w_])_(?!\s)([^_\n]+?)_(?![\w_])/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(UNESCAPE, "$1");
}
function inlineTokens(value) {
  const src = String(value || ""), out = [];
  const re = /(\*\*\*[^*\n]+?\*\*\*|\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|`[^`\n]+`|!?\[[^\]\n]+\]\([^)\s]+(?:\s+"[^"]*")?\)|(?<![\w*])\*(?!\s)[^*\n]+?\*(?![\w*])|(?<![\w_])_(?!\s)[^_\n]+?_(?![\w_]))/g;
  let pos = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > pos) out.push({ text: src.slice(pos, m.index) });
    const t = m[0];
    if (t.startsWith("***")) out.push({ text: t.slice(3, -3), bold: true, italic: true });
    else if (t.startsWith("**") || t.startsWith("__")) out.push({ text: t.slice(2, -2), bold: true });
    else if (t.startsWith("~~")) out.push({ text: t.slice(2, -2), strike: true });
    else if (t.startsWith("`")) out.push({ text: t.slice(1, -1), code: true });
    else if (t.startsWith("[") || t.startsWith("![")) { const l = t.match(/^!?\[([^\]]+)\]\(([^)\s]+)/); out.push({ text: t.startsWith("!") ? l[1] : linkText(l[1], l[2]) }); }
    else out.push({ text: t.slice(1, -1), italic: true });
    pos = m.index + t.length;
  }
  if (pos < src.length) out.push({ text: src.slice(pos) });
  return out.map((x) => ({ ...x, text: x.code ? x.text : x.text.replace(UNESCAPE, "$1") })).filter((x) => x.text);
}
// Word equations are written into the document after it is built: a placeholder run marks where each one goes.
const mathMark = (i) => `\ue000M${i}\ue001`;
function inlineRuns(text, size = 22, extra = {}, maths = null) {
  const run = (t, value) => new TextRun({ text: value, size, bold: t.bold || extra.bold, italics: t.italic || extra.italics, strike: t.strike, font: t.code ? "Consolas" : undefined, color: extra.color });
  let runs;
  if (maths && hasMath(text)) {
    // Formulas are set aside first (their _ and * are not Markdown), so bold or italic around a formula
    // (**Rezultat: $x=5$**) still pairs up; then each formula goes back in its place.
    const formulas = [];
    const joined = splitInlineMath(text).map((p) => (p.text != null ? p.text : `\ue002${formulas.push(p) - 1}\ue003`)).join("");
    runs = [];
    for (const t of inlineTokens(joined)) {
      for (const piece of t.text.split(/(\ue002\d+\ue003)/)) {
        if (!piece) continue;
        const f = /^\ue002(\d+)\ue003$/.test(piece) ? formulas[Number(piece.slice(1, -1))] : null;
        if (!f) { runs.push(run(t, piece)); continue; }
        const omml = latexToOmml(f.math, { display: f.display, size });
        if (omml) { runs.push(new TextRun({ text: mathMark(maths.length), size })); maths.push(ommlInline(omml)); }
        else runs.push(run(t, f.raw));
      }
    }
  } else runs = inlineTokens(text).map((t) => run(t, t.text));
  return runs.length ? runs : [new TextRun({ text: "", size })];
}
async function insertWordMath(buffer, maths) {
  if (!maths.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/document.xml");
  let xml = await file.async("string");
  xml = xml.replace(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:t(?:\s[^>]*)?>\ue000M(\d+)\ue001<\/w:t><\/w:r>/g, (m, i) => maths[Number(i)] || "");
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ---------- PDF ----------
const PAGE = [595.28, 841.89], MARGIN = 48, TOP = 50, BOTTOM = 56;
const FONT_PAIRS = [["segoeui.ttf", "segoeuib.ttf"], ["arial.ttf", "arialbd.ttf"], ["calibri.ttf", "calibrib.ttf"], ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"], ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"], ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"], ["Arial.ttf", "Arial Bold.ttf"]];
const MONO_FONTS = ["consola.ttf", "DejaVuSansMono.ttf", "LiberationMono-Regular.ttf", "cour.ttf", "Courier New.ttf"];
function fontDirs() {
  return [path.join(process.env.WINDIR || "C:\\Windows", "Fonts"), "/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/liberation", "/usr/share/fonts/truetype/liberation2", "/usr/share/fonts/truetype/noto", "/usr/share/fonts/TTF", "/usr/share/fonts/dejavu", "/Library/Fonts", "/System/Library/Fonts/Supplemental"];
}
function findFont(name) {
  for (const dir of fontDirs()) { const p = path.join(dir, name); try { if (fs.statSync(p).isFile()) return p; } catch {} }
  return null;
}
function findWindowsFont() { for (const [r] of FONT_PAIRS) { const p = findFont(r); if (p) return p; } return null; }

const ASCII_FALLBACK = { "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "⇐": "<=", "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~", "±": "+/-", "×": "x", "÷": "/", "…": "...", "•": "-", "·": "-", "–": "-", "—": "-", "−": "-", "„": "\"", "“": "\"", "”": "\"", "«": "\"", "»": "\"", "‘": "'", "’": "'", "‚": "'", "€": "EUR", "£": "GBP", "™": "(TM)", "©": "(c)", "®": "(R)", "°": " grade", "✓": "v", "✔": "v", "✗": "x", "✘": "x", "☑": "[x]", "☐": "[ ]", "\u00a0": " ", "\u202f": " ", "\u2009": " ", "\t": "    " };
// Replaces every character the font cannot draw with the closest ASCII text (or "?"), so drawing never throws.
function fitterFor(font) {
  const set = new Set(font.getCharacterSet());
  const can = (s) => [...s].every((c) => set.has(c.codePointAt(0)));
  return (value) => {
    let out = "";
    for (const ch of String(value || "")) {
      if (set.has(ch.codePointAt(0))) { out += ch; continue; }
      if (/[\u200b-\u200d\u2060\ufe0e\ufe0f]/.test(ch) || /[\u{1F3FB}-\u{1F3FF}]/u.test(ch)) continue;
      const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (base && base !== ch && can(base)) { out += base; continue; }
      const mapped = ASCII_FALLBACK[ch];
      if (mapped !== undefined && can(mapped)) { out += mapped; continue; }
      if (/\p{Extended_Pictographic}/u.test(ch)) continue;
      out += set.has(63) ? "?" : "";
    }
    return out;
  };
}
function widthOf(font, text, size) { try { return font.widthOfTextAtSize(text, size); } catch { return text.length * size * 0.6; } }
function breakWord(word, font, size, maxWidth) {
  const parts = [];
  while (word && widthOf(font, word, size) > maxWidth) {
    let lo = 1, hi = word.length;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (widthOf(font, word.slice(0, mid), size) <= maxWidth) lo = mid; else hi = mid - 1; }
    parts.push(word.slice(0, lo)); word = word.slice(lo);
  }
  if (word) parts.push(word);
  return parts;
}
function wrapByWidth(text, font, size, maxWidth) {
  const lines = []; let cur = "";
  for (const raw of String(text || "").split(/ +/)) {
    const pieces = breakWord(raw, font, size, maxWidth);
    for (const [k, word] of pieces.entries()) {
      const cand = cur ? cur + " " + word : word;
      if (cur && (k > 0 || widthOf(font, cand, size) > maxWidth)) { lines.push(cur); cur = word; } else cur = cand;
    }
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}
function wrapCode(line, font, size, maxWidth) { return line ? breakWord(line, font, size, maxWidth) : [""]; }

async function createPdfBytes(title, content, opts = {}) {
  const pdf = await PDFDocument.create();
  let regular = null, bold = null, mono = null;
  if (!opts.standardFonts) {
    const pair = FONT_PAIRS.map(([r, b]) => [findFont(r), findFont(b)]).find(([r]) => r);
    if (pair) {
      try {
        pdf.registerFontkit(fontkit);
        regular = await pdf.embedFont(fs.readFileSync(pair[0]), { subset: true });
        bold = pair[1] ? await pdf.embedFont(fs.readFileSync(pair[1]), { subset: true }) : regular;
        const monoPath = MONO_FONTS.map(findFont).find(Boolean);
        if (monoPath) mono = await pdf.embedFont(fs.readFileSync(monoPath), { subset: true });
      } catch { regular = null; bold = null; mono = null; }
    }
  }
  if (!regular) { regular = await pdf.embedFont(StandardFonts.Helvetica); bold = await pdf.embedFont(StandardFonts.HelveticaBold); }
  // Formulas are typeset like Word's equations when a serif font with math symbols can be embedded.
  const mathFonts = !opts.standardFonts && hasMath(content) ? await loadMathFonts(pdf, (name) => { const p = findFont(name); try { return p ? fs.readFileSync(p) : null; } catch { return null; } }).catch(() => null) : null;
  if (!mono) mono = await pdf.embedFont(StandardFonts.Courier);
  const fit = new Map([[regular, fitterFor(regular)], [bold, fitterFor(bold)], [mono, fitterFor(mono)]]);
  const ink = rgb(0.12, 0.15, 0.2), muted = rgb(0.38, 0.42, 0.5), line = rgb(0.8, 0.83, 0.88);
  let page = pdf.addPage(PAGE), y = PAGE[1] - TOP;
  const newPage = () => { page = pdf.addPage(PAGE); y = PAGE[1] - TOP; };
  const ensure = (h) => { if (y - h < BOTTOM) newPage(); };
  const avail = PAGE[0] - 2 * MARGIN;
  // A paragraph with formulas in it: words and formulas wrapped together, each line as tall as its tallest formula.
  const writeWithMath = (text, { font, size, indent, color, after }) => {
    const tokens = [], spaceW = widthOf(font, " ", size);
    for (const part of splitInlineMath(text)) {
      const b = part.math != null ? layoutMath(part.math, mathFonts, { display: false, size: size * 1.12 }) : null;
      if (b) { tokens.push({ box: b, w: b.w }); continue; }
      const words = fit.get(font)(plainMarkdownText(part.math != null ? part.raw : part.text));
      for (const [k, word] of words.split(/ +/).entries()) {
        if (k > 0) tokens.push({ space: true, w: spaceW });
        for (const piece of word ? breakWord(word, font, size, avail - indent) : []) tokens.push({ text: piece, w: widthOf(font, piece, size) });
      }
    }
    const lines = [[]]; let width = 0;
    for (const t of tokens) {
      if (t.space && !lines[lines.length - 1].length) continue;
      if (!t.space && width + t.w > avail - indent && lines[lines.length - 1].length) { lines.push([]); width = 0; }
      lines[lines.length - 1].push(t); width += t.w;
    }
    for (const l of lines) {
      const up = Math.max(size, ...l.filter((t) => t.box).map((t) => t.box.a + size * 0.1)), down = Math.max(size * 0.3, ...l.filter((t) => t.box).map((t) => t.box.d + size * 0.1));
      ensure(up + down); y -= up;
      let x = MARGIN + indent;
      for (const t of l) {
        if (t.box) t.box.draw(page, x, y, color);
        else if (t.text) page.drawText(t.text, { x, y, size, font, color });
        x += t.w;
      }
      y -= down;
    }
    y -= after;
  };
  const write = (text, { font = regular, size = 11, indent = 0, color = ink, after = 5, plain = true } = {}) => {
    if (mathFonts && plain && hasMath(text)) return writeWithMath(text, { font, size, indent, color, after });
    const value = fit.get(font)(plain ? plainMarkdownText(text) : text);
    for (const l of wrapByWidth(value, font, size, avail - indent)) {
      ensure(size * 1.3); y -= size;
      page.drawText(l || " ", { x: MARGIN + indent, y, size, font, color });
      y -= size * 0.3;
    }
    y -= after;
  };
  const code = (lines) => {
    const size = 9, lh = size * 1.35;
    y -= 2;
    for (const raw of lines.length ? lines : [""]) {
      for (const l of wrapCode(fit.get(mono)(raw), mono, size, avail - 12)) {
        ensure(lh); y -= lh;
        page.drawRectangle({ x: MARGIN, y: y - 3, width: avail, height: lh, color: rgb(0.95, 0.96, 0.97) });
        page.drawText(l || " ", { x: MARGIN + 6, y, size, font: mono, color: ink });
      }
    }
    y -= 8;
  };
  const table = (rows) => {
    const cols = Math.max(1, ...rows.map((r) => r.length)), size = 9, pad = 4, cw = avail / cols, lh = size * 1.25;
    const cells = (row, ri) => Array.from({ length: cols }, (_, c) => {
      const font = ri === 0 ? bold : regular;
      const lines = wrapByWidth(fit.get(font)(plainMarkdownText(row[c] ?? "")), font, size, cw - 2 * pad);
      return lines.length > 40 ? [...lines.slice(0, 39), "..."] : lines;
    });
    const drawRow = (row, ri, repeat) => {
      const ls = cells(row, ri), h = Math.max(...ls.map((l) => l.length)) * lh + 2 * pad;
      if (y - h < BOTTOM) { newPage(); if (ri > 0 && !repeat) drawRow(rows[0], 0, true); }
      for (let c = 0; c < cols; c++) {
        const x = MARGIN + c * cw;
        page.drawRectangle({ x, y: y - h, width: cw, height: h, borderColor: line, borderWidth: 0.6, color: ri === 0 ? rgb(0.91, 0.93, 0.96) : undefined });
        ls[c].forEach((l, k) => page.drawText(l || " ", { x: x + pad, y: y - pad - (k + 1) * lh + 2, size, font: ri === 0 ? bold : regular, color: ink }));
      }
      y -= h;
    };
    rows.forEach((r, ri) => drawRow(r, ri, false));
    y -= 10;
  };
  write(title || "AI Stoica", { font: bold, size: 20, after: 14 });
  for (const b of parseDocumentBlocks(content, { math: !!mathFonts })) {
    if (b.type === "blank") { y -= 6; continue; }
    if (b.type === "math") {
      // An equation on its own lines, centred like in Word; scaled down when wider than the page.
      const eq = layoutMath(b.tex, mathFonts, { display: true, size: 13.5 });
      if (!eq) { write(b.text, { after: 5 }); continue; }
      const k = Math.min(1, avail / eq.w), h = (eq.a + eq.d) * k;
      ensure(h + 14); y -= 7 + eq.a * k;
      const x = MARGIN + (avail - eq.w * k) / 2;
      if (k < 1) { page.pushOperators(pushGraphicsState(), concatTransformationMatrix(k, 0, 0, k, x, y)); eq.draw(page, 0, 0, ink); page.pushOperators(popGraphicsState()); }
      else eq.draw(page, x, y, ink);
      y -= eq.d * k + 9;
      continue;
    }
    if (b.type === "heading") { y -= 4; write(b.text, { font: bold, size: b.level === 1 ? 17 : b.level === 2 ? 15 : b.level === 3 ? 13 : 12, after: 6 }); continue; }
    if (b.type === "bullet") { write("• " + b.text, { indent: 10 + 12 * b.level, after: 3 }); continue; }
    if (b.type === "number") { write(String(b.number) + ". " + b.text, { indent: 10 + 12 * b.level, after: 3 }); continue; }
    if (b.type === "quote") { write(b.text, { indent: 14, color: muted, after: 4 }); continue; }
    if (b.type === "rule") { ensure(12); y -= 6; page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE[0] - MARGIN, y }, thickness: 0.6, color: line }); y -= 6; continue; }
    if (b.type === "code") { code(b.lines); continue; }
    if (b.type === "table") { table(b.rows); continue; }
    write(b.text, { after: 5 });
  }
  return Buffer.from(await pdf.save());
}

// ---------- Word ----------
async function createDocxBytes(title, content) {
  const maths = [];
  const runs = (text, size, extra) => inlineRuns(text, size, extra, maths);
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(title || "AI Stoica"), bold: true, size: 36 })] }),
    new Paragraph({ text: "" })
  ];
  for (const b of parseDocumentBlocks(content, { math: true })) {
    if (b.type === "blank") { children.push(new Paragraph({ text: "" })); continue; }
    if (b.type === "math") {
      const omml = latexToOmml(b.tex, { display: true, size: 24 });
      if (omml) { children.push(new Paragraph({ spacing: { before: 60, after: 120 }, children: [new TextRun({ text: mathMark(maths.length), size: 24 })] })); maths.push(ommlDisplay(omml)); }
      else children.push(new Paragraph({ children: [new TextRun({ text: b.text, size: 22 })], spacing: { after: 120 } }));
      continue;
    }
    if (b.type === "heading") {
      const level = b.level <= 1 ? HeadingLevel.HEADING_1 : b.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      children.push(new Paragraph({ heading: level, children: runs(b.text, b.level <= 1 ? 30 : 26) }));
      continue;
    }
    if (b.type === "bullet") { children.push(new Paragraph({ bullet: { level: b.level || 0 }, children: runs(b.text, 22) })); continue; }
    if (b.type === "number") { children.push(new Paragraph({ indent: { left: 360 * (b.level || 0) }, children: [new TextRun({ text: String(b.number) + ". ", bold: true, size: 22 }), ...runs(b.text, 22)] })); continue; }
    if (b.type === "quote") { children.push(new Paragraph({ indent: { left: 720 }, children: runs(b.text, 22, { italics: true, color: "5F6B7A" }) })); continue; }
    if (b.type === "rule") { children.push(new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "C8CED8", space: 1 } } })); continue; }
    if (b.type === "code") {
      for (const l of b.lines.length ? b.lines : [""]) children.push(new Paragraph({ spacing: { after: 0 }, shading: { type: ShadingType.CLEAR, fill: "F2F4F7", color: "auto" }, children: [new TextRun({ text: l || " ", font: "Consolas", size: 19 })] }));
      children.push(new Paragraph({ text: "" }));
      continue;
    }
    if (b.type === "table") {
      const cols = Math.max(1, ...b.rows.map((r) => r.length));
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: b.rows.map((r, ri) => new TableRow({
          tableHeader: ri === 0,
          children: Array.from({ length: cols }, (_, c) => new TableCell({
            shading: ri === 0 ? { type: ShadingType.CLEAR, fill: "E8EDF5", color: "auto" } : undefined,
            children: [new Paragraph({ children: runs(r[c] ?? "", 20, { bold: ri === 0 }) })]
          }))
        }))
      }));
      children.push(new Paragraph({ text: "" }));
      continue;
    }
    children.push(new Paragraph({ children: runs(b.text, 22), spacing: { after: 120 } }));
  }
  const doc = new Document({ sections: [{ properties: {}, children }] });
  return insertWordMath(Buffer.from(await Packer.toBuffer(doc)), maths);
}

// ---------- PowerPoint ----------
function splitLong(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const parts = []; let cur = "";
  for (const piece of text.match(/[^.!?]+[.!?]*\s*/g) || [text]) {
    for (const chunk of piece.length > maxChars ? piece.match(new RegExp(`.{1,${maxChars}}(\\s|$)|.{1,${maxChars}}`, "g")) : [piece]) {
      if ((cur + chunk).length > maxChars && cur) { parts.push(cur.trim()); cur = ""; }
      cur += chunk;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
function slideChunks(content, maxChars = 750, maxLines = 12) {
  const slides = []; let current = { title: "", body: [] }, chars = 0;
  const flush = () => { if (current.body.length || current.code || current.table) slides.push(current); current = { title: current.title, body: [] }; chars = 0; };
  for (const b of parseDocumentBlocks(content)) {
    if (b.type === "blank" || b.type === "rule") continue;
    if (b.type === "heading" && b.level <= 2) { flush(); current = { title: plainMarkdownText(b.text), body: [] }; continue; }
    if (b.type === "code") { flush(); for (let k = 0; k < Math.max(1, b.lines.length); k += 20) slides.push({ title: current.title, body: [], code: b.lines.slice(k, k + 20) }); continue; }
    if (b.type === "table") { flush(); slides.push({ title: current.title, body: [], table: b.rows }); continue; }
    const prefix = b.type === "bullet" ? "• " : b.type === "number" ? String(b.number) + ". " : "";
    for (const piece of splitLong(prefix + plainMarkdownText(b.text), maxChars)) {
      if ((chars + piece.length > maxChars || current.body.length >= maxLines) && current.body.length) flush();
      current.body.push(piece); chars += piece.length;
    }
  }
  flush();
  return slides.length ? slides : [{ title: "", body: [plainMarkdownText(content).slice(0, maxChars)] }];
}
async function createPptxBytes(title, content) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "AI Stoica"; pptx.company = "Stoica Enterprises AI"; pptx.lang = "ro-RO";
  let s = pptx.addSlide(); s.background = { color: "F7F9FC" };
  s.addText(String(title || "AI Stoica"), { x: 0.8, y: 2.3, w: 11.7, h: 0.8, fontFace: "Aptos Display", fontSize: 28, bold: true, color: "172033", align: "center", margin: 0 });
  s.addText("Document generat cu AI Stoica", { x: 1.2, y: 3.25, w: 10.9, h: 0.4, fontFace: "Aptos", fontSize: 14, color: "52627A", align: "center", margin: 0 });
  for (const part of slideChunks(content)) {
    s = pptx.addSlide(); s.background = { color: "FFFFFF" };
    s.addText(part.title || String(title || "AI Stoica"), { x: 0.65, y: 0.45, w: 12, h: 0.55, fontFace: "Aptos Display", fontSize: 23, bold: true, color: "172033", margin: 0, fit: "shrink" });
    if (part.code) {
      s.addText(part.code.join("\n") || " ", { x: 0.8, y: 1.25, w: 11.7, h: 5.65, fontFace: "Consolas", fontSize: 12, color: "1F2937", fill: { color: "F2F4F7" }, valign: "top", margin: 0.12 });
    } else if (part.table) {
      const cols = Math.max(1, ...part.table.map((r) => r.length));
      const rows = part.table.map((r, ri) => Array.from({ length: cols }, (_, c) => ({ text: plainMarkdownText(r[c] ?? "").slice(0, 400), options: ri === 0 ? { bold: true, fill: { color: "E8EDF5" } } : {} })));
      s.addTable(rows, { x: 0.6, y: 1.25, w: 12.1, fontFace: "Aptos", fontSize: 12, color: "26354A", border: { type: "solid", pt: 0.5, color: "C8CED8" }, autoPage: true, autoPageRepeatHeader: true, autoPageHeaderRows: 1 });
    } else {
      const chars = part.body.join("").length;
      s.addText(part.body.join("\n"), { x: 0.8, y: 1.25, w: 11.7, h: 5.65, fontFace: "Aptos", fontSize: chars > 600 ? 15 : chars > 400 ? 16 : 18, color: "26354A", valign: "top", margin: 0.08, fit: "shrink", breakLine: false });
    }
  }
  const out = await pptx.write({ outputType: "arraybuffer" });
  return Buffer.from(out);
}

// ---------- Spreadsheets ----------
function xmlEscape(value) {
  return sanitizeText(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function stripOuterFence(content) {
  const text = String(content || "").trim();
  const m = text.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : text;
}
function parseDelimitedLine(line, delimiter) {
  const out = []; let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch; }
    else if (ch === '"' && !cur.trim()) quoted = true;
    else if (ch === delimiter) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
function markdownTableRows(content) {
  const text = String(content || "").replace(/\r/g, "").trim();
  const raw = stripOuterFence(text);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      const cell = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v);
      if (parsed.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
        const keys = [...new Set(parsed.flatMap((x) => Object.keys(x)))];
        return [keys, ...parsed.map((x) => keys.map((k) => cell(x[k])))];
      }
      if (parsed.every(Array.isArray)) return parsed.map((r) => r.map(cell));
    }
  } catch {}
  const tables = parseDocumentBlocks(text).filter((b) => b.type === "table");
  if (tables.length) return tables.flatMap((t, i) => (i ? [[], ...t.rows] : t.rows)).map((r) => r.map((c) => plainMarkdownText(c)));
  const lines = raw.split("\n").map((x) => x.trim()).filter(Boolean);
  for (const delimiter of ["\t", ";", ","]) {
    const rows = lines.map((l) => parseDelimitedLine(l, delimiter));
    const counts = rows.map((r) => r.length).filter((n) => n > 1);
    if (counts.length < 2) continue;
    const freq = new Map(); for (const n of counts) freq.set(n, (freq.get(n) || 0) + 1);
    const [, best] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best >= Math.max(2, Math.ceil(lines.length * 0.6))) return rows;
  }
  const simple = lines.filter((x) => !/^#{1,6}\s/.test(x) && !/^```/.test(x)).map((x) => [plainMarkdownText(x.replace(/^[-*•]\s+/, ""))]);
  return [["Conținut"], ...(simple.length ? simple : [[plainMarkdownText(text)]])];
}
function excelColumnName(index) {
  let n = index + 1, out = "";
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
// Romanian formats first ("1.500" = 1500, "1,5" = 1.5, "1.234,56"); long digit strings (CNP, phone,
// card or account numbers) and codes with leading zeros stay text so Excel does not mangle them.
function parseNumberCell(value) {
  const t = String(value ?? "").trim();
  if (!t || t.length > 24 || t.replace(/\D/g, "").length > 15) return null;
  if (/^-?0\d/.test(t)) return null;
  let n = null;
  if (/^-?\d+$/.test(t)) n = t.replace(/^-/, "").length > 11 ? null : Number(t);
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) n = Number(t.replace(/\./g, "").replace(",", "."));
  else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(t) || /^-?\d{1,3}(,\d{3}){2,}$/.test(t)) n = Number(t.replace(/,/g, ""));
  else if (/^-?\d+,\d+$/.test(t)) n = Number(t.replace(",", "."));
  else if (/^-?\d+\.\d+$/.test(t)) n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function xlsxCellXml(value, row, col, style = 0) {
  const ref = excelColumnName(col) + (row + 1);
  const raw = value == null ? "" : value;
  const n = typeof raw === "number" ? (Number.isFinite(raw) ? raw : null) : parseNumberCell(raw);
  if (n !== null) return `<c r="${ref}" s="${style}"><v>${n}</v></c>`;
  let text = sanitizeText(raw);
  if (text.length > 32767) text = text.slice(0, 32766) + "…";
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}
function sheetNameFrom(title) {
  let name = sanitizeText(title || "Foaie").replace(/[\[\]*?:\\/]/g, " ").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "").slice(0, 31).trim().replace(/^'+|'+$/g, "");
  if (!name || /^history$/i.test(name)) name = "Foaie1";
  return name;
}
async function createXlsxBytes(title, content) {
  const rows = markdownTableRows(content).slice(0, 1048575);
  const zip = new JSZip();
  const sheetName = sheetNameFrom(safeGeneratedName(title || "Foaie"));
  const maxCols = Math.min(16384, Math.max(1, ...rows.map((r) => r.length)));
  const widths = Array.from({ length: maxCols }, (_, c) => { let w = 10; for (const r of rows) w = Math.max(w, Math.min(60, String(r[c] ?? "").length + 2)); return w; });
  const sheetData = rows.map((row, r) => `<row r="${r + 1}">${Array.from({ length: maxCols }, (_, c) => xlsxCellXml(row[c] ?? "", r, c, r === 0 ? 1 : 0)).join("")}</row>`).join("");
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl").file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl").folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.folder("xl").file("styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`);
  zip.folder("xl").folder("worksheets").file("sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${sheetData}</sheetData></worksheet>`);
  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
// Romanian Excel uses ";" as list separator. Text that Excel would run as a formula is prefixed with "'".
function csvEscape(value) {
  let s = sanitizeText(value == null ? "" : value);
  if (/^[=+\-@\t\r]/.test(s) && parseNumberCell(s) === null) s = "'" + s;
  return /[";\n\r]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function createCsvBytes(content) {
  const rows = markdownTableRows(content);
  return Buffer.from("\ufeff" + rows.map((r) => r.map(csvEscape).join(";")).join("\r\n"), "utf8");
}

// ---------- Other formats ----------
function createJsonBytes(title, content) {
  const raw = stripOuterFence(content);
  try { return Buffer.from(JSON.stringify(JSON.parse(raw), null, 2) + "\n", "utf8"); }
  catch { return Buffer.from(JSON.stringify({ title: String(title || "AI Stoica"), content: String(content || "") }, null, 2) + "\n", "utf8"); }
}
function htmlInline(text) {
  return inlineTokens(text).map((t) => {
    let h = xmlEscape(t.text);
    if (t.code) h = `<code>${h}</code>`;
    if (t.bold) h = `<strong>${h}</strong>`;
    if (t.italic) h = `<em>${h}</em>`;
    if (t.strike) h = `<s>${h}</s>`;
    return h;
  }).join("");
}
function createHtmlBytes(title, content) {
  const raw = stripOuterFence(content);
  if (/^<!doctype html|^<html[\s>]/i.test(raw)) return Buffer.from(raw, "utf8");
  const body = parseDocumentBlocks(content).map((b) => {
    if (b.type === "heading") return `<h${Math.min(4, b.level)}>${htmlInline(b.text)}</h${Math.min(4, b.level)}>`;
    if (b.type === "bullet") return `<p>• ${htmlInline(b.text)}</p>`;
    if (b.type === "number") return `<p>${b.number}. ${htmlInline(b.text)}</p>`;
    if (b.type === "quote") return `<blockquote>${htmlInline(b.text)}</blockquote>`;
    if (b.type === "rule") return "<hr>";
    if (b.type === "code") return `<pre><code>${xmlEscape(b.lines.join("\n"))}</code></pre>`;
    if (b.type === "table") return `<table>${b.rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${htmlInline(c)}</td>` : `<th>${htmlInline(c)}</th>`)).join("")}</tr>`).join("")}</table>`;
    if (b.type === "blank") return "";
    return `<p>${htmlInline(b.text)}</p>`;
  }).join("\n");
  return Buffer.from(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xmlEscape(title || "AI Stoica")}</title><style>body{font-family:Segoe UI,Arial,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;line-height:1.5}table{border-collapse:collapse}td,th{border:1px solid #ccd;padding:4px 8px}pre{background:#f2f4f7;padding:10px;overflow:auto}</style></head><body><main>${body}</main></body></html>`, "utf8");
}
function createXmlBytes(title, content) {
  const raw = stripOuterFence(content);
  if (/^<\?xml\b|^<[A-Za-z_][\w:.-]*(?:\s|>)/.test(raw)) return Buffer.from(raw, "utf8");
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><document><title>${xmlEscape(title || "AI Stoica")}</title><content>${xmlEscape(content)}</content></document>`, "utf8");
}
function rtfEscape(value) {
  let out = "";
  for (const ch of String(value || "")) {
    const cp = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === "{") out += "\\{";
    else if (ch === "}") out += "\\}";
    else if (ch === "\n") out += "\\par\n";
    else if (ch === "\r") continue;
    else if (cp > 0xffff) { const hi = Math.floor((cp - 0x10000) / 0x400) + 0xd800, lo = ((cp - 0x10000) % 0x400) + 0xdc00; out += `\\u${hi - 65536}?\\u${lo - 65536}?`; }
    else if (cp > 127) { const signed = cp > 32767 ? cp - 65536 : cp; out += `\\u${signed}?`; }
    else out += ch;
  }
  return out;
}
function createRtfBytes(title, content) {
  return Buffer.from(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Segoe UI;}}\\fs24\\b ${rtfEscape(title || "AI Stoica")}\\b0\\par\\par ${rtfEscape(plainMarkdownText(content))}}`, "utf8");
}
function languageExtension(lang) {
  const map = { javascript: "js", js: "js", typescript: "ts", ts: "ts", jsx: "jsx", tsx: "tsx", python: "py", py: "py", java: "java", c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs", go: "go", rust: "rs", rs: "rs", php: "php", ruby: "rb", rb: "rb", bash: "sh", shell: "sh", sh: "sh", powershell: "ps1", ps1: "ps1", sql: "sql", html: "html", css: "css", json: "json", xml: "xml", yaml: "yaml", yml: "yml", toml: "toml", markdown: "md", md: "md", text: "txt", txt: "txt", svg: "svg", latex: "tex", tex: "tex" };
  return map[String(lang || "").toLowerCase()] || "txt";
}
// Every path segment is cleaned and "..", "." or dot-only segments are dropped, so entries stay inside the archive.
function safeZipPath(value) {
  const parts = String(value || "").replace(/\\/g, "/").split("/")
    .map((p) => p.replace(/[^A-Za-z0-9._-]+/g, "_"))
    .filter((p) => p && !/^\.+$/.test(p));
  const clean = parts.join("/");
  return clean && !String(value || "").endsWith("/") ? clean.slice(0, 180) : "";
}
async function createZipBytes(title, content) {
  const zip = new JSZip();
  zip.file("README.md", String(content || ""));
  const re = /```([^\n]*)\n([\s\S]*?)\n?```/g;
  let m, index = 1;
  while ((m = re.exec(String(content || "")))) {
    const header = String(m[1] || "").trim();
    const explicit = (header.match(/(?:file(?:name)?\s*[:=]\s*)?([A-Za-z0-9_.\/-]+\.[A-Za-z0-9]+)$/i) || [])[1];
    const lang = header.split(/\s+/)[0];
    const name = safeZipPath(explicit) || `file-${index++}.${languageExtension(lang)}`;
    if (name !== "README.md") zip.file(name, m[2]);
  }
  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
function createIpynbBytes(content) {
  const raw = stripOuterFence(content);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.cells)) return Buffer.from(JSON.stringify(parsed, null, 2) + "\n", "utf8");
  } catch {}
  const notebook = { cells: [{ cell_type: "markdown", metadata: {}, source: String(content || "").split(/(?<=\n)/) }], metadata: { language_info: { name: "python" } }, nbformat: 4, nbformat_minor: 5 };
  return Buffer.from(JSON.stringify(notebook, null, 2) + "\n", "utf8");
}
function createSvgBytes(title, content) {
  const raw = stripOuterFence(content);
  if (/^<svg[\s>]/i.test(raw)) return Buffer.from(raw, "utf8");
  const text = plainMarkdownText(content).replace(/\s+/g, " ").slice(0, 500);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#ffffff"/><text x="60" y="90" font-family="Arial, sans-serif" font-size="42" font-weight="700">${xmlEscape(title || "AI Stoica")}</text><text x="60" y="155" font-family="Arial, sans-serif" font-size="24">${xmlEscape(text)}</text></svg>`, "utf8");
}
const PLAIN_TEXT_MIME = {
  md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8", html: "text/html; charset=utf-8", xml: "application/xml; charset=utf-8", rtf: "application/rtf",
  js: "text/javascript; charset=utf-8", ts: "text/plain; charset=utf-8", jsx: "text/javascript; charset=utf-8", tsx: "text/plain; charset=utf-8", py: "text/x-python; charset=utf-8",
  java: "text/x-java-source; charset=utf-8", c: "text/x-c; charset=utf-8", cpp: "text/x-c++src; charset=utf-8", cs: "text/plain; charset=utf-8", go: "text/plain; charset=utf-8",
  rs: "text/plain; charset=utf-8", php: "text/plain; charset=utf-8", rb: "text/plain; charset=utf-8", sh: "text/x-shellscript; charset=utf-8", ps1: "text/plain; charset=utf-8",
  sql: "application/sql; charset=utf-8", css: "text/css; charset=utf-8", yaml: "application/yaml; charset=utf-8", yml: "application/yaml; charset=utf-8", toml: "text/plain; charset=utf-8",
  ini: "text/plain; charset=utf-8", tex: "application/x-tex; charset=utf-8"
};
const EXPORT_FORMATS = new Set(["pdf", "docx", "pptx", "xlsx", "csv", "json", "md", "txt", "html", "xml", "rtf", "zip", "ipynb", "svg", ...Object.keys(PLAIN_TEXT_MIME)]);
async function createExportBytes(format, rawTitle, rawContent, opts = {}) {
  const title = sanitizeText(rawTitle), content = sanitizeText(rawContent);
  if (format === "pdf") return { bytes: await createPdfBytes(title, content, opts), mime: "application/pdf" };
  if (format === "docx") return { bytes: await createDocxBytes(title, content), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  if (format === "pptx") return { bytes: await createPptxBytes(title, content), mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
  if (format === "xlsx") return { bytes: await createXlsxBytes(title, content), mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  if (format === "csv") return { bytes: createCsvBytes(content), mime: "text/csv; charset=utf-8" };
  if (format === "json") return { bytes: createJsonBytes(title, content), mime: "application/json; charset=utf-8" };
  if (format === "html") return { bytes: createHtmlBytes(title, content), mime: PLAIN_TEXT_MIME.html };
  if (format === "xml") return { bytes: createXmlBytes(title, content), mime: PLAIN_TEXT_MIME.xml };
  if (format === "rtf") return { bytes: createRtfBytes(title, content), mime: PLAIN_TEXT_MIME.rtf };
  if (format === "zip") return { bytes: await createZipBytes(title, content), mime: "application/zip" };
  if (format === "ipynb") return { bytes: createIpynbBytes(content), mime: "application/x-ipynb+json" };
  if (format === "svg") return { bytes: createSvgBytes(title, content), mime: "image/svg+xml" };
  return { bytes: Buffer.from(stripOuterFence(content), "utf8"), mime: PLAIN_TEXT_MIME[format] || "text/plain; charset=utf-8" };
}

module.exports = { safeGeneratedName, EXPORT_FORMATS, createExportBytes, markdownTableRows, parseDocumentBlocks, plainMarkdownText, sanitizeText, parseNumberCell, safeZipPath, sheetNameFrom, findWindowsFont };
