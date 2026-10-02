const path = require("path");
const { startLocalGateway } = require("./local-gateway.cjs");

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const dataDir = process.env.DATA_DIR || "/data";

function getOmniConfig() {
  return {
    baseUrl: String(process.env.OMNIROUTE_BASE_URL || "http://omniroute:20128/v1").replace(/\/+$/, ""),
    apiKey: process.env.OMNIROUTE_API_KEY || "",
    model: process.env.AI_STOICA_MODEL || "cerebras/gpt-oss-120b",
    speechModel: process.env.AI_STOICA_SPEECH_MODEL || "openai/whisper-1",
    speechLanguage: process.env.AI_STOICA_SPEECH_LANGUAGE || "ro",
    // Public server: only the first account can sign up unless AI_STOICA_OPEN_REGISTRATION=true.
    allowRegistration: String(process.env.AI_STOICA_OPEN_REGISTRATION || "").toLowerCase() === "true"
  };
}

const gateway = startLocalGateway({
  dataDir,
  port,
  host,
  serviceName: "AI Stoica Cloud Gateway",
  getOmniConfig
});

console.log(`AI Stoica Cloud Gateway listening on ${host}:${port}`);

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down AI Stoica Cloud Gateway...`);
  try { await gateway.close(); } finally { process.exit(0); }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
