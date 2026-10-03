// Outbound requests to addresses chosen by users or web pages (plugins, links, search results).
// Private, loopback, link-local, CGNAT and unique-local networks are refused. DNS is resolved
// before connecting and the checked address is the one actually used, so a name cannot switch
// to a local address between the check and the connection. Redirects are followed manually
// (max 5) and every hop is checked again.
const dns = require("dns");
const net = require("net");
const http = require("http");
const https = require("https");
const zlib = require("zlib");

const blocked = new net.BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 128], ["::1", 128], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]]) blocked.addSubnet(a, p, "ipv6");

function ipv6Words(ip) {
  let s = String(ip).toLowerCase().split("%")[0];
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) { const q = tail[1].split(".").map(Number); s = s.slice(0, -tail[1].length) + ((q[0] << 8) | q[1]).toString(16) + ":" + ((q[2] << 8) | q[3]).toString(16); }
  const [head, rest] = s.split("::");
  const a = head ? head.split(":") : [], b = rest !== undefined && rest ? rest.split(":") : [];
  const fill = rest !== undefined ? Array(Math.max(0, 8 - a.length - b.length)).fill("0") : [];
  return [...a, ...fill, ...b].map((x) => parseInt(x || "0", 16) || 0);
}
function embeddedIpv4(ip) {
  const w = ipv6Words(ip);
  const v4 = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return v4(w[6], w[7]);
  if (w[0] === 0x64 && w[1] === 0xff9b) return v4(w[6], w[7]);
  if (w[0] === 0x2002) return v4(w[1], w[2]);
  return "";
}
function isBlockedAddress(ip) {
  const clean = String(ip || "").replace(/^\[|\]$/g, "");
  const kind = net.isIP(clean);
  if (kind === 4) return blocked.check(clean, "ipv4");
  if (kind === 6) {
    const v4 = embeddedIpv4(clean);
    if (v4 && net.isIP(v4) === 4 && blocked.check(v4, "ipv4")) return true;
    return blocked.check(clean, "ipv6");
  }
  return true;
}

function blockedError(host) {
  const e = new Error(`Adresa ${host} este blocată: AI Stoica nu accesează rețele locale sau private.`);
  e.code = "EBLOCKED"; e.status = 403;
  return e;
}

function guardedLookup(isBlocked) {
  return (hostname, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    const opts = typeof options === "object" && options ? options : {};
    dns.lookup(hostname, { all: true, verbatim: true }, (err, list) => {
      if (err) return cb(err);
      const rows = (list || []).filter((x) => !(opts.family && x.family !== opts.family));
      if (!rows.length) return cb(Object.assign(new Error(`Nu am putut rezolva adresa ${hostname}.`), { code: "ENOTFOUND" }));
      if (rows.some((x) => isBlocked(x.address))) return cb(blockedError(hostname));
      if (opts.all) return cb(null, rows);
      cb(null, rows[0].address, rows[0].family);
    });
  };
}

// Unpacks gzip/deflate/br without ever holding more than maxBytes. With truncate, a page that is too big
// (or whose compressed body was cut at maxBytes) still gives its first maxBytes instead of an error.
function decodeBody(buf, encoding, maxBytes, truncate) {
  const enc = String(encoding || "").toLowerCase().trim();
  const make = enc === "gzip" || enc === "x-gzip" ? () => zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH })
    : enc === "deflate" ? () => zlib.createInflate({ finishFlush: zlib.constants.Z_SYNC_FLUSH })
    : enc === "br" ? () => zlib.createBrotliDecompress({ finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH })
    : null;
  if (!make) return Promise.resolve(buf);
  const run = (factory) => new Promise((resolve, reject) => {
    const out = []; let size = 0, settled = false;
    const z = factory();
    const done = (err) => {
      if (settled) return; settled = true;
      const data = Buffer.concat(out);
      if (err && !(truncate && data.length)) return reject(err);
      resolve(data.length > maxBytes ? data.subarray(0, maxBytes) : data);
    };
    z.on("data", (c) => {
      size += c.length; out.push(c);
      if (size > maxBytes) {
        if (!truncate) { settled = true; z.destroy(); return reject(Object.assign(new Error("Răspunsul este prea mare."), { code: "ETOOLARGE" })); }
        z.destroy(); done();
      }
    });
    z.on("end", () => done());
    z.on("error", (e) => done(e));
    z.end(buf);
  });
  if (enc === "deflate") return run(make).catch(() => run(() => zlib.createInflateRaw({ finishFlush: zlib.constants.Z_SYNC_FLUSH })));
  return run(make);
}

function oneRequest(url, { method, headers, body, signal, maxBytes, truncate, isBlocked }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isBlocked(host)) return reject(blockedError(host));
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request({
      protocol: u.protocol, hostname: host, port: u.port || undefined, path: u.pathname + u.search, method,
      headers: { "accept-encoding": "gzip, deflate, br", ...headers, ...(body != null ? { "content-length": Buffer.byteLength(body) } : {}) },
      lookup: guardedLookup(isBlocked), agent: false, servername: net.isIP(host) ? undefined : host
    }, (res) => {
      const chunks = []; let size = 0, done = false;
      const finish = (partial) => {
        if (done) return; done = true;
        decodeBody(Buffer.concat(chunks), res.headers["content-encoding"], maxBytes, truncate)
          .then((buf) => resolve({ status: res.statusCode, headers: res.headers, buffer: buf, truncated: !!partial || buf.length >= maxBytes }))
          .catch(reject);
      };
      res.on("data", (c) => {
        size += c.length;
        if (size > maxBytes) {
          if (!truncate) { done = true; req.destroy(); return reject(Object.assign(new Error("Răspunsul este prea mare."), { code: "ETOOLARGE" })); }
          chunks.push(c.subarray(0, c.length - (size - maxBytes)));
          req.destroy(); return finish(true);
        }
        chunks.push(c);
      });
      res.on("end", () => finish(false));
      res.on("error", (e) => { if (!done) { done = true; reject(e); } });
      res.on("aborted", () => { if (!done) { done = true; reject(new Error("Conexiunea a fost întreruptă.")); } });
    });
    const onAbort = () => req.destroy(signal.reason instanceof Error ? signal.reason : Object.assign(new Error("Cererea a fost anulată."), { name: "AbortError" }));
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener("abort", onAbort, { once: true }); req.on("close", () => signal.removeEventListener("abort", onAbort)); }
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

// Returns {ok,status,url,headers:{get},text(),json(),buffer}. Never throws for HTTP error codes.
async function safeRequest(url, opts = {}) {
  const maxRedirects = opts.maxRedirects ?? 5;
  const isBlocked = opts.isBlocked || isBlockedAddress;
  const timeout = Number(opts.timeout || 15000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  let current = String(url), method = String(opts.method || "GET").toUpperCase(), body = opts.body ?? null;
  let headers = { "user-agent": "AI-Stoica/0.7 (+desktop assistant)", ...(opts.headers || {}) };
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = new URL(current);
    if (!["http:", "https:"].includes(u.protocol)) throw Object.assign(new Error("Sunt permise doar adrese http și https."), { code: "EBLOCKED", status: 400 });
    const r = await oneRequest(current, { method, headers, body, signal, maxBytes: Number(opts.maxBytes || 5 * 1024 * 1024), truncate: !!opts.truncate, isBlocked });
    const location = r.headers.location;
    if ([301, 302, 303, 307, 308].includes(r.status) && location) {
      if (hop === maxRedirects) throw Object.assign(new Error("Prea multe redirecționări."), { code: "EREDIRECT" });
      const next = new URL(location, current);
      if (next.origin !== u.origin) { const h = { ...headers }; for (const k of Object.keys(h)) if (/^(authorization|cookie|x-api-key|proxy-authorization)$/i.test(k)) delete h[k]; headers = h; }
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && method === "POST")) { method = "GET"; body = null; const h = { ...headers }; for (const k of Object.keys(h)) if (/^content-(type|length)$/i.test(k)) delete h[k]; headers = h; }
      current = next.toString();
      continue;
    }
    const buf = r.buffer;
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status, url: current, truncated: r.truncated, buffer: buf,
      headers: { get: (k) => { const v = r.headers[String(k).toLowerCase()]; return Array.isArray(v) ? v.join(", ") : v ?? null; } },
      text: async () => buf.toString("utf8"),
      json: async () => JSON.parse(buf.toString("utf8"))
    };
  }
  throw Object.assign(new Error("Prea multe redirecționări."), { code: "EREDIRECT" });
}

module.exports = { isBlockedAddress, safeRequest, embeddedIpv4 };
