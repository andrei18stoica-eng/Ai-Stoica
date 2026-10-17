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
  ["pptx",/\bpptx\b|powerpoint|prezentare|presentation|slide deck|\bslides\b/],["docx",/\bdocx\b|\bword\b/],["xlsx",/\bxlsx\b|\bexcel\b|foaie de calcul|spreadsheet/],
  ["pdf",/\bpdf\b/],["csv",/\bcsv\b/],["json",/\bjson\b/],["html",/\bhtml\b/],["xml",/\bxml\b/],["rtf",/\brtf\b/],
  ["zip",/\bzip\b|arhiva/],["ipynb",/\bipynb\b|jupyter|notebook/],["svg",/\bsvg\b/],["md",/\bmarkdown\b|\bmd\b/],["txt",/\btxt\b|text simplu/],
  ["py",/\bpython\b/],["js",/\bjavascript\b/],["ts",/\btypescript\b/],["ps1",/\bpowershell\b/],["sql",/\bsql\b/],["yaml",/\byaml\b/],["tex",/\blatex\b/],
  ["docx",/\bdocument(?:ul)?\b/]
];
// Polite or indirect asks ("vreau un Word cu…", "poți să-mi faci un Excel…?", "scrie-mi o scrisoare în Word"). Unlike a
// command, they make a file only when the format is named as the thing to make ("un PDF", "în Word", "document Word"),
// so "scrie un articol despre formatul PDF" or "vreau să știu cum export în Excel" stay text.
const MAKE="(?:faci|generezi|creezi|scrii|trimiti|pregatesti|redactezi|exporti|pui|face|genera|crea|scrie|trimite|pregati|pune)";
const ASK=new RegExp("^(?:te rog,? )?(?:(?:vreau|as vrea|am nevoie de|imi trebuie)(?:\\s+sa\\s+(?:imi\\s+)?"+MAKE+")?|(?:poti|ai putea|puteti|imi poti|mi ai putea|ma poti ajuta)\\s+(?:sa\\s+)?(?:(?:imi|mi)\\s+)?"+MAKE+"|imi (?:faci|scrii|pregatesti|generezi|creezi)|(?:fa|scrie|redacteaza|pregateste|realizeaza|compune)(?:\\s+mi)?)\\s+(?!sa\\b|cum\\b|daca\\b|ce\\b)");
const FORMAT_SLOT=new RegExp("\\b(?:in|ca|un|o|intr un|niste|document|fisier|tabel|format|foaie)\\s+(?:(?:document|fisier|tabel|format)\\s+)?(?:word|excel|powerpoint|prezentare|"+FILE_FORMATS.join("|")+")\\b");
// The same in English (0.7.29): "can you make me a presentation…?", "I want a PDF with…", "please make a pdf", "write an
// essay in Word", "turn this into a PDF". The format must be named as the thing to make ("a PDF", "in Word", "into a
// spreadsheet"), so "write an article about the PDF format" or "I need help with Excel" stay text.
const MAKE_EN="(?:make|create|generate|write|prepare|draft|build|do|send|give|put|turn|convert|export|save|produce|compose|design)";
const ASK_EN=new RegExp("^(?:please |pls )?(?:(?:i want|i d like|i would like|i need|i d need|give me|send me|get me)|(?:can|could|would|will) you(?: please)?(?: "+MAKE_EN+")?|please "+MAKE_EN+"|"+MAKE_EN+"(?: me)?)\\s+(?!how\\b|what\\b|whether\\b|if\\b)");
const FORMAT_SLOT_EN=new RegExp("\\b(?:in|as|a|an|into|to)\\s+(?:(?:new|short|simple|nice|professional|small|full|complete)\\s+)?(?:word|excel|powerpoint|presentation|slide deck|slides|spreadsheet|document|doc|"+FILE_FORMATS.join("|")+")\\b");
export function requestedDocumentFormat(value){
  const t=normalizeIntent(value);
  if(!t)return null;
  const explicit=t.match(new RegExp("\\.("+FILE_FORMATS.join("|")+")\\b"));
  const found=explicit?[explicit[1]]:FORMAT_CANDIDATES.find(([,re])=>re.test(t));
  if(!found)return null;
  const onlyFormat=new RegExp("^(in |ca )?("+found[0]+"|word|powerpoint|excel|markdown|python|javascript|typescript|jupyter|notebook)( te rog)?[.!]?$");
  if(!isQuestion(t)&&(FILE_VERB.test(t)||onlyFormat.test(t)))return found[0];
  const u=t.replace(/\bsa-mi\b/g,"sa imi").replace(/-mi\b/g," mi").replace(/[-,]/g," ").replace(/\s+/g," ");
  if(ASK.test(u)&&FORMAT_SLOT.test(u))return found[0];
  return ASK_EN.test(u)&&FORMAT_SLOT_EN.test(u)?found[0]:null;
}

// Changing a file (0.7.29): "edit the attached file", "modifică documentul", "add a slide about prices", "translate it to
// English". The format is the attached file's (or, without one, the last file the AI made in this chat), and the answer
// comes back as the whole changed file. A how/what question stays text.
const EDIT_VERB=/\b(?:modify|edit|change|fix|correct|update|add|remove|delete|replace|translate|rewrite|shorten|expand|rename|insert|reformat|format|improve|redo|adjust|reorder|move|make it|make the|put|modifica|editeaza|schimba|corecteaza|actualizeaza|adauga|scoate|sterge|inlocuieste|traduce|rescrie|scurteaza|extinde|redenumeste|insereaza|imbunatateste|reformateaza|refa|ajusteaza|muta|pune)\b/;
const EDITABLE=["docx","pptx","xlsx","pdf","csv","md","txt","html","json","xml","rtf"];
export function editedDocumentFormat(value,attachmentNames=[],lastMadeFormat=null){
  const t=normalizeIntent(value);
  if(!t||QUESTION_START.test(t)||!EDIT_VERB.test(t))return null;
  for(const name of attachmentNames){
    const ext=String(name||"").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    if(ext&&EDITABLE.includes(ext))return ext;
  }
  return lastMadeFormat&&EDITABLE.includes(lastMadeFormat)?lastMadeFormat:null;
}
