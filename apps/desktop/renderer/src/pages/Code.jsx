import React, { useEffect, useState } from "react";
import { SquareTerminal, GitBranch, Sparkles, ShieldCheck } from "lucide-react";
import { api, toast, ToolShell } from "../core.jsx";

// "Code AI Stoica": start a programming conversation with Codex or Claude Code. The Owner uses the subscriptions
// connected in OmniRoute; an account the Owner gave access to (Control Center → "Code AI Stoica") uses the paid APIs.
const GROUPS = [
  ["codex", "Codex", "Abonamentul tău ChatGPT, conectat în OmniRoute"],
  ["claude-code", "Claude Code", "Abonamentul tău Claude, conectat în OmniRoute"],
  ["openai-api", "OpenAI prin API", "Plătit pe consum, cu cheia sau permisiunile date de Owner"],
  ["claude-api", "Claude prin API", "Plătit pe consum, cu permisiunile date de Owner"]
];
const short = (id) => String(id).split("/").slice(1).join("/") || id;

export function CodePage({ onClose, onStart }) {
  const [info, setInfo] = useState(null), [busy, setBusy] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api("/api/code").then((d) => { if (active) setInfo(d.data || { allowed: false }); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  async function start(model) {
    if (busy) return;
    setBusy(model);
    try { const d = await api("/api/code/session", { method: "POST", body: JSON.stringify({ model }) }); onStart(d.data, d.assistant); }
    catch (e) { toast("Code: " + e.message); }
    finally { setBusy(""); }
  }
  const models = info?.models || [];
  return <ToolShell title="Code AI Stoica" subtitle="Programare cu Codex și Claude Code: alegi modelul și pornești o conversație de cod." onClose={onClose} className="pageModal codePage">
    <div className="pageBody">
      {error && <div className="inlineError" role="alert">{error}</div>}
      {!info && !error && <div className="emptyState"><SquareTerminal size={30}/>Se încarcă modelele de cod…</div>}
      {info && !info.allowed && <div className="emptyState"><ShieldCheck size={30}/>Code AI Stoica este disponibil pentru Owner și pentru conturile cărora Owner-ul le-a dat acces.</div>}
      {info?.allowed && <>
        {GROUPS.map(([key, title, note]) => {
          const list = models.filter((m) => m.group === key);
          if (!list.length && (key === "openai-api" || key === "claude-api")) return null;
          if (!list.length && !info.subscriptions) return null;
          return <section className="codeGroup" key={key}>
            <div className="codeGroupHead"><b>{title}</b><small>{note}</small></div>
            {list.length ? <div className="codeModels">{list.map((m) => <button key={m.id} type="button" className="codeModel" onClick={() => start(m.id)} disabled={!!busy}>
              <SquareTerminal size={16}/><span><b>{short(m.id)}</b><small>{m.id}</small></span><em>{busy === m.id ? "Se pornește…" : "Începe"}</em>
            </button>)}</div> : <p className="settingsHelp">Niciun model {title} în OmniRoute. Conectează-l în panoul OmniRoute (Providers), apoi redeschide pagina.</p>}
          </section>;
        })}
        {!models.length && <div className="emptyState"><Sparkles size={30}/>Nu există încă niciun model de cod disponibil.{info.subscriptions ? " Conectează Codex sau Claude Code în OmniRoute." : " Cere Owner-ului acces la modelele OpenAI sau Claude."}</div>}
        <section className="codeGroup">
          <div className="codeGroupHead"><b><GitBranch size={14}/> GitHub</b><small>{info.repo ? `${info.repo} · ${info.branch}` : "Niciun repository conectat"}</small></div>
          <p className="settingsHelp">{info.repo ? "La întrebările de cod, AI Stoica caută singur fișierele relevante din acest repository." : "Pune repository-ul în Setări → AI & OmniRoute → GitHub, ca AI Stoica să citească singur codul la întrebările de programare."}</p>
        </section>
        {info.owner && <p className="settingsHelp codeAccessNote">Acces pentru alte conturi: Control Center → contul → „Code AI Stoica”. Ele folosesc API-urile OpenAI / Claude, plătite pe consum, nu abonamentele tale: condițiile ChatGPT și Claude nu permit împărțirea contului.</p>}
      </>}
    </div>
  </ToolShell>;
}
