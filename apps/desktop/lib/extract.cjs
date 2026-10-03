// Text extraction for Library files, so the AI can read what you upload.
// Supported: plain text and code files, Word (.docx), PowerPoint (.pptx), Excel (.xlsx),
// OpenDocument (.odt/.odp/.ods) and PDF files that contain real text (not scanned images).
// Compressed content is decompressed with hard size limits, so a small "zip bomb" cannot exhaust memory.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const JSZip = require("jszip");
const MDBReaderModule = require("mdb-reader");
const MDBReader = MDBReaderModule.default || MDBReaderModule;

const MAX_CHARS = 200000;
const MAX_ENTRY_BYTES = 48 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 160 * 1024 * 1024;
const MAX_PDF_STREAM_BYTES = 32 * 1024 * 1024;
const MAX_PDF_TOTAL_BYTES = 128 * 1024 * 1024;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|js|cjs|mjs|ts|tsx|jsx|py|java|c|h|cpp|hpp|cs|go|rs|php|rb|sh|ps1|bat|sql|html|htm|css|scss|xml|svg|yaml|yml|toml|ini|cfg|log|tex|srt|vtt|rtf)$/i;

function codePoint(n) { return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "�"; }
function decodeXmlEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => codePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function cleanText(s) {
  // Linear-time cleanup (a regex like /[ \t]+\n/ is quadratic on long runs of spaces and could freeze the app).
  const lines = String(s || "").slice(0, MAX_CHARS * 4).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").split("\n");
  return lines.map((l) => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_CHARS);
}

// UTF-8 (with or without BOM), UTF-16 LE/BE (BOM or detected) and the older Windows-1250
// encoding used by many Romanian programs (accounting exports, old CSV files).
function decodeTextBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  let evenZeros = 0, oddZeros = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) (i % 2 ? oddZeros++ : evenZeros++);
  const half = sample.length / 2;
  if (half >= 4 && oddZeros > half * 0.3 && evenZeros < half * 0.05) return new TextDecoder("utf-16le").decode(buf);
  if (half >= 4 && evenZeros > half * 0.3 && oddZeros < half * 0.05) return new TextDecoder("utf-16be").decode(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch {}
  try { return new TextDecoder("windows-1250").decode(buf); } catch { return buf.toString("latin1"); }
}

async function loadZip(buf) {
  const zip = await JSZip.loadAsync(buf);
  // The declared sizes can lie, so the real budget is enforced while reading. A big but honest file
  // (e.g. a large Excel export) is read up to the budget instead of being rejected.
  zip.__budget = MAX_ARCHIVE_BYTES;
  zip.__truncated = false;
  return zip;
}
// Reads one archive entry, stopping at MAX_ENTRY_BYTES (or the archive budget) and keeping what was read.
function readEntry(zip, name) {
  const entry = zip.file(name);
  if (!entry) return Promise.resolve("");
  if (zip.__budget <= 0) { zip.__truncated = true; return Promise.resolve(""); }
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, finished = false;
    const helper = entry.internalStream("uint8array");
    const finish = () => { if (finished) return; finished = true; resolve(Buffer.concat(chunks).toString("utf8")); };
    helper.on("data", (chunk) => {
      if (finished) return;
      const room = Math.min(MAX_ENTRY_BYTES - size, zip.__budget);
      if (chunk.length > room) {
        if (room > 0) chunks.push(Buffer.from(chunk.subarray(0, room)));
        zip.__budget -= Math.max(0, room); zip.__truncated = true;
        try { helper.pause(); } catch {}
        return finish();
      }
      size += chunk.length; zip.__budget -= chunk.length;
      chunks.push(Buffer.from(chunk));
    });
    helper.on("error", (e) => { if (!finished) { finished = true; reject(e); } });
    helper.on("end", finish);
    helper.resume();
  });
}

function textFromWordXml(xml) {
  return decodeXmlEntities(String(xml)
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, "")
    .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, "")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:(br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
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
  const zip = await loadZip(buf);
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
  const order = (n) => (n === "word/document.xml" ? 0 : 1);
  parts.sort((a, b) => order(a) - order(b));
  const out = [];
  for (const p of parts) out.push(textFromWordXml(await readEntry(zip, p)));
  return out.join("\n");
}

async function extractPptx(buf) {
  const zip = await loadZip(buf);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(naturalOrder);
  const out = [];
  for (const [i, s] of slides.entries()) out.push(`--- Slide ${i + 1} ---\n` + textFromDrawingXml(await readEntry(zip, s)));
  return out.join("\n");
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function columnIndex(ref) {
  const letters = String(ref || "").match(/^[A-Z]+/i);
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function runText(xml) {
  return decodeXmlEntities(String(xml || "").replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>/g)?.map((t) => t.replace(/<[^>]+>/g, "")).join("") || "");
}
function excelDate(serial, date1904) {
  const ms = Math.round((Number(serial) + (date1904 ? 1462 : 0) - 25569) * 86400000);
  if (!Number.isFinite(ms)) return String(serial);
  const d = new Date(ms), iso = d.toISOString();
  return Number(serial) % 1 ? iso.slice(0, 16).replace("T", " ") : iso.slice(0, 10);
}
async function extractXlsx(buf) {
  const zip = await loadZip(buf);
  const shared = [];
  for (const si of (await readEntry(zip, "xl/sharedStrings.xml")).match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(runText(si));
  const dateStyles = new Set();
  const styles = await readEntry(zip, "xl/styles.xml");
  if (styles) {
    const custom = new Map();
    for (const m of styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), decodeXmlEntities(m[2]));
    const xfs = (styles.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [""])[0].match(/<xf\b[^>]*>/g) || [];
    xfs.forEach((xf, i) => {
      const id = Number((xf.match(/numFmtId="(\d+)"/) || [])[1] || 0);
      const code = custom.get(id) || "";
      if (BUILTIN_DATE_FORMATS.has(id) || (code && /[dmyh]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")))) dateStyles.add(i);
    });
  }
  const workbook = await readEntry(zip, "xl/workbook.xml");
  const date1904 = /date1904="(1|true)"/.test(workbook);
  const rels = await readEntry(zip, "xl/_rels/workbook.xml.rels");
  const targets = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/\bId="([^"]+)"/) || [])[1], target = (m[0].match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  let sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXmlEntities((m[0].match(/\bname="([^"]*)"/) || [])[1] || "");
    const rid = (m[0].match(/\br:id="([^"]+)"/) || [])[1];
    const target = rid && targets.get(rid);
    if (target && zip.file("xl/" + target)) sheets.push({ name, file: "xl/" + target });
  }
  if (!sheets.length) sheets = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(naturalOrder).map((file) => ({ name: "", file }));
  const out = [];
  for (const [i, sheet] of sheets.entries()) {
    const xml = await readEntry(zip, sheet.file);
    const rows = [];
    for (const row of xml.match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || []) {
      const cells = [];
      for (const m of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = m[1] || "", body = m[2] || "";
        const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
        const style = Number((attrs.match(/\bs="(\d+)"/) || [])[1] ?? -1);
        const col = columnIndex((attrs.match(/\br="([A-Z]+)\d*"/i) || [])[1]);
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let value = "";
        if (type === "s" && v != null) value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = runText((body.match(/<is>[\s\S]*?<\/is>/) || [""])[0]);
        else if (type === "b" && v != null) value = v === "1" ? "TRUE" : "FALSE";
        else if (v != null) value = !type && dateStyles.has(style) && /^-?\d+(\.\d+)?$/.test(v) ? excelDate(v, date1904) : decodeXmlEntities(v);
        const at = col >= 0 && col < 16384 ? col : cells.length;
        while (cells.length < at) cells.push("");
        cells[at] = value;
      }
      if (cells.some((x) => String(x).trim())) rows.push(cells.join("\t"));
    }
    out.push(`--- Foaia ${i + 1}${sheet.name ? ": " + sheet.name : ""} ---\n` + rows.join("\n"));
  }
  return out.join("\n");
}

async function extractOpenDocument(buf) {
  const zip = await loadZip(buf);
  const xml = await readEntry(zip, "content.xml");
  if (!xml) return "";
  return decodeXmlEntities(xml.replace(/<text:tab\/>/g, "\t").replace(/<text:line-break\/>/g, "\n")
    .replace(/<text:s\s+text:c="(\d+)"\s*\/>/g, (_m, n) => " ".repeat(Math.min(50, Number(n) || 1))).replace(/<text:s\/>/g, " ")
    .replace(/<\/text:(p|h)>/g, "\n").replace(/<\/table:table-cell>/g, "\t").replace(/<\/table:table-row>/g, "\n")
    .replace(/<[^>]+>/g, ""));
}

async function extractAccess(buf) {
  const reader = new MDBReader(buf);
  const tableNames = reader.getTableNames({ normalTables:true, systemTables:false, linkedTables:true }).slice(0,100);
  const out = [];
  const safeValue = (value) => {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return `[binary ${value.length} bytes]`;
    if (Array.isArray(value)) return value.map(x => x && typeof x === "object" ? {
      name:x.name || "", type:x.type || "", url:x.url || "",
      timestamp:x.timestamp instanceof Date ? x.timestamp.toISOString() : (x.timestamp || ""),
      data:x.data && Buffer.isBuffer(x.data) ? `[binary ${x.data.length} bytes]` : undefined
    } : x);
    return value;
  };
  for (const name of tableNames) {
    const table = reader.getTable(name);
    const columns = table.getColumnNames();
    const rows = table.getData({ rowOffset:0, rowLimit:500 });
    out.push(`--- Tabel: ${name} (${table.rowCount} rânduri) ---`);
    out.push(columns.join("\t"));
    for (const row of rows) {
      out.push(columns.map(col => {
        const value=safeValue(row[col]);
        return value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
      }).join("\t"));
      if (out.join("\n").length >= MAX_CHARS) return out.join("\n").slice(0,MAX_CHARS);
    }
    if (table.rowCount > rows.length) out.push(`[... ${table.rowCount-rows.length} rânduri neafișate ...]`);
  }
  return out.join("\n");
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

function decodePdfStream(data, dict, budget) {
  const filterPart = (dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/) || [])[1] || "";
  const filters = filterPart.match(/\/\w+/g) || [];
  let out = data;
  for (const f of filters) {
    if (f === "/FlateDecode" || f === "/Fl") {
      const opts = { maxOutputLength: Math.max(1024, Math.min(MAX_PDF_STREAM_BYTES, budget.left)) };
      try { out = zlib.inflateSync(out, opts); }
      catch (e) {
        if (e && e.code === "ERR_BUFFER_TOO_LARGE") return null;
        try { out = zlib.inflateRawSync(out, opts); } catch { return null; }
      }
    } else if (f === "/ASCII85Decode" || f === "/A85") out = ascii85Decode(out);
    else if (f === "/ASCIIHexDecode" || f === "/AHx") out = Buffer.from(out.toString("latin1").replace(/[^0-9a-f]/gi, ""), "hex");
    else return null;
  }
  budget.left -= out.length;
  return out;
}

function extractPdf(buf) {
  const raw = buf.toString("latin1");
  const texts = [];
  const budget = { left: MAX_PDF_TOTAL_BYTES };
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m, streams = 0;
  while ((m = re.exec(raw)) && budget.left > 0 && streams++ < 20000) {
    const dict = m[1];
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    if (/\/Subtype\s*\/Image/.test(dict)) { re.lastIndex = end; continue; }
    const data = decodePdfStream(buf.subarray(start, end), dict, budget);
    if (!data) { re.lastIndex = end; continue; }
    const content = data.toString("latin1");
    if (/\bBT\b/.test(content)) texts.push(readPdfStrings(content));
    re.lastIndex = end;
  }
  return texts.join("\n").replace(/[^\S\n]+/g, " ");
}

function kindFor(name, mime) {
  const n = String(name || "").toLowerCase(), m = String(mime || "").toLowerCase();
  if (/\.docx$/.test(n) || m.includes("wordprocessingml")) return "docx";
  if (/\.pptx$/.test(n) || m.includes("presentationml")) return "pptx";
  if (/\.xlsx$/.test(n) || m.includes("spreadsheetml")) return "xlsx";
  if (/\.(odt|odp|ods)$/.test(n) || m.includes("opendocument")) return "odf";
  if (/\.pdf$/.test(n) || m === "application/pdf") return "pdf";
  if (/\.(mdb|accdb)$/.test(n) || /msaccess|access/.test(m)) return "access";
  if (TEXT_EXT.test(n) || m.startsWith("text/") || /json|xml|javascript|yaml|csv/.test(m)) return "text";
  return "";
}

// Returns { text, status } where status is "ok", "empty" (nothing readable, e.g. scanned PDF),
// "too_large" or "unsupported" (images, audio, video, unknown binaries).
async function extractText(filePath, mime, name) {
  const kind = kindFor(name || path.basename(filePath), mime);
  if (!kind) return { text: "", status: "unsupported" };
  const stat = await fs.promises.stat(filePath);
  if (stat.size > 60 * 1024 * 1024) return { text: "", status: "too_large" };
  const buf = await fs.promises.readFile(filePath);
  let text = "";
  try {
    if (kind === "text") text = decodeTextBuffer(buf);
    else if (kind === "docx") text = await extractDocx(buf);
    else if (kind === "pptx") text = await extractPptx(buf);
    else if (kind === "xlsx") text = await extractXlsx(buf);
    else if (kind === "odf") text = await extractOpenDocument(buf);
    else if (kind === "pdf") text = extractPdf(buf);
    else if (kind === "access") text = await extractAccess(buf);
  } catch (e) {
    if (e && e.code === "ETOOLARGE") return { text: "", status: "too_large" };
    throw e;
  }
  text = cleanText(text);
  return { text, status: text.replace(/[\s\-–—]/g, "").length >= 3 ? "ok" : "empty" };
}

module.exports = { extractText, kindFor, extractPdf, extractDocx, extractPptx, extractXlsx, extractAccess, decodePdfLiteral, decodeTextBuffer, decodeXmlEntities };
