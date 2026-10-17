// 0.7.21: the server variables were renamed from AI_STOICA_* to SERASMART_*. A .env written before still works: every
// AI_STOICA_X that is set is copied to SERASMART_X when that one is not set. Required first by the services.
const OLD = "AI_STOICA_", NEW = "SERASMART_";
function applyEnvCompat(env = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(OLD)) continue;
    const next = NEW + key.slice(OLD.length);
    if (env[next] === undefined) env[next] = value;
  }
  return env;
}
applyEnvCompat();
module.exports = { applyEnvCompat };
