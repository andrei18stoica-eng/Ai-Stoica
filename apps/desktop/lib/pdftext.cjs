// PDF text through the fonts' own character maps (ToUnicode). Word, browsers and AI Stoica itself write PDFs whose text
// is glyph numbers (fonts with ș, ț, ă, emoji…), which cannot be read without the font's map. pdf-lib (already used to
// make PDFs) opens the file; the page content is read here, following the font in use for every piece of text.
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFStream } = require("pdf-lib");

const MAX_CHARS = 3_000_000;

function utf16Hex(hex) {
  const b = Buffer.from(hex.length % 4 ? hex.padEnd(hex.length + (4 - hex.length % 4), "0") : hex, "hex");
  let out = "";
  for (let i = 0; i + 1 < b.length; i += 2) out += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return out.replace(/\u0000/g, "");
}

// ToUnicode CMap: codespace (code length in bytes), bfchar and bfrange.
function parseCMap(text) {
  const map = new Map();
  let bytes = 0;
  const space = text.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/);
  if (space) bytes = space[1].length / 2;
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      if (!bytes) bytes = m[1].length / 2;
      map.set(parseInt(m[1], 16), utf16Hex(m[2]));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (!bytes) bytes = m[1].length / 2;
      if (hi < lo || hi - lo > 65535) continue;
      if (m[3][0] === "[") {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => utf16Hex(x[1]));
        for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, items[c - lo]);
      } else {
        const hex = m[3].slice(1, -1), base = hex.length >= 4 ? utf16Hex(hex) : "";
        if (!base) continue;
        const head = base.slice(0, -1), last = base.charCodeAt(base.length - 1);
        for (let c = lo; c <= hi; c++) map.set(c, head + String.fromCharCode(last + (c - lo)));
      }
    }
  }
  return { map, bytes: bytes || 1 };
}

function lex(src) {
  // Tokens of a content stream: numbers, names, strings (as byte strings), arrays, operators. Inline images are skipped.
  const toks = [];
  let i = 0;
  const n = src.length;
  const ws = (c) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
  const delim = (c) => "()<>[]{}/%".includes(c);
  while (i < n) {
    const c = src[i];
    if (ws(c)) { i++; continue; }
    if (c === "%") { while (i < n && src[i] !== "\n" && src[i] !== "\r") i++; continue; }
    if (c === "(") {
      let depth = 1, out = ""; i++;
      while (i < n && depth) {
        const ch = src[i];
        if (ch === "\\") {
          const e = src[i + 1]; i += 2;
          if (e === "n") out += "\n"; else if (e === "r") out += "\r"; else if (e === "t") out += "\t";
          else if (e === "b") out += "\b"; else if (e === "f") out += "\f";
          else if (e >= "0" && e <= "7") { let o = e; while (o.length < 3 && src[i] >= "0" && src[i] <= "7") o += src[i++]; out += String.fromCharCode(parseInt(o, 8) & 255); }
          else if (e === "\r") { if (src[i] === "\n") i++; }
          else if (e === "\n") {}
          else if (e !== undefined) out += e;
          continue;
        }
        if (ch === "(") depth++;
        else if (ch === ")") { depth--; if (!depth) { i++; break; } }
        out += ch; i++;
      }
      toks.push({ s: out });
      continue;
    }
    if (c === "<" && src[i + 1] === "<") { toks.push({ op: "<<" }); i += 2; continue; }
    if (c === ">" && src[i + 1] === ">") { toks.push({ op: ">>" }); i += 2; continue; }
    if (c === "<") {
      const end = src.indexOf(">", i + 1);
      const hex = src.slice(i + 1, end < 0 ? n : end).replace(/[^0-9a-fA-F]/g, "");
      toks.push({ s: Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex").toString("latin1") });
      i = end < 0 ? n : end + 1; continue;
    }
    if (c === "[" || c === "]" || c === "{" || c === "}") { toks.push({ op: c }); i++; continue; }
    if (c === "/") {
      let j = i + 1; while (j < n && !ws(src[j]) && !delim(src[j])) j++;
      toks.push({ name: src.slice(i + 1, j) }); i = j; continue;
    }
    let j = i; while (j < n && !ws(src[j]) && !delim(src[j])) j++;
    if (j === i) { i++; continue; }
    const word = src.slice(i, j); i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { toks.push({ num: parseFloat(word) }); continue; }
    if (word === "ID") {
      // Inline image data runs until "EI" on its own.
      const m = /\sEI(?=[\s]|$)/g; m.lastIndex = i + 1;
      const hit = m.exec(src);
      i = hit ? hit.index + 3 : n;
      toks.push({ op: "EI" });
      continue;
    }
    toks.push({ op: word });
  }
  return toks;
}

// decodeStream(rawBytes, "/Filter …") must unpack with size limits and return null when it cannot (extract.cjs passes
// the same capped decoder its plain reader uses), so a small "zip bomb" stream cannot exhaust memory here either.
async function extractPdfText(buf, { decodeStream } = {}) {
  if (typeof decodeStream !== "function") throw new Error("decodeStream is required");
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  if (doc.isEncrypted) return "";
  const ctx = doc.context;
  const look = (o) => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const bytesOf = (obj) => {
    const s = look(obj);
    if (!(s instanceof PDFRawStream)) return "";
    try {
      const filter = look(s.dict.get(PDFName.of("Filter")));
      const spec = filter instanceof PDFArray ? `/Filter [${filter.asArray().map((f) => String(look(f))).join(" ")}]` : filter ? `/Filter ${String(filter)}` : "";
      const data = decodeStream(Buffer.from(s.contents.buffer, s.contents.byteOffset, s.contents.byteLength), spec);
      return data ? data.toString("latin1") : "";
    } catch { return ""; }
  };
  const fonts = new Map();
  function fontInfo(fontObj) {
    const font = look(fontObj);
    if (!(font instanceof PDFDict)) return null;
    if (fonts.has(font)) return fonts.get(font);
    const subtype = look(font.get(PDFName.of("Subtype")))?.asString?.() || "";
    const tu = font.get(PDFName.of("ToUnicode"));
    const cmap = tu ? parseCMap(bytesOf(tu)) : null;
    const composite = subtype === "/Type0";
    const info = { map: cmap?.map?.size ? cmap.map : null, bytes: composite ? Math.max(2, cmap?.bytes || 2) : (cmap?.bytes || 1), composite };
    fonts.set(font, info);
    return info;
  }
  const out = [];
  let chars = 0;
  const push = (t) => { if (chars < MAX_CHARS) { out.push(t); chars += t.length; } };

  function decodeString(bytes, font) {
    if (!font) return /^[\x20-\x7e\xa0-\xff\s]*$/.test(bytes) ? bytes : "";
    const step = font.bytes || 1;
    let s = "";
    for (let i = 0; i + step - 1 < bytes.length; i += step) {
      let code = 0;
      for (let k = 0; k < step; k++) code = (code << 8) | bytes.charCodeAt(i + k);
      const mapped = font.map?.get(code);
      if (mapped != null) s += mapped;
      else if (!font.composite && code >= 32) s += String.fromCharCode(code);
    }
    return s;
  }

  // Text position, to put line breaks and spaces where the page has them (glyph widths are estimated from the size).
  // lm is the start of the current line (Td / TD / T* move from it); x, y is where the next text goes.
  let lastY = null, endX = 0, size = 10, leading = 0, lm = [1, 0, 0, 1, 0, 0], x = 0, y = 0;
  function show(text) {
    if (!text) return;
    const fs = Math.abs(size * (Math.hypot(lm[2], lm[3]) || 1)) || 10;
    if (lastY !== null) {
      if (Math.abs(y - lastY) > fs * 0.5) push("\n");
      else if (x - endX > fs * 0.25 && !/\s$/.test(out[out.length - 1] || "") && !/^\s/.test(text)) push(" ");
    }
    push(text);
    lastY = y; endX = x + text.length * fs * 0.5; x = endX;
  }
  function setLine(m) { lm = m; x = m[4]; y = m[5]; }
  function move(tx, ty) { setLine([lm[0], lm[1], lm[2], lm[3], lm[4] + tx * lm[0] + ty * lm[2], lm[5] + tx * lm[1] + ty * lm[3]]); }

  function run(content, resources, depth, seen) {
    const fontDict = look(resources?.get?.(PDFName.of("Font")));
    const xobjects = look(resources?.get?.(PDFName.of("XObject")));
    let font = null, stack = [], inArray = false, array = [];
    for (const t of lex(content)) {
      if (chars >= MAX_CHARS) return;
      if (t.op === "[") { inArray = true; array = []; continue; }
      if (t.op === "]") { inArray = false; stack.push({ arr: array }); continue; }
      if (inArray) { array.push(t); continue; }
      if (!t.op) { stack.push(t); continue; }
      const op = t.op, nums = stack.filter((x) => x.num != null).map((x) => x.num);
      if (op === "Tf") {
        const name = stack.find((x) => x.name)?.name;
        font = name && fontDict instanceof PDFDict ? fontInfo(fontDict.get(PDFName.of(name))) : null;
        if (nums.length) size = nums[nums.length - 1];
      } else if (op === "BT") setLine([1, 0, 0, 1, 0, 0]);
      else if (op === "Tm" && nums.length >= 6) setLine(nums.slice(-6));
      else if (op === "Td" && nums.length >= 2) move(nums[nums.length - 2], nums[nums.length - 1]);
      else if (op === "TD" && nums.length >= 2) { leading = -nums[nums.length - 1]; move(nums[nums.length - 2], nums[nums.length - 1]); }
      else if (op === "TL" && nums.length) leading = nums[nums.length - 1];
      else if (op === "T*") move(0, -leading || -size);
      else if (op === "Tj" || op === "'" || op === "\"") {
        if (op !== "Tj") move(0, -leading || -size);
        const str = [...stack].reverse().find((x) => x.s != null);
        if (str) show(decodeString(str.s, font));
      } else if (op === "TJ") {
        let line = "";
        for (const item of stack.find((x) => x.arr)?.arr || []) {
          if (item.s != null) line += decodeString(item.s, font);
          else if (item.num != null && item.num < -250 && !/\s$/.test(line)) line += " ";
        }
        show(line);
      } else if (op === "Do" && depth < 4 && xobjects instanceof PDFDict) {
        const name = stack.find((x) => x.name)?.name;
        const xo = look(name && xobjects.get(PDFName.of(name)));
        if (xo instanceof PDFStream && look(xo.dict.get(PDFName.of("Subtype")))?.asString?.() === "/Form" && !seen.has(xo)) {
          seen.add(xo);
          run(bytesOf(xo), look(xo.dict.get(PDFName.of("Resources"))) || resources, depth + 1, seen);
        }
      }
      stack = [];
    }
  }

  for (const page of doc.getPages()) {
    const node = page.node;
    const resources = look(node.Resources?.()) || look(node.getInheritableAttribute?.(PDFName.of("Resources")));
    const contents = look(node.get(PDFName.of("Contents")));
    const parts = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    lastY = null;
    run(parts.map(bytesOf).join("\n"), resources, 0, new Set());
    push("\n\n");
    if (chars >= MAX_CHARS) break;
  }
  return out.join("").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
}

module.exports = { extractPdfText, parseCMap };
