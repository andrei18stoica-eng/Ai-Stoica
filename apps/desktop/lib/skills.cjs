// Skills (0.7.18): reusable instructions an account saves once and calls with /name in the chat (or keeps always on).
// They did not exist before. A skill only adds instructions to the conversation; it never runs code or calls a service.

const MAX_SKILLS = 50;
const MAX_ACTIVE = 4;

// Ready-made skills, added with one click; each account edits its own copy.
const SKILL_TEMPLATES = [
  { slug: "email", name: "Email profesional", description: "Scrie un email clar și politicos, cu subiect, din câteva idei.",
    instructions: "Scrie un email profesional în limba cererii. Începe cu un rând «Subiect: …». Folosește o formulă de adresare potrivită, paragrafe scurte, un ton politicos și ferm, și o încheiere cu semnătura «[Numele tău]». Dacă lipsesc detalii esențiale (destinatar, scop), presupune-le rezonabil și marchează-le între paranteze drepte." },
  { slug: "rezumat", name: "Rezumat", description: "Rezumă un text sau un document în ideile principale.",
    instructions: "Rezumă conținutul primit. Începe cu o propoziție care spune ideea principală, apoi 3–7 puncte cu ce e important (cifre, decizii, termene), apoi, dacă există, «De făcut» cu acțiunile. Nu adăuga informații care nu sunt în text." },
  { slug: "corector", name: "Corector", description: "Corectează gramatica, diacriticele și punctuația, fără să schimbe sensul.",
    instructions: "Corectează textul primit: gramatică, ortografie, diacritice (ș, ț cu virgulă), punctuație, acorduri. Păstrează sensul, tonul și formatarea. Dă întâi textul corectat complet, apoi o listă scurtă cu cele mai importante corecturi." },
  { slug: "traducere", name: "Traducător", description: "Traduce natural, păstrând tonul și formatarea.",
    instructions: "Tradu textul primit în limba cerută (implicit: din română în engleză, iar din altă limbă în română). Traducerea trebuie să sune natural pentru un vorbitor nativ, să păstreze tonul, numele proprii și formatarea. Dă doar traducerea, apoi, dacă e cazul, o notă scurtă despre expresiile greu de tradus." },
  { slug: "social", name: "Postare social media", description: "Postări pentru Instagram, Facebook, LinkedIn sau TikTok.",
    instructions: "Scrie o postare pentru rețeaua cerută (implicit Instagram): un prim rând care atrage atenția, text scurt cu paragrafe de 1–2 rânduri, un îndemn la acțiune și 5–10 hashtaguri relevante. Pentru LinkedIn, ton profesional și fără multe emoji. Oferă două variante." },
  { slug: "simplu", name: "Explică simplu", description: "Explică orice subiect pe înțelesul unui începător.",
    instructions: "Explică subiectul ca pentru cineva care îl aude prima dată: fără jargon (sau explicat imediat), cu o analogie din viața de zi cu zi, un exemplu concret și, la final, ideea de reținut într-o propoziție." },
  { slug: "oferta", name: "Ofertă pentru client", description: "O ofertă de servicii clară, cu etape, preț și termen.",
    instructions: "Redactează o ofertă de servicii: titlu, scurt rezumat al nevoii clientului, ce include (listă), etape și termen, preț (total și ce cuprinde), ce nu include, condiții de plată, valabilitatea ofertei și pasul următor. Unde lipsesc cifre, pune-le între paranteze drepte ca să fie completate." }
];

function slugify(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

// {value} with the clean fields, or {error}.
function validateSkill(body = {}, prev = null) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!prev || has("name")) {
    const name = String(body.name || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (!name) return { error: "Skill-ul are nevoie de un nume." };
    if (name.length > 60) return { error: "Numele poate avea cel mult 60 de caractere." };
    out.name = name;
  }
  if (!prev || has("slug") || has("name")) {
    const slug = slugify(has("slug") && body.slug ? body.slug : out.name || prev?.name);
    if (!slug) return { error: "Comanda skill-ului (/nume) trebuie să conțină litere sau cifre." };
    out.slug = slug;
  }
  if (!prev || has("description")) {
    const d = String(body.description || "").trim();
    if (d.length > 300) return { error: "Descrierea poate avea cel mult 300 de caractere." };
    out.description = d;
  }
  if (!prev || has("instructions")) {
    const i = String(body.instructions || "").trim();
    if (!i) return { error: "Scrie instrucțiunile skill-ului: ce trebuie să facă AI-ul când îl folosești." };
    if (i.length > 8000) return { error: "Instrucțiunile pot avea cel mult 8000 de caractere." };
    out.instructions = i;
  }
  for (const k of ["enabled", "auto"]) if (has(k)) {
    if (typeof body[k] !== "boolean") return { error: `Câmpul „${k}” trebuie să fie true sau false.` };
    out[k] = body[k];
  }
  return { value: out };
}

// The skills a message calls: "/rezumat" anywhere in it, plus the ones kept always on. At most MAX_ACTIVE.
function skillsForMessage(skills, text) {
  const t = String(text || "");
  const used = new Set((t.match(/(^|\s)\/([a-z0-9-]{1,32})\b/gi) || []).map(x => x.trim().slice(1).toLowerCase()));
  const mine = (skills || []).filter(s => s.enabled !== false);
  const called = mine.filter(s => used.has(String(s.slug).toLowerCase()));
  const always = mine.filter(s => s.auto && !called.includes(s));
  return [...called, ...always].slice(0, MAX_ACTIVE);
}

function skillSystemText(list) {
  if (!list.length) return "";
  return "SKILL-URI ACTIVE — urmează aceste instrucțiuni salvate de utilizator pentru răspunsul de acum:\n"
    + list.map(s => `### /${s.slug} — ${s.name}\n${s.instructions}`).join("\n\n");
}

function publicSkill(s) {
  const { userId, ...safe } = s || {};
  return { ...safe, enabled: safe.enabled !== false, auto: !!safe.auto };
}

module.exports = { SKILL_TEMPLATES, MAX_SKILLS, MAX_ACTIVE, slugify, validateSkill, skillsForMessage, skillSystemText, publicSkill };
