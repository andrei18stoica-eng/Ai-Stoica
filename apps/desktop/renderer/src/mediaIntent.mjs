// A chat message that asks for a picture or a video ("generează o poză cu…", "fă-mi un video…", "poți să-mi faci o
// imagine…?") is made as a file, not answered in text. Only explicit requests count: a question about pictures, a
// script for a video or "o imagine de ansamblu" stay text (test-0716-chat-media.cjs).
const normalize = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const NOUN = "(imagine|poza|fotografie|logo|desen|ilustratie|video|videoclip|animatie|image|picture|photo|drawing|illustration|animation)";
const ARTICLE = "(?:(?:si\\s+)?(?:o|un|mi|me|an|a|niste|doua|cateva)\\s+)?";
// "generează o poză", "fă-mi o imagine", "fă o poză", "creează-mi un video", "make me a picture"
export const MEDIA_COMMAND = new RegExp("^(?:te rog,? )?(?:(?:creeaza|genereaza|deseneaza)(?:[- ]?mi)?|fa(?:[- ]?mi)?|make(?: me)?|generate|create|draw)\\s+" + ARTICLE + NOUN + "\\b");
// "vreau o poză cu…", "aș vrea un video…", "poți să-mi faci o poză…?", "îmi poți genera o imagine…?"
const MEDIA_ASK = new RegExp("^(?:te rog,? )?(?:(?:vreau|as vrea|da mi|dami)(?:\\s+sa\\s+(?:imi\\s+)?(?:faci|generezi|creezi|desenezi))?|(?:poti|ai putea|puteti|imi poti|mi-ai putea|ma poti ajuta)\\s+(?:sa\\s+)?(?:(?:imi|mi|-mi)\\s*)?(?:faci|generezi|creezi|desenezi|genera|crea|face))\\s+" + ARTICLE + NOUN + "\\b");
const NOT_MEDIA = /\b(script|scenariu|text|plan|idee|idei|descriere|prompt|titlu|caption)\b|\bimagine (de ansamblu|generala|clara|completa)\b/;

export function requestedMediaGeneration(value) {
  const t = normalize(value).replace(/\bsa-mi\b/g, "sa imi").replace(/-mi\b/g, " mi");
  if (!t || NOT_MEDIA.test(t)) return null;
  const m = (!t.includes("?") && t.match(MEDIA_COMMAND)) || t.match(MEDIA_ASK);
  if (!m) return null;
  return /^(video|videoclip|animatie|animation)$/.test(m[1]) ? "video" : "image";
}
