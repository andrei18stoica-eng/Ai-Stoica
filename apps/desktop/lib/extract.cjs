// Text extraction for Library files, so the AI can read what you upload.
// Supported: plain text and code files, Word (.docx), PowerPoint (.pptx), Excel (.xlsx),
// OpenDocument (.odt/.odp/.ods) and PDF files that contain real text (not scanned images).
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const JSZip = require("jszip");

const MAX_CHARS = 200000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|js|cjs|mjs|ts|tsx|jsx|py|java|c|h|cpp|hpp|cs|go|rs|php|rb|sh|ps1|bat|sql|html|htm|css|scss|xml|yaml|yml|toml|ini|cfg|log|tex|srt|vtt)$/i;

function decodeXmlEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n) || 32))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16) || 32))
    .replace(/&amp;/g, "&");
}

function cleanText(s) {
  return String(s || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_CHARS);
}

function textFromWordXml(xml) {
  return decodeXmlEntities(String(xml)
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, ""));
}

function textFromDrawingXml(xml) {
  return decodeXmlEntities(String(xml)
    .replace(/<a:br[^>]*\/>/g, "\n")
    .replace(/<\/a:p>/g, "\n")
    .replace(/<[^>]+>/g, ""));
}

function naturalOrder(a, b) {
  const na = Number((a.match(/(\d+)\.xml$/) || [])[1] || 0), nb = Number((b.match(/(\d+)\.xml$/) || [])[1] || 0);
  return na - nb || a.localeCompare(b);
}

async function extractDocx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*|footnotes)\.xml$/.test(n));
  const order = (n) => (n === "word/document.xml" ? 0 : 1);
  parts.sort((a, b) => order(a) - order(b));
  const out = [];
  for (const p of parts) out.push(textFromWordXml(await zip.file(p).async("string")));
  return out.join("\n");
}

async function extractPptx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(naturalOrder);
  const out = [];
  for (const [i, s] of slides.entries()) out.push(`--- Slide ${i + 1} ---\n` + textFromDrawingXml(await zip.file(s).async("string")));
  return out.join("\n");
}

async function extractXlsx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const shared = [];
  const sst = zip.file("xl/sharedStrings.xml");
  if (sst) {
    const xml = await sst.async("string");
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(decodeXmlEntities((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
    }
  }
  const sheets = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(naturalOrder);
  const out = [];
  for (const [i, name] of sheets.entries()) {
    const xml = await zip.file(name).async("string");
    const rows = [];
    for (const row of xml.match(/<row[\s\S]*?<\/row>/g) || []) {
      const cells = [];
      for (const c of row.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) || []) {
        const type = (c.match(/\bt="([^"]+)"/) || [])[1];
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        const inline = (c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        if (type === "s" && v != null) cells.push(shared[Number(v)] ?? "");
        else if (inline != null) cells.push(decodeXmlEntities(inline));
        else cells.push(v != null ? decodeXmlEntities(v) : "");
      }
      if (cells.some((x) => String(x).trim())) rows.push(cells.join("\t"));
    }
    out.push(`--- Foaia ${i + 1} ---\n` + rows.join("\n"));
  }
  return out.join("\n");
}

async function extractOpenDocument(buf) {
  const zip = await JSZip.loadAsync(buf);
  const content = zip.file("content.xml");
  if (!content) return "";
  const xml = await content.async("string");
  return decodeXmlEntities(xml.replace(/<text:tab\/>/g, "\t").replace(/<text:line-break\/>/g, "\n")
    .replace(/<\/text:(p|h)>/g, "\n").replace(/<\/table:table-cell>/g, "\t").replace(/<\/table:table-row>/g, "\n")
    .replace(/<[^>]+>/g, ""));
}

// ---------- PDF (best effort, for PDFs that contain real text) ----------

function decodePdfLiteral(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== "\\") { out += ch; continue; }
    const n = s[++i];
    if (n === undefined) break;
    if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "b" || n === "f") out += "";
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] || "")) oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (n === "\r" || n === "\n") { if (n === "\r" && s[i + 1] === "\n") i++; }
    else out += n;
  }
  return out;
}

function decodePdfHex(hex) {
  const clean = hex.replace(/\s+/g, "");
  const bytes = Buffer.from(clean.length % 2 ? clean + "0" : clean, "hex");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  // Two-byte glyph codes without a font map cannot be decoded reliably; keep printable single bytes only.
  const latin = bytes.toString("latin1");
  return /^[\x20-\x7e\xa0-\xff\s]*$/.test(latin) ? latin : "";
}

function readPdfStrings(segment) {
  // Returns the text shown by Tj / TJ / ' / " operators in a content stream.
  const out = [];
  const re = /\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>|\[|\]|T\*|Td|TD|Tm|Tj|TJ|'|"|ET/g;
  let m, inArray = false, pending = [];
  while ((m = re.exec(segment))) {
    const tok = m[0];
    if (tok[0] === "(") pending.push(decodePdfLiteral(tok.slice(1, -1)));
    else if (tok[0] === "<") pending.push(decodePdfHex(tok.slice(1, -1)));
    else if (tok === "[") { inArray = true; pending = []; }
    else if (tok === "]") { inArray = false; }
    else if (tok === "Tj" || tok === "TJ" || tok === "'" || tok === '"') {
      if (tok === "'" || tok === '"') out.push("\n");
      out.push(pending.join(""));
      pending = [];
    } else if (tok === "T*" || tok === "Td" || tok === "TD" || tok === "Tm" || tok === "ET") {
      if (!inArray) { out.push("\n"); pending = []; }
    }
  }
  return out.join("").replace(/\n\s*\n+/g, "\n");
}

function ascii85Decode(buf) {
  const src = buf.toString("latin1").replace(/^\s*<~/, "").replace(/~>[\s\S]*$/, "").replace(/\s+/g, "");
  const out = [];
  let group = [];
  for (const ch of src) {
    if (ch === "z" && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) continue;
    group.push(c);
    if (group.length === 5) {
      let v = 0; for (const g of group) v = v * 85 + g;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0; for (const g of group) v = v * 85 + g;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, n - 1));
  }
  return Buffer.from(out);
}

function decodePdfStream(data, dict) {
  const filterPart = (dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/) || [])[1] || "";
  const filters = filterPart.match(/\/\w+/g) || [];
  let out = data;
  for (const f of filters) {
    if (f === "/FlateDecode" || f === "/Fl") {
      try { out = zlib.inflateSync(out); }
      catch { try { out = zlib.inflateRawSync(out); } catch { return null; } }
    } else if (f === "/ASCII85Decode" || f === "/A85") out = ascii85Decode(out);
    else if (f === "/ASCIIHexDecode" || f === "/AHx") out = Buffer.from(out.toString("latin1").replace(/[^0-9a-f]/gi, ""), "hex");
    else return null;
  }
  return out;
}

function extractPdf(buf) {
  const raw = buf.toString("latin1");
  const texts = [];
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const dict = m[1];
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    if (/\/Subtype\s*\/Image|\/Type\s*\/XObject/.test(dict)) { re.lastIndex = end; continue; }
    const data = decodePdfStream(buf.subarray(start, end), dict);
    if (!data) { re.lastIndex = end; continue; }
    const content = data.toString("latin1");
    if (/\bBT\b/.test(content)) texts.push(readPdfStrings(content));
    re.lastIndex = end;
  }
  const text = texts.join("\n");
  // Convert from Latin-1 bytes when the PDF uses a standard single-byte encoding.
  return text.replace(/[^\S\n]+/g, " ");
}

function kindFor(name, mime) {
  const n = String(name || "").toLowerCase(), m = String(mime || "").toLowerCase();
  if (/\.docx$/.test(n) || m.includes("wordprocessingml")) return "docx";
  if (/\.pptx$/.test(n) || m.includes("presentationml")) return "pptx";
  if (/\.xlsx$/.test(n) || m.includes("spreadsheetml")) return "xlsx";
  if (/\.(odt|odp|ods)$/.test(n) || m.includes("opendocument")) return "odf";
  if (/\.pdf$/.test(n) || m === "application/pdf") return "pdf";
  if (TEXT_EXT.test(n) || m.startsWith("text/") || /json|xml|javascript|yaml|csv/.test(m)) return "text";
  return "";
}

// Returns { text, status } where status is "ok", "empty" (nothing readable, e.g. scanned PDF)
// or "unsupported" (images, audio, video, unknown binaries).
async function extractText(filePath, mime, name) {
  const kind = kindFor(name || path.basename(filePath), mime);
  if (!kind) return { text: "", status: "unsupported" };
  const stat = fs.statSync(filePath);
  if (stat.size > 60 * 1024 * 1024) return { text: "", status: "too_large" };
  const buf = fs.readFileSync(filePath);
  let text = "";
  if (kind === "text") text = buf.toString("utf8").replace(/^\ufeff/, "");
  else if (kind === "docx") text = await extractDocx(buf);
  else if (kind === "pptx") text = await extractPptx(buf);
  else if (kind === "xlsx") text = await extractXlsx(buf);
  else if (kind === "odf") text = await extractOpenDocument(buf);
  else if (kind === "pdf") text = extractPdf(buf);
  text = cleanText(text);
  return { text, status: text.replace(/[\s\-–—]/g, "").length >= 3 ? "ok" : "empty" };
}

module.exports = { extractText, kindFor, extractPdf, extractDocx, extractPptx, extractXlsx, decodePdfLiteral };
