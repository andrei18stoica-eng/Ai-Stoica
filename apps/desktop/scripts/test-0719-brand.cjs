// 0.7.19: the public name is Serasmart AI, kept in one place (lib/brand.json). No text a person sees may still say
// "AI Stoica"; technical names (AI_STOICA_* variables, data files, the installer's productName) stay as they were.
const fs = require("fs"), os = require("os"), path = require("path");
const parser = require("@babel/parser");

function expect(v, m) { if (!v) throw new Error(m); }
const root = path.join(__dirname, "..", "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const brand = require("../lib/brand.json");

// One place: the gateway, the interface and AI Stoica Cloud agree on the defaults.
expect(brand.name === "Serasmart AI" && brand.short === "Serasmart" && brand.domain, "brand.json: " + JSON.stringify(brand));
const lib = require("../lib/brand.cjs");
expect(lib.BRAND_NAME === brand.name && lib.BRAND_SHORT === brand.short && lib.BRAND_DOMAIN === brand.domain, "lib/brand.cjs reads brand.json");
const serverBrand = read("apps/server/brand.cjs");
for (const v of [brand.name, brand.short, brand.domain]) expect(serverBrand.includes(`"${v}"`), `apps/server/brand.cjs has the default ${v}`);
expect(/import brand from "\.\.\/\.\.\/lib\/brand\.json"/.test(read("apps/desktop/renderer/src/brand.js")), "the interface reads brand.json");
expect(/COPY apps\/desktop\/lib\/brand\.json \.\/lib\/brand\.json/.test(read("apps/cloud/Dockerfile")), "the web build in Docker gets brand.json");
expect(/COPY apps\/server\/brand\.cjs/.test(read("apps/server/Dockerfile")), "the server image gets brand.cjs");

// No visible text with the old name: strings, template text and JSX text, read through the parser (comments do not count).
const OLD = /AI Stoica|AI STOICA|Stoica Enterprises/;
function visibleOld(file) {
  const src = read(file), found = [];
  const ast = parser.parse(src, { sourceType: "unambiguous", plugins: ["jsx"] });
  (function walk(n) {
    if (!n || typeof n.type !== "string") return;
    if ((n.type === "StringLiteral" && OLD.test(n.value)) || (n.type === "TemplateElement" && OLD.test(n.value.raw)) || (n.type === "JSXText" && OLD.test(n.value))) found.push(src.slice(n.start, n.end).slice(0, 80));
    for (const k of Object.keys(n)) {
      if (["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments"].includes(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === "string") walk(v);
    }
  })(ast.program);
  return found;
}
const sources = [
  "apps/desktop/local-gateway.cjs", "apps/desktop/main.cjs",
  ...fs.readdirSync(path.join(root, "apps/desktop/lib")).filter(f => f.endsWith(".cjs")).map(f => "apps/desktop/lib/" + f),
  ...fs.readdirSync(path.join(root, "apps/desktop/renderer/src")).filter(f => /\.(jsx|mjs|js)$/.test(f)).map(f => "apps/desktop/renderer/src/" + f),
  ...fs.readdirSync(path.join(root, "apps/desktop/renderer/src/pages")).filter(f => f.endsWith(".jsx")).map(f => "apps/desktop/renderer/src/pages/" + f),
  "apps/server/server.cjs", "apps/server/mailer.cjs", "apps/server/push.cjs"
];
const left = sources.flatMap(f => visibleOld(f).map(x => `${f}: ${x}`));
expect(!left.length, "text that still says the old name:\n" + left.join("\n"));

// Static files the bundler does not touch say the same name as brand.json.
for (const f of ["apps/desktop/renderer/index.html", "apps/desktop/renderer/public/manifest.webmanifest", "apps/desktop/renderer/public/sw.js", "apps/mobile/app.json"]) {
  const s = read(f);
  expect(s.includes(brand.name) && !OLD.test(s.replace(/AI Stoica Performance Max/g, "")), `${f} uses ${brand.name}`);
}
const mobile = read("apps/mobile/app/index.js").replace(/AI Stoica Performance Max/g, "");
expect(!OLD.test(mobile) && mobile.includes(brand.name), "the phone app shows the new name (the model id stays)");
expect(!OLD.test(read("apps/cloudflare/src/index.js").replace(/AI Stoica Performance Max/g, "")), "the Cloudflare Worker shows the new name");

// The Windows installer keeps its technical name, so the data folder and the automatic updates stay the same.
expect(JSON.parse(read("apps/desktop/package.json")).build.productName === "AI Stoica", "productName stays (data folder, updates)");

// The default assistant saved under the old name is renamed when the service starts.
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-"));
  try {
    fs.writeFileSync(path.join(dir, "ai-stoica-data.json"), JSON.stringify({ users: [], assistants: [
      { id: "a1", userId: "u1", name: "AI Stoica", builtIn: true, systemPrompt: "Ești AI Stoica, asistentul principal AI Stoica. Răspunde clar." },
      { id: "a2", userId: "u1", name: "AI Stoica Code", codeAssistant: true },
      { id: "a3", userId: "u1", name: "Contabil", systemPrompt: "x" }
    ] }));
    const { startLocalGateway } = require("../local-gateway.cjs");
    const gw = startLocalGateway({ dataDir: dir, port: 8884, host: "127.0.0.1", getOmniConfig: () => ({}) });
    await new Promise(r => setTimeout(r, 200));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "ai-stoica-data.json"), "utf8")).assistants;
    await gw.close();
    expect(saved[0].name === "Serasmart AI" && /^Ești Serasmart AI, asistentul AI principal/.test(saved[0].systemPrompt), "the default assistant: " + JSON.stringify(saved[0]));
    expect(saved[1].name === "Serasmart Code" && saved[2].name === "Contabil", "the Code assistant is renamed, the user's own are not");
    console.log("0.7.19 brand OK");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
