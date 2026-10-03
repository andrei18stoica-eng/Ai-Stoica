// Clarifying questions with clickable answers: the ```intrebari block an assistant answer may contain.
const QUESTIONS_RULE = "ÎNTREBĂRI DE CLARIFICARE: când cererea este ambiguă într-un mod care schimbă rezultatul (format, amploare, public, lungime, stil sau care dintre mai multe variante) și conversația nu răspunde deja, nu ghici. Răspunde cu cel mult o propoziție scurtă, urmată de exact un bloc:\n```intrebari\n{\"questions\":[{\"header\":\"Format\",\"question\":\"Ce format vrei?\",\"multiSelect\":false,\"options\":[{\"label\":\"Prezentare (Recomandat)\",\"description\":\"...\"},{\"label\":\"Document\",\"description\":\"...\"}]}]}\n```\nReguli: 1–3 întrebări, 2–4 variante la fiecare; eticheta are 1–5 cuvinte; header-ul are cel mult 12 caractere; varianta recomandată este prima și se termină cu „(Recomandat)”; descrierea are o propoziție scurtă; multiSelect este true doar când se pot alege mai multe variante; JSON-ul trebuie să fie valid. Nu pune întrebări la saluturi, la întrebări factuale simple, la continuări clare sau când utilizatorul a răspuns deja ori a spus „nu mă întreba” sau „alege tu”. Întreabă cel mult o dată pentru aceeași cerere: după ce primești răspunsurile, fă sarcina.";

const BLOCK = /```intrebari[^\S\r\n]*\r?\n([\s\S]*?)```/;
function clip(value, max) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim(); }

function cleanLabel(value) {
  const raw = clip(value, 200);
  const recommended = /\(recomandat\)/i.test(raw);
  const words = raw.replace(/\s*\(recomandat\)\s*/gi, " ").trim().split(" ").filter(Boolean).slice(0, 5).join(" ").slice(0, 60);
  return words ? (recommended ? `${words} (Recomandat)` : words) : "";
}

// Returns {questions} (at most 3 questions with 2–4 options each) or null when the block is missing or invalid.
function parseQuestions(text) {
  const match = String(text || "").match(BLOCK);
  if (!match) return null;
  let data;
  try { data = JSON.parse(match[1]); } catch { return null; }
  const list = Array.isArray(data?.questions) ? data.questions : null;
  if (!list || !list.length) return null;
  const questions = [];
  for (const q of list.slice(0, 3)) {
    if (!q || typeof q !== "object") return null;
    const question = clip(q.question, 300);
    if (!question || !Array.isArray(q.options)) return null;
    const options = [], seen = new Set();
    for (const o of q.options) {
      const label = cleanLabel(typeof o === "string" ? o : o?.label);
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      const description = typeof o === "object" && o ? clip(o.description, 200) : "";
      options.push(description ? { label, description } : { label });
      if (options.length === 4) break;
    }
    if (options.length < 2) return null;
    questions.push({ header: clip(q.header, 12) || `Întrebarea ${questions.length + 1}`, question, multiSelect: q.multiSelect === true, options });
  }
  return { questions };
}

// A valid block is rewritten with the cleaned JSON; an invalid one is left exactly as the model wrote it.
function sanitizeQuestions(text) {
  const value = String(text ?? "");
  const parsed = parseQuestions(value);
  if (!parsed) return value;
  return value.replace(BLOCK, () => "```intrebari\n" + JSON.stringify(parsed) + "\n```");
}

module.exports = { QUESTIONS_RULE, parseQuestions, sanitizeQuestions };
