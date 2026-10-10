// A chat message that asks for a file ("fă-mi un document Word…", "vreau un Excel cu…", "poți să-mi faci o prezentare?")
// is answered as a downloadable file; questions about a format ("cum fac un PDF?") stay text (test-0716-documents.cjs).
export function normalizeIntent(value){
  return String(value||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ").trim();
}
const QUESTION_START=/^(cum|ce|de ce|cand|care|cine|unde|cat|cata|cati|cate|explica|explicati|explica-mi|poti sa-mi explici|poti sa imi explici|ma poti ajuta sa inteleg|how|what|why|when|which|explain)\b/;
export function isQuestion(t){return t.includes("?")||QUESTION_START.test(t);}
export const FILE_FORMATS=["pdf","docx","pptx","xlsx","csv","json","md","txt","html","xml","rtf","zip","ipynb","svg","js","ts","jsx","tsx","py","java","c","cpp","cs","go","rs","php","rb","sh","ps1","sql","css","yaml","yml","toml","ini","tex"];
const FILE_VERB=/^(?:te rog,? )?(trimite(?:-mi)?|da-mi|dami|exporta(?:-mi)?|salveaza(?:-mi)?|fa-mi|fami|creeaza(?:-mi)?|genereaza(?:-mi)?|descarca(?:-mi)?|pune(?:-mi)?|transforma|converteste|export|save|make|create|generate|download|send)\b/;
export const FORMAT_CANDIDATES=[
  ["pptx",/\bpptx\b|powerpoint|prezentare/],["docx",/\bdocx\b|\bword\b/],["xlsx",/\bxlsx\b|\bexcel\b|foaie de calcul|spreadsheet/],
  ["pdf",/\bpdf\b/],["csv",/\bcsv\b/],["json",/\bjson\b/],["html",/\bhtml\b/],["xml",/\bxml\b/],["rtf",/\brtf\b/],
  ["zip",/\bzip\b|arhiva/],["ipynb",/\bipynb\b|jupyter|notebook/],["svg",/\bsvg\b/],["md",/\bmarkdown\b|\bmd\b/],["txt",/\btxt\b|text simplu/],
  ["py",/\bpython\b/],["js",/\bjavascript\b/],["ts",/\btypescript\b/],["ps1",/\bpowershell\b/],["sql",/\bsql\b/],["yaml",/\byaml\b/],["tex",/\blatex\b/]
];
// Polite or indirect asks ("vreau un Word cu…", "poți să-mi faci un Excel…?", "scrie-mi o scrisoare în Word"). Unlike a
// command, they make a file only when the format is named as the thing to make ("un PDF", "în Word", "document Word"),
// so "scrie un articol despre formatul PDF" or "vreau să știu cum export în Excel" stay text.
const MAKE="(?:faci|generezi|creezi|scrii|trimiti|pregatesti|redactezi|exporti|pui|face|genera|crea|scrie|trimite|pregati|pune)";
const ASK=new RegExp("^(?:te rog,? )?(?:(?:vreau|as vrea|am nevoie de|imi trebuie)(?:\\s+sa\\s+(?:imi\\s+)?"+MAKE+")?|(?:poti|ai putea|puteti|imi poti|mi ai putea|ma poti ajuta)\\s+(?:sa\\s+)?(?:(?:imi|mi)\\s+)?"+MAKE+"|imi (?:faci|scrii|pregatesti|generezi|creezi)|(?:fa|scrie|redacteaza|pregateste|realizeaza|compune)(?:\\s+mi)?)\\s+(?!sa\\b|cum\\b|daca\\b|ce\\b)");
const FORMAT_SLOT=new RegExp("\\b(?:in|ca|un|o|intr un|niste|document|fisier|tabel|format|foaie)\\s+(?:(?:document|fisier|tabel|format)\\s+)?(?:word|excel|powerpoint|prezentare|"+FILE_FORMATS.join("|")+")\\b");
export function requestedDocumentFormat(value){
  const t=normalizeIntent(value);
  if(!t)return null;
  const explicit=t.match(new RegExp("\\.("+FILE_FORMATS.join("|")+")\\b"));
  const found=explicit?[explicit[1]]:FORMAT_CANDIDATES.find(([,re])=>re.test(t));
  if(!found)return null;
  const onlyFormat=new RegExp("^(in |ca )?("+found[0]+"|word|powerpoint|excel|markdown|python|javascript|typescript|jupyter|notebook)( te rog)?[.!]?$");
  if(!isQuestion(t)&&(FILE_VERB.test(t)||onlyFormat.test(t)))return found[0];
  const u=t.replace(/\bsa-mi\b/g,"sa imi").replace(/-mi\b/g," mi").replace(/[-,]/g," ").replace(/\s+/g," ");
  return ASK.test(u)&&FORMAT_SLOT.test(u)?found[0]:null;
}
