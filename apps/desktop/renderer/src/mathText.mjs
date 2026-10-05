// Formulas in chat: LaTeX ($…$, $$…$$, \(…\), \[…\], ```math) is shown as a formula (MathML, drawn by the browser).
// The same rules as in the Word export (lib/math.cjs): "5$ sau 10$" and "$5 și $10" stay money, code stays code.
// Before Markdown runs, inline formulas become code spans marked with MARK and equation blocks become ```math blocks,
// so Markdown never touches the "_" and "*" inside them; the code renderers below draw them.
export const MARK = "\ue000";

function splitInline(s) {
  const out = [];
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
      if (end > i + 2) { flush(); out.push({ math: s.slice(i + 2, end), display: s[i + 1] === "[" }); i = end + 2; continue; }
    }
    if (ch === "$" && s[i + 1] === "$") {
      const end = s.indexOf("$$", i + 2);
      if (end > i + 2) { flush(); out.push({ math: s.slice(i + 2, end), display: true }); i = end + 2; continue; }
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
      if (end > i + 1) { flush(); out.push({ math: s.slice(i + 1, end), display: false }); i = end + 1; continue; }
    }
    buf += ch; i++;
  }
  flush();
  return out;
}

function codeSpan(content) {
  const longest = Math.max(0, ...(content.match(/`+/g) || []).map((t) => t.length));
  const fence = "`".repeat(longest + 1), pad = longest ? " " : "";
  return fence + pad + content + pad + fence;
}

function blockAt(lines, i) {
  const first = lines[i].trim();
  for (const [open, close] of [["$$", "$$"], ["\\[", "\\]"]]) {
    if (!first.startsWith(open)) continue;
    const rest = first.slice(open.length), at = rest.indexOf(close);
    if (at >= 0) return at > 0 && !rest.slice(at + close.length).trim() && rest.slice(0, at).trim() ? { tex: rest.slice(0, at), end: i } : null;
    const parts = [rest];
    for (let j = i + 1; j < lines.length && j < i + 200; j++) {
      const l = lines[j].trim();
      if (!l) return null;
      const k = l.indexOf(close);
      if (k >= 0) { if (l.slice(k + close.length).trim()) return null; parts.push(l.slice(0, k)); const tex = parts.join("\n"); return tex.trim() ? { tex, end: j } : null; }
      parts.push(l);
    }
    return null;
  }
  const m = first.match(/^\\begin\{(equation|align|gather|multline)(\*?)\}/);
  if (m) {
    const close = `\\end{${m[1]}${m[2]}}`;
    for (let j = i; j < lines.length && j < i + 200; j++) if (lines[j].includes(close)) {
      const tex = lines.slice(i, j + 1).join("\n").trim();
      return tex.endsWith(close) ? { tex, end: j } : null;
    }
  }
  return null;
}

export function prepareMath(text) {
  const src = String(text || "");
  if (!/\$|\\\(|\\\[|\\begin\{/.test(src)) return src;
  const lines = src.split("\n"), out = [];
  let fence = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], f = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) { out.push(line); if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim()) fence = ""; continue; }
    if (f) { fence = f[1]; out.push(line); continue; }
    const block = blockAt(lines, i);
    if (block) {
      const indent = line.match(/^\s*/)[0];
      out.push(indent + "```math", ...block.tex.trim().split("\n").map((l) => indent + l), indent + "```");
      i = block.end;
      continue;
    }
    out.push(splitInline(line).map((p) => (p.text != null ? p.text : codeSpan(MARK + (p.display ? "D" : "I") + p.math))).join(""));
  }
  return out.join("\n");
}
