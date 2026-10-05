// Math for Word: LaTeX written by the AI ($…$, $$…$$, \(…\), \[…\], \begin{equation}…) becomes a real Word equation
// (Office Math / OMML, the format of Insert → Equation), so it looks right and stays editable in Word.
// LaTeX → MathML is done by temml (MIT); MathML → OMML is done here.
const temml = require("temml");

const MAX_TEX = 4000;

// Characters XML does not allow (temml can produce them from \char) would make Word refuse the whole file.
function esc(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
function unescapeXml(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ""; } }
    return ENTITIES[e] ?? m;
  });
}

// temml's output is small, well-formed XML: elements, attributes and text.
function parseXml(xml) {
  const root = { tag: "#root", attrs: {}, children: [] }, stack = [root];
  const re = /<(\/?)([\w:-]+)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[5] != null) { top.children.push({ text: unescapeXml(m[5]) }); continue; }
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    for (const a of m[3].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = unescapeXml(a[2]);
    const node = { tag: m[2], attrs, children: [] };
    top.children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}

const elements = (n) => (n.children || []).filter((c) => c.tag);
const textOf = (n) => n.text != null ? n.text : (n.children || []).map(textOf).join("");

const NARY = new Set([..."∑∏∐∫∬∭∮∯∰∱∲∳⋀⋁⋂⋃⨀⨁⨂⨄⨆⨌"]);
const RELATION = new Set([..."=<>≤≥≠≈≡∼≃≅∝→←↔⇒⇐⇔↦∈∉⊂⊃⊆⊇≪≫≺≻⊥∣∥"]);
// Accents above (\hat, \bar, \vec, \dot…) as Word's combining characters.
const ACCENTS = { "^": "̂", "ˆ": "̂", "̂": "̂", "~": "̃", "˜": "̃", "̃": "̃", "¯": "̅", "‾": "̅", "ˉ": "̅", "̄": "̄", "→": "⃗", "⃗": "⃗", "←": "⃖", "˙": "̇", "̇": "̇", "¨": "̈", "̈": "̈", "ˇ": "̌", "̌": "̌", "´": "́", "ˊ": "́", "`": "̀", "ˋ": "̀", "˘": "̆", "̆": "̆", "˚": "̊", "∘": "̊", "⃛": "⃛" };
const BRACES_TOP = new Set([..."⏞⏜⎴"]), BRACES_BOTTOM = new Set([..."⏟⏝⎵"]);
const INVISIBLE = /[⁡-⁤​]/g;

function run(text, { sty, nor } = {}, ctx) {
  const t = String(text).replace(INVISIBLE, "");
  if (!t) return "";
  const mPr = nor ? "<m:rPr><m:nor/></m:rPr>" : sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : "";
  const wPr = `<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>${ctx.size ? `<w:sz w:val="${ctx.size}"/><w:szCs w:val="${ctx.size}"/>` : ""}</w:rPr>`;
  return `<m:r>${mPr}${wPr}<m:t${/^\s|\s$/.test(t) ? ' xml:space="preserve"' : ""}>${esc(t)}</m:t></m:r>`;
}

function variantStyle(node, text) {
  const v = node.attrs.mathvariant;
  if (v === "bold") return "b";
  if (v === "bold-italic") return "bi";
  if (v === "normal") return "p";
  if (v === "italic") return "i";
  return [...text].length > 1 ? "p" : "";
}

// The operator of a ∑ / ∫ / ∏ (alone or with limits), or null.
function naryParts(n) {
  if (n.tag === "mo" && NARY.has(textOf(n).trim())) return { chr: textOf(n).trim(), sub: null, sup: null, under: false };
  const kids = elements(n);
  if (!["msub", "msup", "msubsup", "munder", "mover", "munderover"].includes(n.tag) || !kids[0]) return null;
  const base = kids[0].tag === "mrow" && elements(kids[0]).length === 1 ? elements(kids[0])[0] : kids[0];
  if (base.tag !== "mo" || !NARY.has(textOf(base).trim())) return null;
  const under = n.tag.startsWith("mu") || n.tag === "mover";
  const sub = n.tag === "msup" || n.tag === "mover" ? null : kids[1];
  const sup = n.tag === "msub" || n.tag === "munder" ? null : n.tag === "msup" || n.tag === "mover" ? kids[1] : kids[2];
  return { chr: textOf(base).trim(), sub, sup, under };
}

function isRelation(n) { return n.tag === "mo" && RELATION.has(textOf(n).trim()); }

const isApply = (n) => n?.tag === "mo" && textOf(n).trim() === "\u2061";
// A function name (\sin, \log, \lim, \operatorname…) as temml writes it: the name followed by U+2061, either
// next to it or inside the same <mrow>. Returns the name nodes and how many siblings they use, or null.
function funcHead(nodes, i) {
  const n = nodes[i];
  if (n.tag === "mrow") {
    const k = elements(n), at = k.findIndex(isApply);
    if (at > 0 && k.slice(at + 1).every((x) => x.tag === "mspace")) return { name: k.slice(0, at), used: 1 };
  }
  if (isApply(nodes[i + 1])) return { name: [n], used: 2 };
  return null;
}

function seq(nodes, ctx) {
  let out = "";
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const fn = funcHead(nodes, i);
    if (fn) {
      // Word's own form for sin x, log x, lim f(x): <m:func> with the name and its argument.
      let j = i + fn.used;
      while (nodes[j]?.tag === "mspace") j++;
      const arg = nodes[j];
      if (arg && !isRelation(arg) && !(arg.tag === "mo" && !fence(arg))) {
        out += `<m:func><m:fName>${seq(fn.name, ctx)}</m:fName><m:e>${conv(arg, ctx)}</m:e></m:func>`;
        i = j;
        continue;
      }
      out += seq(fn.name, ctx);
      i += fn.used - 1;
      continue;
    }
    // temml wraps ∑ with limits in its own <mrow>; the operand is still what follows it.
    const nary = naryParts(n.tag === "mrow" && elements(n).length === 1 ? elements(n)[0] : n);
    if (nary) {
      // The operand of ∑/∫ is what follows it, up to the next relation (=, <, →…).
      let j = i + 1; const body = [];
      while (j < nodes.length && !isRelation(nodes[j])) body.push(nodes[j++]);
      const isInt = /[∫∬∭∮∯∰∱∲∳⨌]/.test(nary.chr);
      const pr = `<m:naryPr><m:chr m:val="${esc(nary.chr)}"/><m:limLoc m:val="${nary.under && !isInt ? "undOvr" : "subSup"}"/>${nary.sub ? "" : '<m:subHide m:val="1"/>'}${nary.sup ? "" : '<m:supHide m:val="1"/>'}</m:naryPr>`;
      out += `<m:nary>${pr}<m:sub>${nary.sub ? conv(nary.sub, ctx) : ""}</m:sub><m:sup>${nary.sup ? conv(nary.sup, ctx) : ""}</m:sup><m:e>${seq(body, ctx)}</m:e></m:nary>`;
      i = j - 1;
      continue;
    }
    out += conv(n, ctx);
  }
  return out;
}

function fence(n) { return n?.tag === "mo" && n.attrs.fence === "true"; }

function table(n, ctx) {
  const rows = elements(n).filter((r) => r.tag === "mtr" || r.tag === "mlabeledtr").map((r) => {
    const cells = elements(r).filter((c) => c.tag === "mtd");
    return r.tag === "mlabeledtr" ? cells.slice(1) : cells;
  });
  const width = Math.max(1, ...rows.map((r) => r.length));
  const cells = rows.map((r) => Array.from({ length: width }, (_, c) => (r[c] ? seq(elements(r[c]), ctx) : "")));
  // Columns that are empty in every row (temml's room for equation numbers) are left out.
  const keep = Array.from({ length: width }, (_, c) => c).filter((c) => cells.some((r) => r[c]));
  if (!keep.length) return "";
  if (keep.length === 1 && cells.length === 1) return cells[0][keep[0]];
  const jc = keep.map((c) => {
    const cls = String(rows[0]?.[c]?.attrs?.class || "") + " " + String(rows[0]?.[c]?.attrs?.columnalign || "");
    return /left/.test(cls) ? "left" : /right/.test(cls) ? "right" : "center";
  });
  // aligned / align / gather (one column, or right-left pairs) → Word's equation array, aligned at the "=" signs.
  // (temml marks these environments with displaystyle; matrices, arrays and cases have none).
  const aligned = n.attrs.displaystyle === "true" && (keep.length === 1 || (keep.length % 2 === 0 && jc.every((j, k) => j === (k % 2 ? "left" : "right"))));
  if (aligned) {
    const mark = (cell) => cell.startsWith("<m:r><m:rPr>") ? cell.replace("</m:rPr>", "<m:aln/></m:rPr>") : cell.startsWith("<m:r>") ? "<m:r><m:rPr><m:aln/></m:rPr>" + cell.slice(5) : cell;
    const lines = cells.map((r) => keep.map((c, k) => (k % 2 === 1 ? mark(r[c]) : r[c])).join(""));
    return `<m:eqArr>${lines.map((l) => `<m:e>${l}</m:e>`).join("")}</m:eqArr>`;
  }
  const mcs = jc.map((j) => `<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="${j}"/></m:mcPr></m:mc>`).join("");
  const body = cells.map((r) => `<m:mr>${keep.map((c) => `<m:e>${r[c]}</m:e>`).join("")}</m:mr>`).join("");
  return `<m:m><m:mPr><m:mcs>${mcs}</m:mcs></m:mPr>${body}</m:m>`;
}

function conv(n, ctx) {
  if (!n || n.text != null) return "";
  const kids = elements(n), c = (i) => (kids[i] ? conv(kids[i], ctx) : "");
  switch (n.tag) {
    case "#root": case "math": case "mstyle": case "mpadded": case "mrow": case "merror": {
      if (n.tag === "mrow" && kids.length >= 2 && fence(kids[0]) && fence(kids[kids.length - 1])) {
        const beg = textOf(kids[0]).trim(), end = textOf(kids[kids.length - 1]).trim();
        return `<m:d><m:dPr><m:begChr m:val="${esc(beg)}"/><m:endChr m:val="${esc(end)}"/></m:dPr><m:e>${seq(kids.slice(1, -1), ctx)}</m:e></m:d>`;
      }
      // \boxed{…}
      if (/border\s*:/.test(String(n.attrs.style || ""))) return `<m:borderBox><m:e>${seq(kids, ctx)}</m:e></m:borderBox>`;
      return seq(kids, ctx);
    }
    case "semantics": return c(0);
    case "annotation": case "annotation-xml": case "none": case "mprescripts": return "";
    case "mphantom": return `<m:phant><m:phantPr><m:show m:val="0"/></m:phantPr><m:e>${seq(kids, ctx)}</m:e></m:phant>`;
    case "mi": { const t = textOf(n); return run(t, { sty: variantStyle(n, t) }, ctx); }
    case "mn": return run(textOf(n), { sty: n.attrs.mathvariant === "bold" ? "b" : "" }, ctx);
    case "mo": return run(textOf(n), {}, ctx);
    case "mtext": return run(textOf(n), { nor: true }, ctx);
    case "ms": return run(`"${textOf(n)}"`, { nor: true }, ctx);
    case "mspace": {
      const w = String(n.attrs.width || ""), num = parseFloat(w) || 0, em = /pt$/.test(w) ? num / 10 : /mu$/.test(w) ? num / 18 : num;
      if (em <= 0.05) return "";
      return run(em >= 0.9 ? " " : em >= 0.25 ? " " : " ", {}, ctx);
    }
    case "msup": return `<m:sSup><m:e>${c(0)}</m:e><m:sup>${c(1)}</m:sup></m:sSup>`;
    case "msub": return `<m:sSub><m:e>${c(0)}</m:e><m:sub>${c(1)}</m:sub></m:sSub>`;
    case "msubsup": return `<m:sSubSup><m:e>${c(0)}</m:e><m:sub>${c(1)}</m:sub><m:sup>${c(2)}</m:sup></m:sSubSup>`;
    case "mmultiscripts": return `<m:sSubSup><m:e>${c(0)}</m:e><m:sub>${c(1)}</m:sub><m:sup>${c(2)}</m:sup></m:sSubSup>`;
    case "mfrac": {
      const noBar = /^0(\.0*)?(px|pt|em)?$/.test(String(n.attrs.linethickness || "").trim());
      return `<m:f>${noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ""}<m:num>${c(0)}</m:num><m:den>${c(1)}</m:den></m:f>`;
    }
    case "msqrt": return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${seq(kids, ctx)}</m:e></m:rad>`;
    case "mroot": return `<m:rad><m:deg>${c(1)}</m:deg><m:e>${c(0)}</m:e></m:rad>`;
    case "mover": case "munder": case "munderover": {
      const nary = naryParts(n);
      if (nary) return seq([n], ctx);
      const base = c(0);
      const mark = (k) => (k && k.tag === "mo" ? textOf(k).trim() : "");
      if (n.tag === "mover") {
        const ch = mark(kids[1]);
        if (BRACES_TOP.has(ch)) return `<m:groupChr><m:groupChrPr><m:chr m:val="${esc(ch)}"/><m:pos m:val="top"/><m:vertJc m:val="bot"/></m:groupChrPr><m:e>${base}</m:e></m:groupChr>`;
        if ((ch === "‾" || ch === "¯" || ch === "_") && n.attrs.accent !== "true" && kids[1]?.attrs?.stretchy === "true") return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${base}</m:e></m:bar>`;
        if (ACCENTS[ch] && (n.attrs.accent === "true" || kids[1]?.attrs?.stretchy !== "true" || /acc|vec/.test(kids[1]?.attrs?.class || ""))) return `<m:acc><m:accPr><m:chr m:val="${esc(ACCENTS[ch])}"/></m:accPr><m:e>${base}</m:e></m:acc>`;
        return `<m:limUpp><m:e>${base}</m:e><m:lim>${c(1)}</m:lim></m:limUpp>`;
      }
      if (n.tag === "munder") {
        const ch = mark(kids[1]);
        if (BRACES_BOTTOM.has(ch)) return `<m:groupChr><m:groupChrPr><m:chr m:val="${esc(ch)}"/><m:pos m:val="bot"/><m:vertJc m:val="top"/></m:groupChrPr><m:e>${base}</m:e></m:groupChr>`;
        if ((ch === "_" || ch === "‾" || ch === "¯") && kids[1]?.attrs?.stretchy === "true") return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>${base}</m:e></m:bar>`;
        return `<m:limLow><m:e>${base}</m:e><m:lim>${c(1)}</m:lim></m:limLow>`;
      }
      return `<m:limUpp><m:e><m:limLow><m:e>${base}</m:e><m:lim>${c(1)}</m:lim></m:limLow></m:e><m:lim>${c(2)}</m:lim></m:limUpp>`;
    }
    case "menclose": {
      const note = String(n.attrs.notation || "");
      const inner = seq(kids, ctx);
      if (/\bbox\b|roundedbox|circle/.test(note)) return `<m:borderBox><m:e>${inner}</m:e></m:borderBox>`;
      if (/\btop\b/.test(note)) return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${inner}</m:e></m:bar>`;
      if (/\bbottom\b/.test(note)) return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>${inner}</m:e></m:bar>`;
      if (/strike/.test(note)) return `<m:borderBox><m:borderBoxPr><m:hideTop m:val="1"/><m:hideBot m:val="1"/><m:hideLeft m:val="1"/><m:hideRight m:val="1"/>${/updiagonal/.test(note) ? '<m:strikeBLTR m:val="1"/>' : ""}${/downdiagonal/.test(note) ? '<m:strikeTLBR m:val="1"/>' : ""}${/horizontal/.test(note) ? '<m:strikeH m:val="1"/>' : ""}</m:borderBoxPr><m:e>${inner}</m:e></m:borderBox>`;
      return inner;
    }
    case "mtable": return table(n, ctx);
    case "mtr": case "mlabeledtr": case "mtd": return seq(kids, ctx);
    default: return seq(kids, ctx);
  }
}

// LaTeX → the inside of <m:oMath>, or null when it is not valid LaTeX (the text then stays as written).
function latexToOmml(tex, { display = false, size = 0 } = {}) {
  const src = String(tex || "").trim();
  if (!src || src.length > MAX_TEX) return null;
  let mathml;
  try { mathml = temml.renderToString(src, { displayMode: display, xml: true, throwOnError: true, trust: false, maxExpand: 500 }); }
  catch { return null; }
  if (/<merror/.test(mathml)) return null;
  const omml = conv(parseXml(mathml), { size });
  return omml || null;
}
function ommlInline(inner) { return `<m:oMath>${inner}</m:oMath>`; }
function ommlDisplay(inner) { return `<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr><m:oMath>${inner}</m:oMath></m:oMathPara>`; }

// Splits a line into text and math: \(…\), \[…\], $$…$$ and $…$ (a $ followed by a non-space and closed by a $ after
// a non-space that is not followed by a digit, so "5$ sau 10$" and "$5 și $10" stay money). Code spans stay text.
function splitInlineMath(text) {
  const s = String(text || ""), out = [];
  let buf = "", i = 0;
  const flush = () => { if (buf) out.push({ text: buf }); buf = ""; };
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "$") { buf += "\\$"; i += 2; continue; }
    if (ch === "`") {
      const ticks = s.slice(i).match(/^`+/)[0], end = s.indexOf(ticks, i + ticks.length);
      if (end > 0) { buf += s.slice(i, end + ticks.length); i = end + ticks.length; continue; }
      buf += ticks; i += ticks.length; continue;
    }
    if (ch === "\\" && (s[i + 1] === "(" || s[i + 1] === "[")) {
      const close = s[i + 1] === "(" ? "\\)" : "\\]", end = s.indexOf(close, i + 2);
      if (end > i + 2) { flush(); out.push({ math: s.slice(i + 2, end), display: s[i + 1] === "[", raw: s.slice(i, end + 2) }); i = end + 2; continue; }
    }
    if (ch === "$" && s[i + 1] === "$") {
      const end = s.indexOf("$$", i + 2);
      if (end > i + 2) { flush(); out.push({ math: s.slice(i + 2, end), display: true, raw: s.slice(i, end + 2) }); i = end + 2; continue; }
    }
    // A digit before the opening $ (5$, 10$/lună) or a letter or digit right after the closing one ($HOME/$USER)
    // means money or a variable, not a formula.
    if (ch === "$" && s[i + 1] && !/\s|\$/.test(s[i + 1]) && !/\d/.test(s[i - 1] || "")) {
      let j = i + 1, end = -1;
      while (j < s.length) {
        if (s[j] === "\\") { j += 2; continue; }
        if (s[j] === "$") { if (!/\s/.test(s[j - 1]) && !/[\p{L}\p{N}]/u.test(s[j + 1] || "")) end = j; break; }
        j++;
      }
      if (end > i + 1) { flush(); out.push({ math: s.slice(i + 1, end), display: false, raw: s.slice(i, end + 1) }); i = end + 1; continue; }
    }
    buf += ch; i++;
  }
  flush();
  return out;
}
const hasMath = (text) => /\$|\\\(|\\\[|\\begin\{/.test(String(text || ""));

// A whole-paragraph equation block that starts on this line: $$…$$, \[…\] or \begin{equation|align|gather|multline}.
// Returns { tex, end } (the index of its last line) or null.
function mathBlockAt(lines, i) {
  const first = String(lines[i] || "").trim();
  const delimited = (open, close) => {
    if (!first.startsWith(open)) return null;
    const rest = first.slice(open.length), at = rest.indexOf(close);
    if (at >= 0) return at > 0 && !rest.slice(at + close.length).trim() && rest.slice(0, at).trim() ? { tex: rest.slice(0, at), end: i } : null;
    const parts = [rest];
    for (let j = i + 1; j < lines.length && j < i + 200; j++) {
      const l = String(lines[j]).trim();
      if (!l) return null;
      const k = l.indexOf(close);
      if (k >= 0) { if (l.slice(k + close.length).trim()) return null; parts.push(l.slice(0, k)); const tex = parts.join("\n"); return tex.trim() ? { tex, end: j } : null; }
      parts.push(l);
    }
    return null;
  };
  const block = delimited("$$", "$$") || delimited("\\[", "\\]");
  if (block) return block;
  const m = first.match(/^\\begin\{(equation|align|gather|multline)(\*?)\}/);
  if (m) {
    const close = `\\end{${m[1]}${m[2]}}`;
    for (let j = i; j < lines.length && j < i + 200; j++) if (String(lines[j]).includes(close)) {
      const tex = lines.slice(i, j + 1).join("\n").trim();
      return tex.endsWith(close) ? { tex, end: j } : null;
    }
  }
  return null;
}

module.exports = { latexToOmml, ommlInline, ommlDisplay, splitInlineMath, mathBlockAt, hasMath, parseXml };
