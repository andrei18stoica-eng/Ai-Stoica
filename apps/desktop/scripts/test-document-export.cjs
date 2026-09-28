const fs = require("fs");
const os = require("os");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const { startLocalGateway } = require("../local-gateway.cjs");

async function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stoica-doc-test-"));
  const port = 8797;
  const gateway = startLocalGateway({
    dataDir,
    port,
    host: "127.0.0.1",
    getOmniConfig: () => ({ baseUrl: "http://127.0.0.1:65530/v1", apiKey: "", model: "Ai principal" })
  });
  const base = `http://127.0.0.1:${port}`;
  await new Promise(r => setTimeout(r, 250));

  try {
    let r = await fetch(base + "/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test", email: "document-test@example.com", password: "TestPass123!" })
    });
    const auth = await r.json();
    await expect(r.ok && auth.token, "Autentificarea de test a eșuat.");
    const headers = { "content-type": "application/json", authorization: "Bearer " + auth.token };

    const content = [
      "# Raport pentru AI Stoica",
      "",
      "Acesta este un test cu diacritice românești: ă â î ș ț Ă Â Î Ș Ț.",
      "",
      "## Elemente",
      "- Primul punct",
      "- Al doilea punct",
      "",
      "1. Pasul unu",
      "2. Pasul doi",
      "",
      "**Text important** și `cod`."
    ].join("\n");

    for (const format of ["pdf", "docx", "pptx"]) {
      r = await fetch(base + "/api/export", {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Test document românesc", content, format })
      });
      const exported = await r.json();
      await expect(r.ok && exported.data?.id, `Exportul ${format} a eșuat: ${JSON.stringify(exported)}`);
      await expect(exported.data.name.endsWith("." + format), `Extensie greșită pentru ${format}`);

      const dl = await fetch(base + "/api/files/" + exported.data.id, {
        headers: { authorization: "Bearer " + auth.token }
      });
      await expect(dl.ok, `Descărcarea ${format} a eșuat cu HTTP ${dl.status}`);
      const buf = Buffer.from(await dl.arrayBuffer());
      await expect(buf.length > 500, `Fișierul ${format} este prea mic / gol.`);

      if (format === "pdf") {
        await expect(buf.subarray(0, 5).toString() === "%PDF-", "PDF-ul nu are semnătură PDF validă.");
        const pdf = await PDFDocument.load(buf);
        await expect(pdf.getPageCount() >= 1, "PDF-ul nu are pagini.");
      } else {
        await expect(buf[0] === 0x50 && buf[1] === 0x4b, `${format} nu este un container ZIP Office valid.`);
        const marker = format === "docx" ? "word/document.xml" : "ppt/presentation.xml";
        await expect(buf.includes(Buffer.from(marker)), `${format} nu conține structura Office așteptată: ${marker}`);
      }

      console.log(`OK ${format.toUpperCase()}: ${exported.data.name} (${buf.length} bytes)`);
    }

    console.log("ALL_DOCUMENT_EXPORT_TESTS_PASSED");
  } finally {
    await gateway.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
