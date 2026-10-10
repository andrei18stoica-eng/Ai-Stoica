// Math for PDF: LaTeX written by the AI ($…$, $$…$$, \(…\), \[…\]) is typeset the way Word's equation editor shows it
// (fractions on two levels, powers and indices, radicals, ∑ and ∫ with limits, matrices, stretched brackets) instead
// of the raw LaTeX. LaTeX → MathML by temml (as for Word), MathML → boxes laid out and drawn with pdf-lib here.
const temml = require("temml");
const { parseXml } = require("./math.cjs");
const { pushGraphicsState, popGraphicsState, concatTransformationMatrix, degrees } = require("pdf-lib");

const MAX_TEX = 4000;
const NARY = new Set([..."∑∏∐∫∬∭∮∯∰∱∲∳⋀⋁⋂⋃⨀⨁⨂⨄⨆⨌"]);
const INTEGRAL = /[∫∬∭∮∯∰∱∲∳⨌]/;
const RELATION = new Set([..."=<>≤≥≠≈≡∼≃≅∝→←↔⇒⇐⇔↦∈∉∋⊂⊃⊆⊇≪≫≺≻⊥∣∥:≔"]);
const BINARY = new Set([..."+−-×÷±∓·∙∘∗⋅∩∪∧∨⊕⊗⊖⊙∖"]);
const PUNCT = new Set([...",;"]);
const INVISIBLE = /[⁡-⁤​]/g;

const elements = (n) => (n.children || []).filter((c) => c.tag);
const textOf = (n) => (n.text != null ? n.text : (n.children || []).map(textOf).join(""));
const emOf = (value, size) => {
  const v = String(value || "").trim(), num = parseFloat(v);
  if (!Number.isFinite(num)) return 0;
  if (/pt$/.test(v)) return num;
  if (/mu$/.test(v)) return (num / 18) * size;
  if (/ex$/.test(v)) return num * 0.45 * size;
  if (/px$/.test(v)) return num * 0.75;
  return num * size;
};

// One horizontal box: width, height above the baseline (a), depth below it (d) and how to draw it at (x, baseline y).
const box = (w, a, d, draw) => ({ w: Math.max(0, w), a, d, draw });
const empty = () => box(0, 0, 0, () => {});

function hrow(items) {
  const w = items.reduce((s, b) => s + b.w, 0);
  const a = Math.max(0, ...items.map((b) => b.a)), d = Math.max(0, ...items.map((b) => b.d));
  return box(w, a, d, (p, x, y, c) => { let cx = x; for (const b of items) { b.draw(p, cx, y, c); cx += b.w; } });
}
const space = (w) => box(w, 0, 0, () => {});
const shift = (b, dy) => box(b.w, b.a + dy, b.d - dy, (p, x, y, c) => b.draw(p, x, y + dy, c));
const center = (b, w) => box(w, b.a, b.d, (p, x, y, c) => b.draw(p, x + (w - b.w) / 2, y, c));
function line(page, x1, y1, x2, y2, t, color) { page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color }); }

function layoutEngine(fonts) {
  // The font that can draw a character: the math serif first, then the symbol fallbacks.
  const pick = (ch, italic, bold) => {
    const order = [bold ? fonts.bold : italic ? fonts.italic : fonts.regular, fonts.regular, ...fonts.fallback].filter(Boolean);
    return order.find((f) => f.set.has(ch.codePointAt(0))) || null;
  };
  const widthOf = (f, t, size) => { try { return f.font.widthOfTextAtSize(t, size); } catch { return t.length * size * 0.5; } };

  // Text drawn with the right font for every character; italic is the real italic face (or a slant without one).
  function text(str, size, { italic = false, bold = false } = {}) {
    const runs = [];
    for (const ch of String(str).replace(INVISIBLE, "")) {
      const f = pick(ch, italic, bold);
      if (!f) continue;
      const last = runs[runs.length - 1];
      if (last && last.f === f) last.t += ch; else runs.push({ f, t: ch });
    }
    if (!runs.length) return empty();
    const slant = italic && !fonts.italicReal;
    let w = 0;
    for (const r of runs) { r.w = widthOf(r.f, r.t, size); w += r.w; }
    const tall = /[A-Z0-9bdfhklt(){}[\]|/∑∏∫√∀∃]/.test(str);
    const deep = /[gjpqy(){}[\]|,;∫∑∏]/.test(str);
    return box(w + (italic ? size * 0.04 : 0), size * (tall ? 0.72 : 0.5), size * (deep ? 0.22 : 0.02), (page, x, y, color) => {
      let cx = x;
      for (const r of runs) {
        page.drawText(r.t, { x: cx, y, size, font: r.f.font, color, ...(slant ? { ySkew: degrees(12) } : {}) });
        cx += r.w;
      }
    });
  }

  // A bracket made as tall as the content next to it: the glyph stretched vertically, centred on the math axis.
  function stretched(ch, size, a, d) {
    const g = text(ch, size);
    if (!g.w) return g;
    const want = a + d, base = size * 0.95, k = Math.max(1, want / base);
    if (k <= 1.05) return g;
    const wide = 1 + (k - 1) * 0.12;
    const f = pick(ch, false, false);
    const w = widthOf(f, ch, size) * wide;
    const top = size * 0.76, bottom = -size * 0.2; // the glyph's extent at scale 1
    const mid = (a - d) / 2, yb = mid - ((top + bottom) / 2) * k;
    return box(w, yb + top * k, -(yb + bottom * k), (page, x, y, color) => {
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(wide, 0, 0, k, x, y + yb));
      page.drawText(ch, { x: 0, y: 0, size, font: f.font, color });
      page.pushOperators(popGraphicsState());
    });
  }

  const opSpace = (kind, size) => (kind === "rel" ? size * 0.28 : kind === "bin" ? size * 0.22 : 0);

  function row(nodes, ctx) {
    const items = [];
    let prev = null; // kind of the previous item: "ord", "bin", "rel", "open", "punct", "op"
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.tag === "mo") {
        const t = textOf(n).replace(INVISIBLE, "").trim();
        if (!t) { if (/⁡/.test(textOf(n))) items.push(space(ctx.size * 0.12)); continue; }
        let kind = RELATION.has(t) ? "rel" : BINARY.has(t) ? "bin" : PUNCT.has(t) ? "punct" : n.attrs.fence === "true" || /^[([{⟨|‖)\]}⟩]$/.test(t) ? (/^[([{⟨]$/.test(t) || n.attrs.form === "prefix" ? "open" : "close") : NARY.has(t) ? "op" : "ord";
        if (kind === "bin" && (!prev || ["bin", "rel", "open", "punct", "op"].includes(prev))) kind = "ord"; // a sign, not an operation
        if (ctx.script) { items.push(atom(n, ctx)); prev = kind; continue; }
        const g = atom(n, ctx);
        const sp = opSpace(kind, ctx.size);
        items.push(space(sp), g, space(kind === "punct" ? ctx.size * 0.17 : sp));
        prev = kind;
        continue;
      }
      items.push(atom(n, ctx));
      prev = "ord";
    }
    // Brackets marked as stretchy (\left( … \right)) grow to the height of what they enclose.
    const inner = items.filter((b) => !b.fence);
    const a = Math.max(ctx.size * 0.72, ...inner.map((b) => b.a)), d = Math.max(ctx.size * 0.22, ...inner.map((b) => b.d));
    return hrow(items.map((b) => (b.fence ? stretched(b.fence, ctx.size, a, d) : b)));
  }

  const smaller = (ctx) => ({ ...ctx, size: ctx.size * (ctx.script ? 0.82 : 0.7), script: true, display: false });

  function scripts(base, sub, sup, ctx) {
    const s = ctx.size, b = base;
    const bb = atom(b, ctx);
    const sc = smaller(ctx);
    const pb = sup ? atom(sup, sc) : null, qb = sub ? atom(sub, sc) : null;
    const up = pb ? Math.max(s * 0.38, bb.a - pb.a * 0.45) : 0;
    let down = qb ? Math.max(s * 0.2, bb.d + qb.a * 0.3 - s * 0.05) : 0;
    if (pb && qb && up - pb.d - (qb.a - down) < s * 0.12) down = qb.a + pb.d - up + s * 0.12;
    const kern = b.tag === "mi" ? s * 0.03 : s * 0.02;
    const w = Math.max(pb ? pb.w : 0, qb ? qb.w : 0) + kern;
    const a = Math.max(bb.a, pb ? up + pb.a : 0), d = Math.max(bb.d, qb ? down + qb.d : 0);
    return box(bb.w + w + s * 0.03, a, d, (p, x, y, c) => {
      bb.draw(p, x, y, c);
      if (pb) pb.draw(p, x + bb.w + kern, y + up, c);
      if (qb) qb.draw(p, x + bb.w + kern * 0.3, y - down, c);
    });
  }

  function stack(baseBox, over, under, ctx, gap) {
    const w = Math.max(baseBox.w, over ? over.w : 0, under ? under.w : 0);
    const upY = over ? baseBox.a + gap + over.d : 0, downY = under ? baseBox.d + gap + under.a : 0;
    return box(w, over ? upY + over.a : baseBox.a, under ? downY + under.d : baseBox.d, (p, x, y, c) => {
      baseBox.draw(p, x + (w - baseBox.w) / 2, y, c);
      if (over) over.draw(p, x + (w - over.w) / 2, y + upY, c);
      if (under) under.draw(p, x + (w - under.w) / 2, y - downY, c);
    });
  }

  // ∑, ∏, ∫ drawn larger in a displayed equation, centred on the math axis.
  function bigOp(ch, ctx) {
    const s = ctx.size, isInt = INTEGRAL.test(ch);
    const k = ctx.display ? (isInt ? 2.2 : 1.8) : (isInt ? 1.4 : 1.2);
    const g = text(ch, s * k);
    const axis = s * 0.27, mid = (g.a - g.d) / 2;
    return shift(g, axis - mid);
  }

  function naryParts(n) {
    const kids = elements(n);
    if (!kids[0]) return null;
    const base = kids[0].tag === "mrow" && elements(kids[0]).length === 1 ? elements(kids[0])[0] : kids[0];
    if (base.tag !== "mo" || !NARY.has(textOf(base).trim())) return null;
    return { chr: textOf(base).trim(), sub: n.tag === "msup" || n.tag === "mover" ? null : kids[1], sup: n.tag === "msub" || n.tag === "munder" ? null : n.tag === "msup" || n.tag === "mover" ? kids[1] : kids[2] };
  }

  function nary(parts, ctx, limitsAround) {
    const g = bigOp(parts.chr, ctx), sc = smaller(ctx), s = ctx.size;
    const sub = parts.sub ? atom(parts.sub, sc) : null, sup = parts.sup ? atom(parts.sup, sc) : null;
    if (limitsAround && !INTEGRAL.test(parts.chr)) return hrow([stack(g, sup, sub, ctx, s * 0.12), space(s * 0.1)]);
    const w = Math.max(sub ? sub.w : 0, sup ? sup.w : 0);
    const upY = sup ? g.a - sup.a * 0.7 : 0, downY = sub ? g.d - sub.d * 0.2 : 0;
    const slant = INTEGRAL.test(parts.chr) ? s * 0.18 : 0;
    return box(g.w + w + s * 0.16, Math.max(g.a, sup ? upY + sup.a : 0), Math.max(g.d, sub ? downY + sub.d : 0), (p, x, y, c) => {
      g.draw(p, x, y, c);
      if (sup) sup.draw(p, x + g.w + s * 0.02, y + upY, c);
      if (sub) sub.draw(p, x + g.w - slant, y - downY, c);
    });
  }

  function fraction(n, ctx) {
    const [num, den] = elements(n), s = ctx.size;
    const inner = ctx.display ? { ...ctx, display: false } : smaller(ctx);
    const nb = atom(num, inner), db = atom(den, inner);
    const noBar = /^0(\.0*)?(px|pt|em)?$/.test(String(n.attrs.linethickness || "").trim());
    const t = Math.max(0.5, s * 0.05), axis = s * 0.27, gap = s * (ctx.display ? 0.16 : 0.1);
    const w = Math.max(nb.w, db.w) + s * 0.24;
    const up = axis + t / 2 + gap + nb.d, down = -(axis - t / 2 - gap - db.a);
    return box(w, up + nb.a, down + db.d, (p, x, y, c) => {
      nb.draw(p, x + (w - nb.w) / 2, y + up, c);
      db.draw(p, x + (w - db.w) / 2, y - down, c);
      if (!noBar) line(p, x + s * 0.06, y + axis, x + w - s * 0.06, y + axis, t, c);
    });
  }

  function radical(content, index, ctx) {
    const s = ctx.size, t = Math.max(0.5, s * 0.05), gap = s * 0.12;
    const cb = content, ib = index ? atom(index, { ...smaller(smaller(ctx)) }) : null;
    const top = cb.a + gap + t, bottom = -(cb.d + s * 0.08), h = top - bottom;
    const rw = s * 0.62 + (ib ? Math.max(0, ib.w - s * 0.3) : 0), lead = ib ? Math.max(0, ib.w - s * 0.3) : 0;
    return box(rw + cb.w + s * 0.12, top + t / 2, -bottom, (p, x, y, c) => {
      const x0 = x + lead;
      line(p, x0 + s * 0.04, y + bottom + h * 0.42, x0 + s * 0.16, y + bottom + h * 0.5, t, c);
      line(p, x0 + s * 0.16, y + bottom + h * 0.5, x0 + s * 0.32, y + bottom, t * 1.7, c);
      line(p, x0 + s * 0.32, y + bottom, x + rw - s * 0.02, y + top, t, c);
      line(p, x + rw - s * 0.02, y + top, x + rw + cb.w + s * 0.1, y + top, t, c);
      cb.draw(p, x + rw + s * 0.04, y, c);
      if (ib) ib.draw(p, x, y + bottom + h * 0.55, c);
    });
  }

  function accent(n, ctx) {
    const [base, mark] = elements(n), s = ctx.size;
    const bb = atom(base, ctx), ch = textOf(mark).trim();
    if (/^[‾¯_]$/.test(ch) || (ch === "→" && mark.attrs.stretchy === "true")) {
      // \overline, \overrightarrow: a line (or arrow) as wide as the base.
      const t = Math.max(0.5, s * 0.05), yTop = bb.a + s * 0.1;
      return box(bb.w, yTop + t + (ch === "→" ? s * 0.12 : 0), bb.d, (p, x, y, c) => {
        bb.draw(p, x, y, c);
        line(p, x, y + yTop, x + bb.w, y + yTop, t, c);
        if (ch === "→") { line(p, x + bb.w - s * 0.14, y + yTop + s * 0.08, x + bb.w, y + yTop, t, c); line(p, x + bb.w - s * 0.14, y + yTop - s * 0.08, x + bb.w, y + yTop, t, c); }
      });
    }
    const glyph = { "^": "ˆ", "~": "˜", "→": "→", "⃗": "→", "¯": "¯", "˙": "˙", "¨": "¨", "ˇ": "ˇ", "´": "´", "`": "`", "˘": "˘", "˚": "˚" }[ch] || ch;
    const small = glyph === "→" ? s * 0.62 : s;
    const ab = text(glyph, small);
    // Accent glyphs already sit at the height of a lowercase letter's top; raise them by how much taller the base is.
    const lift = Math.max(0, bb.a - s * 0.5) + (glyph === "→" ? s * 0.42 : 0);
    const w = Math.max(bb.w, ab.w);
    return box(w, Math.max(bb.a, lift + s * 0.75), bb.d, (p, x, y, c) => {
      bb.draw(p, x + (w - bb.w) / 2, y, c);
      ab.draw(p, x + (w - ab.w) / 2 + (base.tag === "mi" ? s * 0.06 : 0), y + lift, c);
    });
  }

  function table(n, ctx) {
    const s = ctx.size;
    const rows = elements(n).filter((r) => r.tag === "mtr" || r.tag === "mlabeledtr").map((r) => {
      const cells = elements(r).filter((c) => c.tag === "mtd");
      return r.tag === "mlabeledtr" ? cells.slice(1) : cells;
    });
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const boxes = rows.map((r) => Array.from({ length: cols }, (_, c) => (r[c] ? row(elements(r[c]), ctx) : empty())));
    const keep = Array.from({ length: cols }, (_, c) => c).filter((c) => boxes.some((r) => r[c].w > 0));
    if (!keep.length) return empty();
    const align = keep.map((c) => {
      const cls = String(rows[0]?.[c]?.attrs?.class || "") + " " + String(rows[0]?.[c]?.attrs?.columnalign || "");
      return /left/.test(cls) ? "left" : /right/.test(cls) ? "right" : "center";
    });
    const aligned = n.attrs.displaystyle === "true" && (keep.length === 1 || (keep.length % 2 === 0 && align.every((j, k) => j === (k % 2 ? "left" : "right"))));
    const widths = keep.map((c) => Math.max(...boxes.map((r) => r[c].w)));
    const colGap = aligned ? 0 : s * 0.8, rowGap = s * (aligned ? 0.35 : 0.25);
    const heights = boxes.map((r) => ({ a: Math.max(s * 0.72, ...keep.map((c) => r[c].a)), d: Math.max(s * 0.22, ...keep.map((c) => r[c].d)) }));
    const W = widths.reduce((x, y) => x + y, 0) + colGap * Math.max(0, keep.length - 1) + (aligned ? 0 : s * 0.2);
    const H = heights.reduce((x, h) => x + h.a + h.d, 0) + rowGap * (heights.length - 1);
    const axis = s * 0.27, top = H / 2 + axis;
    return box(W, top, H - top, (p, x, y, c) => {
      let cy = y + top;
      boxes.forEach((r, ri) => {
        cy -= heights[ri].a;
        let cx = x + (aligned ? 0 : s * 0.1);
        keep.forEach((col, k) => {
          const b = r[col], cw = widths[k], al = aligned ? (k % 2 ? "left" : keep.length === 1 ? "center" : "right") : align[k];
          b.draw(p, cx + (al === "left" ? 0 : al === "right" ? cw - b.w : (cw - b.w) / 2), cy, c);
          cx += cw + colGap;
        });
        cy -= heights[ri].d + rowGap;
      });
    });
  }

  function atom(n, ctx) {
    if (!n || n.text != null) return empty();
    const kids = elements(n), s = ctx.size;
    switch (n.tag) {
      case "#root": case "math": case "mrow": case "mstyle": case "mpadded": case "merror": case "mtd": case "mtr": {
        const next = n.attrs.displaystyle === "false" ? { ...ctx, display: false } : ctx;
        if (n.tag === "mrow" && kids.length === 1) {
          const nr = naryParts(kids[0]);
          if (nr) return nary(nr, next, kids[0].tag.startsWith("mu"));
        }
        if (/border\s*:/.test(String(n.attrs.style || ""))) {
          const b = row(kids, next), pad = s * 0.15, t = Math.max(0.5, s * 0.05);
          return box(b.w + 2 * pad, b.a + pad, b.d + pad, (p, x, y, c) => { b.draw(p, x + pad, y, c); p.drawRectangle({ x, y: y - b.d - pad, width: b.w + 2 * pad, height: b.a + b.d + 2 * pad, borderColor: c, borderWidth: t }); });
        }
        return row(kids, next);
      }
      case "semantics": return atom(kids[0], ctx);
      case "annotation": case "annotation-xml": case "none": case "mprescripts": case "mphantom": return n.tag === "mphantom" ? (() => { const b = row(kids, ctx); return box(b.w, b.a, b.d, () => {}); })() : empty();
      case "mi": {
        const t = textOf(n).trim(), v = n.attrs.mathvariant;
        const italic = v === "italic" || v === "bold-italic" || (!v && [...t].length === 1 && /\p{L}/u.test(t) && !/[Α-Ω]/.test(t));
        return text(t, s, { italic, bold: /bold/.test(v || "") });
      }
      case "mn": return text(textOf(n).trim(), s, { bold: n.attrs.mathvariant === "bold" });
      case "mtext": return text(textOf(n), s);
      case "ms": return text(`"${textOf(n)}"`, s);
      case "mo": {
        const t = textOf(n).replace(INVISIBLE, "").trim();
        if (NARY.has(t)) return bigOp(t, ctx);
        const g = text(t, s);
        if (n.attrs.stretchy === "true" && /^[([{⟨|‖)\]}⟩]$/.test(t)) return Object.assign(g, { fence: t });
        return g;
      }
      case "mspace": return space(emOf(n.attrs.width, s));
      case "msup": case "msub": case "msubsup": case "mmultiscripts": {
        const nr = naryParts(n);
        if (nr) return nary(nr, ctx, false);
        return scripts(kids[0], n.tag === "msup" ? null : kids[1], n.tag === "msub" ? null : n.tag === "msup" ? kids[1] : kids[2], ctx);
      }
      case "munder": case "mover": case "munderover": {
        const nr = naryParts(n);
        if (nr) return nary(nr, ctx, ctx.display || n.attrs.movablelimits === "false");
        if (n.tag === "mover" && kids[1]?.tag === "mo" && (n.attrs.accent === "true" || /acc|vec/.test(kids[1].attrs.class || "") || textOf(kids[1]).trim().length === 1)) return accent(n, ctx);
        const sc = smaller(ctx);
        const over = n.tag === "munder" ? null : atom(n.tag === "mover" ? kids[1] : kids[2], sc);
        const under = n.tag === "mover" ? null : atom(kids[1], sc);
        return stack(atom(kids[0], ctx), over, under, ctx, s * 0.1);
      }
      case "mfrac": return fraction(n, ctx);
      case "msqrt": return radical(row(kids, ctx), null, ctx);
      case "mroot": return radical(atom(kids[0], ctx), kids[1], ctx);
      case "mtable": return table(n, ctx);
      case "menclose": {
        const b = row(kids, ctx), note = String(n.attrs.notation || ""), t = Math.max(0.5, s * 0.05);
        if (/\bbox\b|roundedbox/.test(note)) { const pad = s * 0.15; return box(b.w + 2 * pad, b.a + pad, b.d + pad, (p, x, y, c) => { b.draw(p, x + pad, y, c); p.drawRectangle({ x, y: y - b.d - pad, width: b.w + 2 * pad, height: b.a + b.d + 2 * pad, borderColor: c, borderWidth: t }); }); }
        if (/strike/.test(note)) return box(b.w, b.a, b.d, (p, x, y, c) => { b.draw(p, x, y, c); line(p, x, y - b.d, x + b.w, y + b.a, t, c); });
        return b;
      }
      default: return row(kids, ctx);
    }
  }

  return { atom, text };
}

// Fonts for math: a serif with a real italic (Times New Roman on Windows, Liberation/DejaVu Serif on Linux), with
// symbol fonts for the characters it lacks. Returns null when none can be embedded (the LaTeX then stays as text).
const MATH_FONTS = [
  ["times.ttf", "timesi.ttf", "timesbd.ttf"],
  ["LiberationSerif-Regular.ttf", "LiberationSerif-Italic.ttf", "LiberationSerif-Bold.ttf"],
  ["DejaVuSerif.ttf", "DejaVuSerif-Italic.ttf", "DejaVuSerif-Bold.ttf"],
  ["NotoSerif-Regular.ttf", "NotoSerif-Italic.ttf", "NotoSerif-Bold.ttf"]
];
const SYMBOL_FONTS = ["seguisym.ttf", "cambria.ttf", "DejaVuSans.ttf", "DejaVuSerif.ttf", "arial.ttf", "segoeui.ttf", "NotoSansMath-Regular.ttf"];

async function loadMathFonts(pdf, readFont, extra = []) {
  const embed = async (name) => {
    const bytes = name ? readFont(name) : null;
    if (!bytes) return null;
    try { const font = await pdf.embedFont(bytes, { subset: true }); return { font, set: new Set(font.getCharacterSet()) }; } catch { return null; }
  };
  for (const [r, i, b] of MATH_FONTS) {
    const regular = await embed(r);
    if (!regular) continue;
    const italic = await embed(i), bold = await embed(b);
    const fallback = [];
    for (const name of SYMBOL_FONTS) { if (name === r) continue; const f = await embed(name); if (f) fallback.push(f); if (fallback.length >= 2) break; }
    for (const f of extra) if (f) fallback.push({ font: f, set: new Set(f.getCharacterSet()) });
    return { regular, italic: italic || regular, italicReal: !!italic, bold: bold || regular, fallback };
  }
  return null;
}

// LaTeX → a box to draw, or null when it is not valid LaTeX.
function layoutMath(tex, fonts, { display = false, size = 11 } = {}) {
  const src = String(tex || "").trim();
  if (!fonts || !src || src.length > MAX_TEX) return null;
  let mathml;
  try { mathml = temml.renderToString(src, { displayMode: display, xml: true, throwOnError: true, trust: false, maxExpand: 500 }); }
  catch { return null; }
  if (/<merror/.test(mathml)) return null;
  try {
    const b = layoutEngine(fonts).atom(parseXml(mathml), { size, display, script: false });
    return b.w > 0 ? b : null;
  } catch { return null; }
}

module.exports = { layoutMath, loadMathFonts };
