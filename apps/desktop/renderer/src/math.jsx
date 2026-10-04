import React, { useEffect, useState } from "react";
import { MARK } from "./mathText.mjs";
export { prepareMath } from "./mathText.mjs";

let temmlLoad = null;
const loadTemml = () => temmlLoad || (temmlLoad = import("temml").then((m) => m.default || m));

export function MathTex({ tex, display }) {
  const [html, setHtml] = useState(null);
  useEffect(() => {
    let active = true;
    loadTemml().then((temml) => {
      if (!active) return;
      try { setHtml(temml.renderToString(String(tex || ""), { displayMode: !!display, throwOnError: true, trust: false, maxExpand: 500 })); }
      catch { setHtml(""); }
    }).catch(() => { if (active) setHtml(""); });
    return () => { active = false; };
  }, [tex, display]);
  // Spans only (a $$…$$ can sit inside a paragraph); .mathBlock is shown as a centred block.
  if (html) return <span className={display ? "mathBlock" : "mathInline"} dangerouslySetInnerHTML={{ __html: html }}/>;
  // While temml loads, or when the LaTeX is not valid: the formula as written.
  return <code className={display ? "mathSource" : undefined}>{html === "" ? (display ? `$$${tex}$$` : `$${tex}$`) : tex}</code>;
}

// Code spans and ```math blocks that hold formulas.
export function mathFromCode(children) {
  const text = Array.isArray(children) ? children.join("") : typeof children === "string" ? children : null;
  if (!text || !text.startsWith(MARK)) return null;
  return <MathTex tex={text.slice(2)} display={text[1] === "D"}/>;
}
export function mathFromPre(node) {
  const code = node?.children?.find((c) => c.tagName === "code");
  const cls = code?.properties?.className;
  if (!code || !(Array.isArray(cls) ? cls : [cls]).includes("language-math")) return null;
  const tex = (code.children || []).map((c) => c.value || "").join("").replace(/\n$/, "");
  return <MathTex tex={tex} display/>;
}
