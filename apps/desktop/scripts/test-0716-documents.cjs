// 0.7.16, at the Owner's request: a chat message that asks for a Word, PowerPoint, Excel or PDF file gets the file,
// also when it is asked politely ("vreau…", "poți să-mi faci…?", "scrie-mi … în Word"). Questions about a format stay text.
const path = require("path"), { pathToFileURL } = require("url");

function expect(v, m) { if (!v) throw new Error(m); }

async function main() {
  const { requestedDocumentFormat: ask } = await import(pathToFileURL(path.join(__dirname, "../renderer/src/documentIntent.mjs")).href);
  for (const [text, format] of [
    ["Fă-mi un document Word cu un CV", "docx"], ["Creează o prezentare PowerPoint despre energie solară", "pptx"],
    ["Trimite-mi un Excel cu bugetul pe 12 luni", "xlsx"], ["Fă-mi un PDF cu regulamentul", "pdf"],
    ["Vreau un document Word cu o cerere de concediu", "docx"], ["Poți să-mi faci un Excel cu cheltuielile?", "xlsx"],
    ["Fă un pdf cu oferta", "pdf"], ["Îmi faci o prezentare despre AI?", "pptx"], ["Scrie-mi o scrisoare în Word", "docx"],
    ["Am nevoie de un tabel Excel cu prețuri", "xlsx"], ["Aș vrea să-mi faci un PDF cu meniul", "pdf"], ["pdf", "pdf"]
  ]) expect(ask(text) === format, `"${text}" must make a ${format}, got ${ask(text)}`);
  for (const text of ["Cum fac un PDF?", "Ce este un fișier docx?", "Vreau să știu cum export în Excel", "Scrie un articol despre formatul PDF",
    "Poți să-mi explici ce e PowerPoint?", "Explică-mi diferența dintre Word și PDF", "Am nevoie de ajutor cu Excel"])
    expect(ask(text) === null, `"${text}" must stay a text answer, got ${ask(text)}`);
  console.log("test-0716-documents: OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
