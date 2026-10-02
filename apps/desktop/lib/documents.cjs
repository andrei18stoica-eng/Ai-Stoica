// Document export (PDF, Word, PowerPoint, Excel, CSV, JSON, HTML, XML, RTF, ZIP, notebook, SVG, code files).
const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fontkitModule = require("@pdf-lib/fontkit");
const fontkit = fontkitModule.default || fontkitModule;
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require("docx");
const PptxGenJS = require("pptxgenjs");
const JSZip = require("jszip");

function safeGeneratedName(value) {
  return String(value || "AI Stoica").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "AI Stoica";
}
function parseDocumentBlocks(content) {
  const lines = String(content || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { blocks.push({ type: "blank", text: "" }); continue; }
    let m = line.match(/^(#{1,4})\s+(.+)$/);
    if (m) { blocks.push({ type: "heading", level: m[1].length, text: m[2].trim() }); continue; }
    m = line.match(/^[-*•]\s+(.+)$/);
    if (m) { blocks.push({ type: "bullet", text: m[1].trim() }); continue; }
    m = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (m) { blocks.push({ type: "number", text: m[2].trim(), number: Number(m[1]) }); continue; }
    blocks.push({ type: "paragraph", text: line });
  }
  return blocks;
}
function plainMarkdownText(value) {
  return String(value || "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").replace(/`([^`]+)`/g, "$1");
}
function inlineRuns(text, size = 22) {
  const src = String(text || "");
  const runs = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g;
  let pos = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > pos) runs.push(new TextRun({ text: src.slice(pos, m.index), size }));
    const token = m[0];
    if (token.startsWith("**") || token.startsWith("__")) runs.push(new TextRun({ text: token.slice(2, -2), size, bold: true }));
    else runs.push(new TextRun({ text: token.slice(1, -1), size, font: "Consolas" }));
    pos = m.index + token.length;
  }
  if (pos < src.length) runs.push(new TextRun({ text: src.slice(pos), size }));
  return runs.length ? runs : [new TextRun({ text: src, size })];
}
function findWindowsFont() {
  const candidates = [
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "segoeui.ttf"),
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "arial.ttf"),
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "calibri.ttf")
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}
function wrapTextByWidth(text, maxChars) {
  const words = String(text || "").split(/\s+/);
  const out = []; let cur = "";
  for (const word of words) {
    const candidate = (cur + " " + word).trim();
    if (candidate.length > maxChars && cur) { out.push(cur); cur = word; }
    else cur = candidate;
  }
  if (cur || !out.length) out.push(cur);
  return out;
}
async function createPdfBytes(title, content) {
  const pdf = await PDFDocument.create();
  let regular, bold, unicode = false;
  const fontPath = findWindowsFont();
  if (fontPath) {
    try {
      pdf.registerFontkit(fontkit);
      const fontBytes = fs.readFileSync(fontPath);
      regular = await pdf.embedFont(fontBytes, { subset: true });
      bold = regular;
      unicode = true;
    } catch {}
  }
  if (!regular) { regular = await pdf.embedFont(StandardFonts.Helvetica); bold = await pdf.embedFont(StandardFonts.HelveticaBold); }
  const clean = v => unicode ? String(v || "") : String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[șş]/g,"s").replace(/[ȘŞ]/g,"S").replace(/[țţ]/g,"t").replace(/[ȚŢ]/g,"T");
  let page = pdf.addPage([595.28, 841.89]), y = 792;
  const draw = (text, opts = {}) => {
    const size = opts.size || 11, indent = opts.indent || 0, font = opts.bold ? bold : regular;
    const max = Math.max(28, Math.floor((88 - indent / 7) * (11 / size)));
    for (const line of wrapTextByWidth(clean(plainMarkdownText(text)), max)) {
      if (y < 58) { page = pdf.addPage([595.28, 841.89]); y = 792; }
      page.drawText(line || " ", { x: 48 + indent, y, size, font, color: rgb(0.12,0.15,0.2) });
      y -= size + (opts.after == null ? 5 : opts.after);
    }
  };
  draw(title || "AI Stoica", { size: 20, bold: true, after: 8 }); y -= 8;
  for (const b of parseDocumentBlocks(content)) {
    if (b.type === "blank") { y -= 6; continue; }
    if (b.type === "heading") { y -= 3; draw(b.text, { size: b.level === 1 ? 17 : b.level === 2 ? 15 : 13, bold: true, after: 7 }); continue; }
    if (b.type === "bullet") { draw("• " + b.text, { indent: 10, after: 4 }); continue; }
    if (b.type === "number") { draw(String(b.number) + ". " + b.text, { indent: 10, after: 4 }); continue; }
    draw(b.text, { after: 5 });
  }
  return Buffer.from(await pdf.save());
}
async function createDocxBytes(title, content) {
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(title || "AI Stoica"), bold: true, size: 36 })] }),
    new Paragraph({ text: "" })
  ];
  for (const b of parseDocumentBlocks(content)) {
    if (b.type === "blank") { children.push(new Paragraph({ text: "" })); continue; }
    if (b.type === "heading") {
      const level = b.level <= 1 ? HeadingLevel.HEADING_1 : b.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      children.push(new Paragraph({ heading: level, children: inlineRuns(b.text, b.level <= 1 ? 30 : 26) }));
      continue;
    }
    if (b.type === "bullet") { children.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(b.text, 22) })); continue; }
    if (b.type === "number") { children.push(new Paragraph({ children: [new TextRun({ text: String(b.number) + ". ", bold: true, size: 22 }), ...inlineRuns(b.text,22)] })); continue; }
    children.push(new Paragraph({ children: inlineRuns(b.text,22), spacing: { after: 120 } }));
  }
  const doc = new Document({ sections: [{ properties: {}, children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
function slideChunks(content, maxChars = 850) {
  const blocks = parseDocumentBlocks(content).filter(b => b.type !== "blank");
  const slides = []; let current = { title: "", body: [] }, chars = 0;
  const flush = () => { if (current.title || current.body.length) slides.push(current); current = { title: "", body: [] }; chars = 0; };
  for (const b of blocks) {
    if (b.type === "heading" && b.level <= 2) { if (current.title || current.body.length) flush(); current.title = plainMarkdownText(b.text); continue; }
    const prefix = b.type === "bullet" ? "• " : b.type === "number" ? String(b.number) + ". " : "";
    const text = prefix + plainMarkdownText(b.text);
    if (chars + text.length > maxChars && current.body.length) flush();
    current.body.push(text); chars += text.length;
  }
  flush();
  return slides.length ? slides : [{ title: "", body: [plainMarkdownText(content)] }];
}
async function createPptxBytes(title, content) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "AI Stoica"; pptx.company = "Stoica Enterprises AI"; pptx.lang = "ro-RO";
  let s = pptx.addSlide(); s.background = { color: "F7F9FC" };
  s.addText(String(title || "AI Stoica"), { x:0.8,y:2.3,w:11.7,h:0.8,fontFace:"Aptos Display",fontSize:28,bold:true,color:"172033",align:"center",margin:0 });
  s.addText("Document generat cu AI Stoica", { x:1.2,y:3.25,w:10.9,h:0.4,fontFace:"Aptos",fontSize:14,color:"52627A",align:"center",margin:0 });
  for (const part of slideChunks(content)) {
    s = pptx.addSlide(); s.background = { color: "FFFFFF" };
    s.addText(part.title || String(title || "AI Stoica"), { x:0.65,y:0.45,w:12,h:0.55,fontFace:"Aptos Display",fontSize:23,bold:true,color:"172033",margin:0 });
    s.addText(part.body.join("\n"), { x:0.8,y:1.25,w:11.7,h:5.65,fontFace:"Aptos",fontSize:18,color:"26354A",valign:"top",margin:0.08,fit:"shrink",breakLine:false });
  }
  const out = await pptx.write({ outputType: "arraybuffer" });
  return Buffer.from(out);
}

function xmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function stripOuterFence(content) {
  const text=String(content||"").trim();
  const m=text.match(/^\`\`\`[^\n]*\n([\s\S]*?)\n?\`\`\`$/);
  return m ? m[1] : text;
}
function markdownTableRows(content) {
  const text=String(content||"").replace(/\r/g,"").trim();
  const raw=stripOuterFence(text);
  try {
    const parsed=JSON.parse(raw);
    if(Array.isArray(parsed) && parsed.length){
      if(parsed.every(x=>x && typeof x==="object" && !Array.isArray(x))){
        const keys=[...new Set(parsed.flatMap(x=>Object.keys(x)))];
        return [keys,...parsed.map(x=>keys.map(k=>x[k]??""))];
      }
      if(parsed.every(Array.isArray)) return parsed;
    }
  } catch {}
  const lines=text.split("\n").map(x=>x.trim()).filter(Boolean);
  const pipeLines=lines.filter(x=>x.includes("|"));
  if(pipeLines.length>=2){
    const rows=pipeLines.map(line=>line.replace(/^\|/,"").replace(/\|$/,"").split("|").map(x=>plainMarkdownText(x.trim())));
    const clean=rows.filter(row=>!row.every(cell=>/^:?-{3,}:?$/.test(String(cell).trim())));
    if(clean.length>=2) return clean;
  }
  const delimited=lines.filter(x=>x.includes("\t")||x.includes(";")||x.includes(","));
  if(delimited.length>=2){
    const delimiter=delimited.some(x=>x.includes("\t"))?"\t":delimited.some(x=>x.includes(";"))?";":",";
    return delimited.map(line=>line.split(delimiter).map(x=>x.trim().replace(/^"|"$/g,"").replace(/""/g,'"')));
  }
  const simple=lines.filter(x=>!/^#{1,6}\s/.test(x)).map(x=>[plainMarkdownText(x.replace(/^[-*•]\s+/,""))]);
  return [["Conținut"],...(simple.length?simple:[[plainMarkdownText(text)]])];
}
function excelColumnName(index) {
  let n=index+1,out="";
  while(n>0){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26);}
  return out;
}
function xlsxCellXml(value,row,col,style=0) {
  const ref=excelColumnName(col)+(row+1);
  const raw=value==null?"":value;
  const text=String(raw).trim();
  if(typeof raw==="number" || (/^-?(?:0|[1-9]\d*)(?:[.,]\d+)?$/.test(text) && !/^0\d+/.test(text))){
    const n=Number(text.replace(",","."));
    if(Number.isFinite(n)) return `<c r="${ref}" s="${style}"><v>${n}</v></c>`;
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(raw)}</t></is></c>`;
}
async function createXlsxBytes(title, content) {
  const rows=markdownTableRows(content);
  const zip=new JSZip();
  const sheetName=safeGeneratedName(title||"Foaie").replace(/[\[\]*?:\\/]/g," ").slice(0,31)||"Foaie1";
  const maxCols=Math.max(1,...rows.map(r=>r.length));
  const widths=Array.from({length:maxCols},(_,c)=>Math.min(60,Math.max(10,...rows.map(r=>String(r[c]??"").length+2))));
  const sheetData=rows.map((row,r)=>`<row r="${r+1}">${Array.from({length:maxCols},(_,c)=>xlsxCellXml(row[c]??"",r,c,r===0?1:0)).join("")}</row>`).join("");
  const cols=widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join("");
  zip.file("[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.folder("_rels").file(".rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl").file("workbook.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl").folder("_rels").file("workbook.xml.rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.folder("xl").file("styles.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`);
  zip.folder("xl").folder("worksheets").file("sheet1.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${sheetData}</sheetData></worksheet>`);
  return await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE",compressionOptions:{level:6}});
}
function csvEscape(value) {
  const s=String(value==null?"":value);
  return /[",\n\r;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function createCsvBytes(content) {
  const rows=markdownTableRows(content);
  return Buffer.from("\ufeff"+rows.map(r=>r.map(csvEscape).join(",")).join("\r\n"),"utf8");
}
function createJsonBytes(title, content) {
  const raw=stripOuterFence(content);
  try{return Buffer.from(JSON.stringify(JSON.parse(raw),null,2)+"\n","utf8");}
  catch{return Buffer.from(JSON.stringify({title:String(title||"AI Stoica"),content:String(content||"")},null,2)+"\n","utf8");}
}
function createHtmlBytes(title, content) {
  const raw=stripOuterFence(content);
  if(/^<!doctype html|^<html[\s>]/i.test(raw)) return Buffer.from(raw,"utf8");
  const body=parseDocumentBlocks(content).map(b=>{
    if(b.type==="heading")return `<h${Math.min(4,b.level)}>${xmlEscape(plainMarkdownText(b.text))}</h${Math.min(4,b.level)}>`;
    if(b.type==="bullet")return `<p>• ${xmlEscape(plainMarkdownText(b.text))}</p>`;
    if(b.type==="number")return `<p>${b.number}. ${xmlEscape(plainMarkdownText(b.text))}</p>`;
    if(b.type==="blank")return "";
    return `<p>${xmlEscape(plainMarkdownText(b.text))}</p>`;
  }).join("\n");
  return Buffer.from(`<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xmlEscape(title||"AI Stoica")}</title></head><body><main>${body}</main></body></html>`,"utf8");
}
function createXmlBytes(title, content) {
  const raw=stripOuterFence(content);
  if(/^<\?xml\b|^<[A-Za-z_][\w:.-]*(?:\s|>)/.test(raw)) return Buffer.from(raw,"utf8");
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><document><title>${xmlEscape(title||"AI Stoica")}</title><content>${xmlEscape(content)}</content></document>`,"utf8");
}
function rtfEscape(value) {
  let out="";
  for(const ch of String(value||"")){
    const cp=ch.codePointAt(0);
    if(ch==="\\")out+="\\\\";
    else if(ch==="{")out+="\\{";
    else if(ch==="}")out+="\\}";
    else if(ch==="\n")out+="\\par\n";
    else if(cp>127){const signed=cp>32767?cp-65536:cp;out+=`\\u${signed}?`;}
    else out+=ch;
  }
  return out;
}
function createRtfBytes(title, content) {
  return Buffer.from(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Segoe UI;}}\\fs24\\b ${rtfEscape(title||"AI Stoica")}\\b0\\par\\par ${rtfEscape(plainMarkdownText(content))}}`,"utf8");
}
function languageExtension(lang) {
  const map={javascript:"js",js:"js",typescript:"ts",ts:"ts",jsx:"jsx",tsx:"tsx",python:"py",py:"py",java:"java",c:"c",cpp:"cpp","c++":"cpp",csharp:"cs",cs:"cs",go:"go",rust:"rs",rs:"rs",php:"php",ruby:"rb",rb:"rb",bash:"sh",shell:"sh",sh:"sh",powershell:"ps1",ps1:"ps1",sql:"sql",html:"html",css:"css",json:"json",xml:"xml",yaml:"yaml",yml:"yml",toml:"toml",markdown:"md",md:"md",text:"txt",txt:"txt",svg:"svg",latex:"tex",tex:"tex"};
  return map[String(lang||"").toLowerCase()]||"txt";
}
function safeZipPath(value) {
  const clean=String(value||"").replace(/\\/g,"/").replace(/^\/+|\.\.(?:\/|$)/g,"").replace(/[^A-Za-z0-9._\/-]+/g,"_");
  return clean && !clean.endsWith("/") ? clean.slice(0,180) : "";
}
async function createZipBytes(title, content) {
  const zip=new JSZip();
  zip.file("README.md",String(content||""));
  const re=/\`\`\`([^\n]*)\n([\s\S]*?)\n?\`\`\`/g;
  let m,index=1;
  while((m=re.exec(String(content||"")))){
    const header=String(m[1]||"").trim();
    const explicit=(header.match(/(?:file(?:name)?\s*[:=]\s*)?([A-Za-z0-9_.\/-]+\.[A-Za-z0-9]+)$/i)||[])[1];
    const lang=header.split(/\s+/)[0];
    const name=safeZipPath(explicit)||`file-${index++}.${languageExtension(lang)}`;
    if(name!=="README.md")zip.file(name,m[2]);
  }
  return await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE",compressionOptions:{level:6}});
}
function createIpynbBytes(content) {
  const raw=stripOuterFence(content);
  try {
    const parsed=JSON.parse(raw);
    if(parsed && Array.isArray(parsed.cells)) return Buffer.from(JSON.stringify(parsed,null,2)+"\n","utf8");
  } catch {}
  const notebook={cells:[{cell_type:"markdown",metadata:{},source:String(content||"").split(/(?<=\n)/)}],metadata:{language_info:{name:"python"}},nbformat:4,nbformat_minor:5};
  return Buffer.from(JSON.stringify(notebook,null,2)+"\n","utf8");
}
function createSvgBytes(title, content) {
  const raw=stripOuterFence(content);
  if(/^<svg[\s>]/i.test(raw))return Buffer.from(raw,"utf8");
  const text=plainMarkdownText(content).replace(/\s+/g," ").slice(0,500);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#ffffff"/><text x="60" y="90" font-family="Arial, sans-serif" font-size="42" font-weight="700">${xmlEscape(title||"AI Stoica")}</text><text x="60" y="155" font-family="Arial, sans-serif" font-size="24">${xmlEscape(text)}</text></svg>`,"utf8");
}
const PLAIN_TEXT_MIME={
  md:"text/markdown; charset=utf-8",txt:"text/plain; charset=utf-8",html:"text/html; charset=utf-8",xml:"application/xml; charset=utf-8",rtf:"application/rtf",
  js:"text/javascript; charset=utf-8",ts:"text/plain; charset=utf-8",jsx:"text/javascript; charset=utf-8",tsx:"text/plain; charset=utf-8",py:"text/x-python; charset=utf-8",
  java:"text/x-java-source; charset=utf-8",c:"text/x-c; charset=utf-8",cpp:"text/x-c++src; charset=utf-8",cs:"text/plain; charset=utf-8",go:"text/plain; charset=utf-8",
  rs:"text/plain; charset=utf-8",php:"application/x-httpd-php",rb:"text/plain; charset=utf-8",sh:"text/x-shellscript; charset=utf-8",ps1:"text/plain; charset=utf-8",
  sql:"application/sql; charset=utf-8",css:"text/css; charset=utf-8",yaml:"application/yaml; charset=utf-8",yml:"application/yaml; charset=utf-8",toml:"text/plain; charset=utf-8",
  ini:"text/plain; charset=utf-8",tex:"application/x-tex; charset=utf-8"
};
const EXPORT_FORMATS=new Set(["pdf","docx","pptx","xlsx","csv","json","md","txt","html","xml","rtf","zip","ipynb","svg",...Object.keys(PLAIN_TEXT_MIME)]);
async function createExportBytes(format,title,content) {
  if(format==="pdf")return {bytes:await createPdfBytes(title,content),mime:"application/pdf"};
  if(format==="docx")return {bytes:await createDocxBytes(title,content),mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"};
  if(format==="pptx")return {bytes:await createPptxBytes(title,content),mime:"application/vnd.openxmlformats-officedocument.presentationml.presentation"};
  if(format==="xlsx")return {bytes:await createXlsxBytes(title,content),mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};
  if(format==="csv")return {bytes:createCsvBytes(content),mime:"text/csv; charset=utf-8"};
  if(format==="json")return {bytes:createJsonBytes(title,content),mime:"application/json; charset=utf-8"};
  if(format==="html")return {bytes:createHtmlBytes(title,content),mime:PLAIN_TEXT_MIME.html};
  if(format==="xml")return {bytes:createXmlBytes(title,content),mime:PLAIN_TEXT_MIME.xml};
  if(format==="rtf")return {bytes:createRtfBytes(title,content),mime:PLAIN_TEXT_MIME.rtf};
  if(format==="zip")return {bytes:await createZipBytes(title,content),mime:"application/zip"};
  if(format==="ipynb")return {bytes:createIpynbBytes(content),mime:"application/x-ipynb+json"};
  if(format==="svg")return {bytes:createSvgBytes(title,content),mime:"image/svg+xml"};
  return {bytes:Buffer.from(stripOuterFence(content),"utf8"),mime:PLAIN_TEXT_MIME[format]||"text/plain; charset=utf-8"};
}

module.exports = { safeGeneratedName, EXPORT_FORMATS, createExportBytes, markdownTableRows, parseDocumentBlocks, plainMarkdownText };
