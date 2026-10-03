// Keeps the OmniRoute on this PC running: starts it when its port is closed and restarts it when the process keeps the
// port open but stops answering. A remote OmniRoute (a server) is never started or restarted from here.
// Everything that touches the system is passed in, so the logic can be tested without Electron or Windows.
function createOmniWatch({ getConfig, isPortOpen, responds, runOmni, installed, log = () => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), platform = process.platform, failuresBeforeRestart = 3 }) {
  let lastSpawn = 0, unhealthy = 0, running = null;

  function target() {
    try {
      const u = new URL(String(getConfig().baseUrl || ""));
      return { port: Number(u.port || (u.protocol === "https:" ? 443 : 80)), local: ["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname.toLowerCase()) };
    } catch { return { port: 20128, local: true }; }
  }
  async function waitForPort(port) {
    for (let i = 0; i < 30; i++) { await wait(650); if (await isPortOpen(port)) return true; }
    return false;
  }

  async function ensure({ forceRestart = false } = {}) {
    const cfg = getConfig();
    const { port, local } = target();
    const canManage = local && !!cfg.autoStartOmniRoute && platform === "win32";
    if (await isPortOpen(port)) {
      if (!forceRestart) {
        if (!local || await responds()) { unhealthy = 0; return true; }
        // Three checks in a row without an answer (about 90 seconds with the 30-second watchdog): restart it.
        unhealthy++;
        if (unhealthy < failuresBeforeRestart || !canManage) return true;
      } else if (!(local && platform === "win32")) return true;
      unhealthy = 0; lastSpawn = now();
      log("OmniRoute nu mai răspunde sau a fost cerută repornirea: rulez «omniroute restart».");
      runOmni("restart");
      return waitForPort(port);
    }
    if (!canManage) return false;
    if (now() - lastSpawn < 12000) return false;
    if (installed() === false) { log(`OmniRoute nu este instalat (${String(cfg.omniCommand || "omniroute.cmd")} lipsește). Instalează-l cu: npm install -g omniroute`); return false; }
    lastSpawn = now();
    runOmni("serve");
    return waitForPort(port);
  }

  // One check at a time: the watchdog, the tray menu and the settings window share the same run.
  function ensureOnce(opts) {
    if (!running) running = ensure(opts).catch(() => false).finally(() => { running = null; });
    return running;
  }

  return { ensure, ensureOnce, target };
}

module.exports = { createOmniWatch };
