import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT || 3010);
const baseURL = (process.env.OMNIROUTE_BASE_URL || 'http://omniroute:20128/v1').replace(/\/+$/, '');
const upstreamKey = process.env.OMNIROUTE_API_KEY || '';
const clientToken = process.env.MCP_CLIENT_TOKEN || '';
const excluded = new Set((process.env.MCP_EXCLUDED_MODELS || '').split(',').map(x => x.trim()).filter(Boolean));
const allowed = new Set((process.env.MCP_ALLOWED_MODELS || '').split(',').map(x => x.trim()).filter(Boolean));
const origins = new Set((process.env.MCP_ALLOWED_ORIGINS || 'https://claude.ai,https://www.claude.ai').split(',').map(x => x.trim()).filter(Boolean));
const maxPrompt = Math.min(24000, Math.max(1000, Number(process.env.MCP_MAX_PROMPT_CHARS || 12000)));
const maxTokens = Math.min(4096, Math.max(100, Number(process.env.MCP_MAX_OUTPUT_TOKENS || 1024)));
const limit = Math.min(120, Math.max(1, Number(process.env.MCP_REQUESTS_PER_MINUTE || 12)));
const nonChatTypes = new Set(['image','video','audio','embedding','embeddings','rerank','reranking','moderation','music','tts','speech','transcription']);
const nonChatId = /(?:^|[\/_:-])(embedding|embeddings|embed|rerank|reranker|moderation|tts|transcription|transcribe|whisper|speech-to-text|text-to-speech)(?:$|[\/_:-])/i;
if (!upstreamKey || !clientToken || clientToken.length < 32 || upstreamKey === clientToken || !/^https?:\/\//.test(baseURL)) {
  console.error('Configure independent OMNIROUTE_API_KEY, MCP_CLIENT_TOKEN (at least 32 characters), OMNIROUTE_BASE_URL.');
  process.exit(1);
}
function authenticated(header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(clientToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', ...headers });
  res.end(JSON.stringify(data));
}
function rpcError(id, code, message) { return { jsonrpc:'2.0', id:id ?? null, error:{code,message} }; }
function textResult(message, isError = false) {
  return { content:[{ type:'text', text:message }], ...(isError ? {isError:true} : {}) };
}
function canChat(x) {
  const type = String(x.type || x.object_type || x.capability || '').toLowerCase();
  return !nonChatTypes.has(type) && !nonChatId.test(x.id || '');
}
async function upstream(path, options = {}) {
  const r = await fetch(baseURL + path, {
    method:options.method || 'GET',
    headers:{ Authorization:'Bearer ' + upstreamKey, ...(options.body ? {'Content-Type':'application/json'} : {}) },
    body:options.body,
    signal:AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'OmniRoute rejected the dedicated MCP API key.' : 'OmniRoute returned HTTP ' + r.status);
  return r.json();
}
async function discover() {
  const data = await upstream('/models');
  return (Array.isArray(data.data) ? data.data : []).filter(x =>
    x && typeof x.id === 'string' && x.id && !excluded.has(x.id) && (!allowed.size || allowed.has(x.id)));
}
const toolDefs = [
  { name:'list_ai_stoica_models', description:'Get the live OmniRoute model catalogue, including all providers. Models may be unavailable, paid, or incompatible with text chat.', inputSchema:{type:'object',properties:{},additionalProperties:false} },
  { name:'ask_ai_stoica', description:'Send a standalone text question to a selected chat model in the live OmniRoute catalogue. Paid providers may charge for usage.', inputSchema:{type:'object',properties:{model:{type:'string',description:'Exact model ID from list_ai_stoica_models'},prompt:{type:'string',description:'Standalone text question. Never include secrets.'}},required:['model','prompt'],additionalProperties:false} },
];
async function invoke(name, args) {
  if (name === 'list_ai_stoica_models') {
    const models = await discover();
    return textResult(JSON.stringify({
      totalVisible:models.length,
      chatModelIds:models.filter(canChat).map(x => x.id),
      nonChatModelIds:models.filter(x => !canChat(x)).map(x => ({id:x.id,type:x.type || 'non-chat/unknown'})),
      note:'Live catalogue, not a guarantee of free credits or valid provider login. Audio, image and embeddings require separate tools.',
    }, null, 2));
  }
  if (name === 'ask_ai_stoica') {
    if (typeof args?.model !== 'string' || typeof args?.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > maxPrompt) {
      return textResult('Provide a current model ID and nonempty prompt of at most ' + maxPrompt + ' characters.', true);
    }
    const match = (await discover()).find(m => m.id === args.model);
    if (!match) return textResult('Model is not available in the current permitted OmniRoute catalogue.', true);
    if (!canChat(match)) return textResult('This model is not a supported text-chat model; use a dedicated audio, image or embeddings tool.', true);
    const data = await upstream('/chat/completions', {
      method:'POST',
      body:JSON.stringify({model:args.model,messages:[{role:'user',content:args.prompt}],max_tokens:maxTokens,stream:false}),
    });
    const raw = data?.choices?.[0]?.message?.content;
    const answer = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.filter(x => x?.type === 'text').map(x => x.text || '').join('\n') : '';
    if (!answer) return textResult('OmniRoute did not return a usable text response.', true);
    return textResult(answer + '\n\n[AI Stoica / OmniRoute: ' + args.model + ']');
  }
  return textResult('Unknown tool name.', true);
}
const requests = [];
function withinLimit() {
  const now = Date.now();
  while (requests.length && requests[0] < now - 60000) requests.shift();
  if (requests.length >= limit) return false;
  requests.push(now); return true;
}
async function readBody(req) {
  const parts = []; let length = 0;
  for await (const part of req) {
    length += part.length;
    if (length > 65536) throw new Error('Request body too large');
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz' && req.method === 'GET') return json(res, 200, {status:'ok'});
  if (req.url !== '/mcp') return json(res, 404, {error:'Not found'});
  if (req.headers.origin && !origins.has(req.headers.origin)) return json(res, 403, {error:'Origin not permitted'});
  if (req.method !== 'POST') return json(res, 405, {error:'Method not allowed'}, {allow:'POST'});
  if (!authenticated(req.headers.authorization)) return json(res, 401, {error:'Unauthorized'}, {'www-authenticate':'Bearer'});
  if (!withinLimit()) return json(res, 429, {error:'Rate limited'}, {'retry-after':'60'});
  let request;
  try { request = await readBody(req); }
  catch { return json(res, 400, rpcError(null,-32700,'Invalid or oversized JSON body.')); }
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return json(res, 400, rpcError(request?.id,-32600,'Invalid JSON-RPC request.'));
  }
  if (request.id === undefined) { res.writeHead(202, {'cache-control':'no-store'}); return res.end(); }
  let result;
  try {
    switch (request.method) {
      case 'initialize':
        result = {protocolVersion: ['2025-03-26','2025-06-18','2025-11-25','2026-07-28'].includes(request.params?.protocolVersion) ? request.params.protocolVersion : '2025-03-26', capabilities:{tools:{listChanged:false}},serverInfo:{name:'ai-stoica-omniroute',version:'0.1.0'}};
        break;
      case 'ping': result = {}; break;
      case 'tools/list': result = {tools:toolDefs}; break;
      case 'tools/call': result = await invoke(request.params?.name, request.params?.arguments || {}); break;
      default: return json(res, 200, rpcError(request.id,-32601,'Method not found.'));
    }
    return json(res, 200, {jsonrpc:'2.0',id:request.id,result});
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'OmniRoute request timed out.' : String(error?.message || 'Upstream failure');
    if (request.method === 'tools/call') return json(res, 200, {jsonrpc:'2.0',id:request.id,result:textResult(message,true)});
    return json(res, 200, rpcError(request.id,-32603,message));
  }
});
server.requestTimeout = 120000;
server.headersTimeout = 15000;
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log('AI Stoica MCP listening on ' + port));
