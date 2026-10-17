// Settings that belong to each account (0.7.23, phase 3 of the plan), kept on the account itself: who you are, how the
// AI should answer you, your default model, notifications and how long conversations are kept. Each account sees and
// changes only its own; none of them are machine settings.

const TONES = {
  default: "",
  professional: "Ton profesional: precis, politicos și la obiect, fără familiarități.",
  friendly: "Ton prietenos și cald, natural, ca într-o discuție cu cineva apropiat.",
  direct: "Ton direct și sincer: spune lucrurile clar, inclusiv când nu ești de acord.",
  concise: "Răspunsuri scurte: doar esențialul, fără introduceri și fără repetiții.",
  detailed: "Răspunsuri detaliate: explică pașii, motivele și exemplele.",
  creative: "Ton creativ și jucăuș, cu imaginație, păstrând informația corectă."
};
const LANGUAGES = { auto: "", ro: "Răspunde mereu în limba română.", en: "Always answer in English." };
const RETENTION = [0, 30, 90, 365];

const FIELDS = {
  nickname: { type: "text", max: 60 },
  occupation: { type: "text", max: 120 },
  about: { type: "text", max: 1500 },
  customInstructions: { type: "text", max: 3000 },
  tone: { type: "choice", options: Object.keys(TONES) },
  responseLanguage: { type: "choice", options: Object.keys(LANGUAGES) },
  preferredModel: { type: "text", max: 200 },
  notifyAutomations: { type: "bool" },
  notifyCredits: { type: "bool" },
  retentionDays: { type: "number", options: RETENTION }
};
const DEFAULTS = { nickname: "", occupation: "", about: "", customInstructions: "", tone: "default", responseLanguage: "auto", preferredModel: "", notifyAutomations: true, notifyCredits: true, retentionDays: 0 };

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);

// {value} with the accepted changes (plus the display name), or {error}.
function validateAccountSettings(body = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (has("name")) {
    const name = clean(body.name, 80).replace(/\s+/g, " ");
    if (!name) return { error: "Numele nu poate fi gol." };
    out.name = name;
  }
  for (const [key, f] of Object.entries(FIELDS)) {
    if (!has(key)) continue;
    const v = body[key];
    if (f.type === "text") {
      const t = clean(v, f.max + 1);
      if (t.length > f.max) return { error: `„${key}” poate avea cel mult ${f.max} de caractere.` };
      out[key] = t;
    } else if (f.type === "choice") {
      if (!f.options.includes(String(v))) return { error: `Valoare necunoscută pentru „${key}”.` };
      out[key] = String(v);
    } else if (f.type === "bool") {
      if (typeof v !== "boolean") return { error: `„${key}” trebuie să fie true sau false.` };
      out[key] = v;
    } else if (f.type === "number") {
      const n = Number(v);
      if (!f.options.includes(n)) return { error: `Valoare necunoscută pentru „${key}”.` };
      out[key] = n;
    }
  }
  return { value: out };
}

function accountSettings(user) {
  const s = user?.settings && typeof user.settings === "object" ? user.settings : {};
  return { ...DEFAULTS, ...Object.fromEntries(Object.keys(DEFAULTS).filter((k) => s[k] !== undefined).map((k) => [k, s[k]])) };
}

// What the AI is told about the person and how to answer, built only from what they wrote themselves.
function personalizationText(user) {
  const s = accountSettings(user), lines = [];
  if (s.nickname) lines.push(`Cum vrea să i te adresezi: ${s.nickname}.`);
  if (s.occupation) lines.push(`Ocupație: ${s.occupation}.`);
  if (s.about) lines.push(`Despre utilizator (scris de el): ${s.about}`);
  const rules = [TONES[s.tone], LANGUAGES[s.responseLanguage]].filter(Boolean);
  if (!lines.length && !rules.length && !s.customInstructions) return "";
  return ["PERSONALIZAREA CONTULUI (setată de utilizator în Setări → Profil; respect-o dacă nu contrazice cererea de acum):",
    ...lines, ...rules, ...(s.customInstructions ? [`Instrucțiunile utilizatorului pentru răspunsuri:\n${s.customInstructions}`] : [])].join("\n");
}

module.exports = { TONES, LANGUAGES, RETENTION, FIELDS, DEFAULTS, validateAccountSettings, accountSettings, personalizationText };
