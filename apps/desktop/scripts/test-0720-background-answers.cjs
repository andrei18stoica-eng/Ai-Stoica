// 0.7.20, at the Owner's request: an answer must not be cancelled when the app is minimised, put in the background or
// closed. The gateway reads the AI to the end and saves the answer in the conversation; only Stop cancels it.
const fs = require("fs"), http = require("http"), os = require("os"), path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(v, m) { if (!v) throw new Error(m); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-answers-"));
  // A slow AI: five pieces, 120 ms apart. It records whether the gateway hung up on it before the end.
  const upstream = { finished: 0, cutOff: 0 };
  const omni = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => body += c); req.on("end", async () => {
      if (req.url === "/v1/models") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ data: [{ id: "Ai principal", owned_by: "combo" }] })); }
      if (req.url !== "/v1/chat/completions") { res.statusCode = 404; return res.end("{}"); }
      res.writeHead(200, { "content-type": "text/event-stream" });
      let closed = false; res.on("close", () => { if (!res.writableFinished) { closed = true; upstream.cutOff++; } });
      for (const piece of ["Unu ", "doi ", "trei ", "patru ", "cinci."]) {
        if (closed) return;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        await sleep(120);
      }
      res.end("data: [DONE]\n\n"); upstream.finished++;
    });
  });
  const omniPort = await listen(omni);
  const cfg = { baseUrl: `http://127.0.0.1:${omniPort}/v1`, apiKey: "k", model: "Ai principal", webSearchEnabled: false, githubAutoContext: false, directChatEnabled: false };
  const gw = startLocalGateway({ dataDir: dir, port: 8885, host: "127.0.0.1", getOmniConfig: () => cfg });
  const base = "http://127.0.0.1:8885";
  const call = async (p, { method = "GET", body, token } = {}) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  try {
    const token = (await call("/auth/register", { method: "POST", body: { email: "ana@example.com", password: "password123", name: "Ana" } })).j.token;
    const conv = (await call("/api/conversations", { method: "POST", token, body: { title: "Test", messages: [{ id: "u1", role: "user", content: "Numără până la cinci." }] } })).j.data;
    // Starts an answer and closes the page after the first piece arrives.
    async function startAndLeave(requestId, extra = {}) {
      const ctl = new AbortController();
      const r = await fetch(base + "/api/chat/stream", { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({ model: "Ai principal", conversationId: conv.id, ...(requestId ? { requestId } : {}), messages: [{ role: "user", content: "Numără până la cinci." }], ...extra }) });
      const reader = r.body.getReader(); let got = "";
      while (!got.includes("Unu")) { const { value } = await reader.read(); got += new TextDecoder().decode(value); }
      ctl.abort();
      return got;
    }

    // 1. The page closes after "Unu": the answer is finished and saved under the id the app gave it.
    await startAndLeave("answer-1");
    let job;
    for (let i = 0; i < 40; i++) { job = (await call("/api/chat/jobs/answer-1", { token })).j.data; if (job?.status !== "running") break; await sleep(100); }
    expect(job?.status === "done" && job.text === "Unu doi trei patru cinci.", "the answer was finished in the background: " + JSON.stringify(job));
    let saved = (await call("/api/conversations", { token })).j.data.find((c) => c.id === conv.id);
    const answer = saved.messages.find((m) => m.id === "answer-1");
    expect(answer && answer.role === "assistant" && answer.content === "Unu doi trei patru cinci." && answer.streaming === false && answer.routeInfo?.model === "Ai principal", "the answer is in the conversation: " + JSON.stringify(answer));
    expect(upstream.cutOff === 0 && upstream.finished === 1, "the AI was read to the end");
    const list = (await call("/api/chat/jobs", { token })).j.data;
    expect(list.some((x) => x.id === "answer-1" && x.conversationId === conv.id), "the app can list the answers in progress");

    // 2. Stop cancels it on the server: nothing more is read and nothing is saved.
    const ctl = new AbortController();
    const r = await fetch(base + "/api/chat/stream", { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ model: "Ai principal", conversationId: conv.id, requestId: "answer-2", messages: [{ role: "user", content: "x" }] }) });
    const rd = r.body.getReader(); let first = ""; while (!first.includes("Unu")) first += new TextDecoder().decode((await rd.read()).value);
    expect((await call("/api/chat/cancel", { method: "POST", token, body: { id: "answer-2" } })).j.found === true, "Stop finds the answer");
    ctl.abort();
    await sleep(500);
    job = (await call("/api/chat/jobs/answer-2", { token })).j.data;
    saved = (await call("/api/conversations", { token })).j.data.find((c) => c.id === conv.id);
    expect(job?.status === "cancelled" && !saved.messages.some((m) => m.id === "answer-2") && upstream.cutOff === 1, "Stop stopped the AI and saved nothing: " + JSON.stringify(job));

    // 3. An older app (no requestId) keeps the old rule: closing the page cancels.
    await startAndLeave("");
    await sleep(500);
    expect(upstream.cutOff === 2, "without a requestId a closed page still cancels");

    // 4. Another account cannot see or stop someone else's answer, nor write into their conversation.
    const other = (await call("/auth/register", { method: "POST", body: { email: "bob@example.com", password: "password123", name: "Bob" } })).j.token;
    expect((await call("/api/chat/jobs/answer-1", { token: other })).status === 404, "someone else's answer is hidden");
    expect((await call("/api/chat/cancel", { method: "POST", token: other, body: { id: "answer-1" } })).j.found === false, "and cannot be stopped by another account");
    const ctl3 = new AbortController();
    const r3 = await fetch(base + "/api/chat/stream", { method: "POST", signal: ctl3.signal, headers: { "content-type": "application/json", authorization: "Bearer " + other }, body: JSON.stringify({ model: "Ai principal", conversationId: conv.id, requestId: "intruder-1", messages: [{ role: "user", content: "x" }] }) });
    await r3.text();
    expect((await call("/api/chat/jobs/intruder-1", { token: other })).status === 404, "a conversation that is not yours gets no background job");
    saved = (await call("/api/conversations", { token })).j.data.find((c) => c.id === conv.id);
    expect(!saved.messages.some((m) => m.id === "intruder-1"), "and nothing is written into it");

    // 5. The app's own save after the answer replaces the server's copy (same id), no duplicate.
    const msgs = saved.messages.map((m) => m.id === "answer-1" ? { ...m, content: m.content + " (salvat de aplicație)" } : m);
    await call(`/api/conversations/${conv.id}`, { method: "PUT", token, body: { title: saved.title, messages: msgs } });
    saved = (await call("/api/conversations", { token })).j.data.find((c) => c.id === conv.id);
    expect(saved.messages.filter((m) => m.id === "answer-1").length === 1, "one copy of the answer");

    // The window keeps working when minimised (Windows): background throttling is off.
    expect(/backgroundThrottling:\s*false/.test(fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf8")), "Electron window is not throttled in the background");
    const ui = fs.readFileSync(path.join(__dirname, "..", "renderer", "src", "main.jsx"), "utf8");
    expect(/requestId:assistantMessage\.id/.test(ui) && /\/api\/chat\/cancel/.test(ui) && /resumeServerJobs\(\)/.test(ui) && /requestId:base\.id/.test(ui), "the app sends the id, Stop cancels on the server, open apps pick answers up again");
    console.log("0.7.20 background answers OK");
  } finally {
    await gw.close(); omni.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
