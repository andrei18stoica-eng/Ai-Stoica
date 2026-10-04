// OmniRoute watchdog (lib/omniwatch.cjs): starts a missing local OmniRoute, restarts one that keeps its port open
// but stops answering, never touches a remote OmniRoute and does not start a second copy while one check runs.
const { createOmniWatch } = require("../lib/omniwatch.cjs");
function expect(v, m) { if (!v) throw new Error(m); }

function setup({ baseUrl = "http://127.0.0.1:20128/v1", portOpen = true, alive = true, installed = true, platform = "win32", autoStart = true } = {}) {
  const state = { portOpen, alive, installed, runs: [], logs: [], clock: 1_000_000 };
  const watch = createOmniWatch({
    getConfig: () => ({ baseUrl, autoStartOmniRoute: autoStart, omniCommand: "omniroute.cmd" }),
    isPortOpen: async () => state.portOpen,
    responds: async () => state.alive,
    runOmni: (action) => { state.runs.push(action); if (action === "serve" || action === "restart") { state.portOpen = true; state.alive = true; } },
    installed: () => state.installed,
    log: (line) => state.logs.push(line),
    wait: async () => {},
    now: () => state.clock,
    platform
  });
  return { state, watch };
}

(async () => {
  // Healthy: nothing is started.
  let { state, watch } = setup();
  expect(await watch.ensure() === true && state.runs.length === 0, "a healthy OmniRoute must be left alone");

  // Port closed: "omniroute serve" once; a second call within 12 s does not spawn again.
  ({ state, watch } = setup({ portOpen: false }));
  expect(await watch.ensure() === true && state.runs.join() === "serve", "a stopped OmniRoute must be started: " + state.runs);
  state.portOpen = false;
  expect(await watch.ensure() === false && state.runs.length === 1, "no second start within 12 seconds");

  // Hung: port open, no answer → restart only after 3 failed checks in a row.
  ({ state, watch } = setup({ alive: false }));
  await watch.ensure(); await watch.ensure();
  expect(state.runs.length === 0, "one or two missed answers must not restart it");
  await watch.ensure();
  expect(state.runs.join() === "restart", "three missed answers in a row must restart it: " + state.runs);

  // An answer in between resets the count.
  ({ state, watch } = setup({ alive: false }));
  await watch.ensure(); await watch.ensure(); state.alive = true; await watch.ensure(); state.alive = false; await watch.ensure(); await watch.ensure();
  expect(state.runs.length === 0, "the failure count must reset after an answer");

  // Remote OmniRoute (a server): never started or restarted from the PC, even when it does not answer.
  ({ state, watch } = setup({ baseUrl: "https://ai.example.ro/v1", portOpen: false }));
  expect(await watch.ensure() === false && state.runs.length === 0, "a remote OmniRoute must not start a local one");
  expect(watch.target().local === false, "remote address detection");

  // Not installed: clear log line, nothing spawned.
  ({ state, watch } = setup({ portOpen: false, installed: false }));
  expect(await watch.ensure() === false && state.runs.length === 0 && /npm install -g omniroute/.test(state.logs.join()), "missing OmniRoute must be reported, not spawned");

  // Auto-start turned off, or not Windows: nothing is spawned.
  ({ state, watch } = setup({ portOpen: false, autoStart: false }));
  expect(await watch.ensure() === false && state.runs.length === 0, "auto-start off must be respected");
  ({ state, watch } = setup({ portOpen: false, platform: "linux" }));
  expect(await watch.ensure() === false && state.runs.length === 0, "only Windows starts OmniRoute from the app");

  // Tray "Repornește OmniRoute": restart even when it answers.
  ({ state, watch } = setup());
  await watch.ensure({ forceRestart: true });
  expect(state.runs.join() === "restart", "forced restart from the tray");

  // Concurrent checks share one run (the watchdog and the settings window at the same time).
  ({ state, watch } = setup({ portOpen: false }));
  await Promise.all([watch.ensureOnce(), watch.ensureOnce(), watch.ensureOnce()]);
  expect(state.runs.length === 1, "concurrent checks must start OmniRoute only once: " + state.runs);

  console.log("OmniRoute watchdog checks OK");
})().catch((e) => { console.error(e); process.exit(1); });
