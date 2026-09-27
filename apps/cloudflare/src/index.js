const enc = new TextEncoder();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS"
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders, ...extra }
  });
}

function uuid() { return crypto.randomUUID(); }
function now() { return Date.now(); }
function normalizeEmail(v) { return String(v || "").trim().toLowerCase(); }
function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function randomHex(bytes = 32) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return hex(a); }
async function sha256(v) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(v)))); }

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g).map(x => parseInt(x, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 120000 },
    key,
    256
  );
  return hex(bits);
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const t = now();
  await env.DB.prepare(
    "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)"
  ).bind(tokenHash, userId, t + 30 * 86400000, t).run();
  return token;
}

async function authenticate(request, env) {
  const raw = request.headers.get("authorization") || "";
  if (!raw.startsWith("Bearer ")) return null;
  const tokenHash = await sha256(raw.slice(7));
  const row = await env.DB.prepare(
    `SELECT u.id,u.email,u.name,u.created_at
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.expires_at>?`
  ).bind(tokenHash, now()).first();
  return row || null;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.created_at };
}

async function bodyJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function parseMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(m => m && ["user","assistant","system"].includes(m.role))
    .map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : String(m.content ?? "") }))
    .filter(m => m.content.trim());
}

function performanceContext(messages, maxMessages = 80, maxChars = 320000) {
  const src = parseMessages(messages);
  const out = [];
  let chars = 0;
  for (let i = src.length - 1; i >= 0 && out.length < maxMessages; i--) {
    const m = src[i];
    if (chars + m.content.length > maxChars && out.length) break;
    chars += m.content.length;
    out.unshift(m);
  }
  return out;
}

async function relevantMemories(env, userId, latest, limit = 16) {
  const rows = await env.DB.prepare(
    "SELECT id,text,pinned,source,created_at FROM memories WHERE user_id=? ORDER BY pinned DESC, created_at DESC LIMIT 80"
  ).bind(userId).all();
  const words = [...new Set(String(latest || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").match(/[a-z0-9]{4,}/g) || [])];
  return (rows.results || [])
    .map(m => {
      const h = String(m.text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
      let score = m.pinned ? 20 : 0;
      for (const w of words) if (h.includes(w)) score += 2;
      return { ...m, score };
    })
    .filter(m => m.score > 0 || m.pinned)
    .sort((a,b) => b.score - a.score || b.created_at - a.created_at)
    .slice(0, limit);
}

function extractText(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (typeof data.response === "string") return data.response;
  if (typeof data.output_text === "string") return data.output_text;
  if (typeof data.text === "string") return data.text;
  const choice = data.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  if (Array.isArray(data.output)) {
    return data.output.flatMap(x => x?.content || []).map(x => x?.text || x?.content || "").join("").trim();
  }
  return "";
}

async function callCloudflare(env, messages) {
  const model = env.CF_MODEL || "@cf/openai/gpt-oss-120b";
  const result = await env.AI.run(model, {
    messages,
    max_tokens: Number(env.AI_STOICA_MAX_OUTPUT || 4096),
    temperature: Number(env.AI_STOICA_TEMPERATURE || 0.35)
  });
  const text = extractText(result);
  if (!text) throw new Error("Cloudflare AI a răspuns fără text.");
  return { text, provider: "cloudflare", model, raw: result };
}

async function callOpenAICompatible({ baseUrl, apiKey, model, messages, provider, maxOutput }) {
  const r = await fetch(baseUrl.replace(/\/+$/,"") + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.35,
      max_tokens: maxOutput
    }),
    signal: AbortSignal.timeout(90000)
  });
  const textBody = await r.text();
  if (!r.ok) throw new Error(`${provider} HTTP ${r.status}: ${textBody.slice(0,300)}`);
  let data; try { data = JSON.parse(textBody); } catch { data = {}; }
  const text = extractText(data);
  if (!text) throw new Error(`${provider} a răspuns fără text.`);
  return { text, provider, model, raw: data };
}

async function routeAI(env, messages) {
  const errors = [];
  try {
    return await callCloudflare(env, messages);
  } catch (e) {
    errors.push("Cloudflare: " + e.message);
  }

  const maxOutput = Number(env.AI_STOICA_MAX_OUTPUT || 4096);
  const fallbacks = [
    env.GROQ_API_KEY && {
      provider: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL || "openai/gpt-oss-120b"
    },
    env.CEREBRAS_API_KEY && {
      provider: "cerebras",
      baseUrl: "https://api.cerebras.ai/v1",
      apiKey: env.CEREBRAS_API_KEY,
      model: env.CEREBRAS_MODEL || "gpt-oss-120b"
    },
    env.GEMINI_API_KEY && {
      provider: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL || "gemini-2.5-pro"
    }
  ].filter(Boolean);

  for (const p of fallbacks) {
    try {
      return await callOpenAICompatible({ ...p, messages, maxOutput });
    } catch (e) {
      errors.push(p.provider + ": " + e.message);
    }
  }
  throw new Error("Toate motoarele AI au eșuat. " + errors.join(" | "));
}

async function chatMessages(env, user, incoming) {
  const raw = performanceContext(incoming, Number(env.AI_STOICA_MAX_HISTORY || 80), Number(env.AI_STOICA_MAX_CONTEXT_CHARS || 320000));
  const latest = [...raw].reverse().find(m => m.role === "user")?.content || "";
  const memories = await relevantMemories(env, user.id, latest, 16);
  const system = [
    "Ești AI Stoica, asistentul principal Stoica Enterprises AI.",
    "Răspunde în limba utilizatorului, riguros, clar și complet.",
    "Folosește capacitatea maximă de raționament disponibilă. Nu simplifica doar pentru a economisi resurse.",
    memories.length ? "Memorie relevantă:\n" + memories.map((m,i)=>`${i+1}. ${m.text}`).join("\n") : ""
  ].filter(Boolean).join("\n\n");
  return [{ role: "system", content: system }, ...raw.filter(m => m.role !== "system")];
}

async function handleAuthRegister(request, env) {
  const b = await bodyJson(request);
  const email = normalizeEmail(b.email), password = String(b.password || ""), name = String(b.name || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error:"Email invalid." },400);
  if (password.length < 8) return json({ error:"Parola trebuie să aibă minimum 8 caractere." },400);
  const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
  if (exists) return json({ error:"Contul există deja." },409);
  const salt = randomHex(16), passwordHash = await hashPassword(password, salt);
  const user = { id:uuid(), email, name:name || email.split("@")[0], created_at:now() };
  await env.DB.prepare(
    "INSERT INTO users(id,email,name,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?)"
  ).bind(user.id,user.email,user.name,passwordHash,salt,user.created_at).run();
  const token = await createSession(env,user.id);
  return json({ token, user:publicUser(user) });
}

async function handleAuthLogin(request, env) {
  const b=await bodyJson(request), email=normalizeEmail(b.email), password=String(b.password||"");
  const u=await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
  if(!u) return json({error:"Email sau parolă incorectă."},401);
  const hash=await hashPassword(password,u.password_salt);
  if(hash!==u.password_hash) return json({error:"Email sau parolă incorectă."},401);
  const token=await createSession(env,u.id);
  return json({token,user:publicUser(u)});
}

async function requireUser(request, env) {
  const user=await authenticate(request,env);
  return user;
}

async function router(request, env) {
  if (request.method === "OPTIONS") return new Response(null,{status:204,headers:corsHeaders});
  const url=new URL(request.url), p=url.pathname;

  if(p==="/health"){
    return json({
      ok:true,
      service:"AI Stoica Cloudflare",
      mode:"performance-max",
      primaryModel:env.CF_MODEL || "@cf/openai/gpt-oss-120b",
      fallbacks:{
        groq:!!env.GROQ_API_KEY,
        cerebras:!!env.CEREBRAS_API_KEY,
        gemini:!!env.GEMINI_API_KEY
      }
    });
  }

  if(p==="/auth/register" && request.method==="POST") return handleAuthRegister(request,env);
  if(p==="/auth/login" && request.method==="POST") return handleAuthLogin(request,env);

  const user=await requireUser(request,env);
  if(!user) return json({error:"Autentificare necesară."},401);

  if(p==="/auth/me" && request.method==="GET"){
    const token=await createSession(env,user.id);
    return json({token,user:publicUser(user)});
  }

  if(p==="/api/models" && request.method==="GET"){
    return json({data:[
      {id:env.CF_MODEL || "@cf/openai/gpt-oss-120b",provider:"cloudflare",primary:true},
      ...(env.GROQ_API_KEY?[{id:env.GROQ_MODEL||"openai/gpt-oss-120b",provider:"groq"}]:[]),
      ...(env.CEREBRAS_API_KEY?[{id:env.CEREBRAS_MODEL||"gpt-oss-120b",provider:"cerebras"}]:[]),
      ...(env.GEMINI_API_KEY?[{id:env.GEMINI_MODEL||"gemini-2.5-pro",provider:"gemini"}]:[])
    ]});
  }

  if(p==="/api/conversations" && request.method==="GET"){
    const r=await env.DB.prepare(
      "SELECT id,title,model,messages_json,summary,created_at,updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC"
    ).bind(user.id).all();
    return json({data:(r.results||[]).map(x=>({
      id:x.id,title:x.title,model:x.model,messages:JSON.parse(x.messages_json||"[]"),
      summary:x.summary||"",createdAt:x.created_at,updatedAt:x.updated_at
    }))});
  }

  if(p==="/api/conversations" && request.method==="POST"){
    const b=await bodyJson(request), t=now();
    const item={id:uuid(),title:String(b.title||"Conversație nouă"),model:String(b.model||env.CF_MODEL||"@cf/openai/gpt-oss-120b"),messages:Array.isArray(b.messages)?b.messages:[],summary:"",createdAt:t,updatedAt:t};
    await env.DB.prepare(
      "INSERT INTO conversations(id,user_id,title,model,messages_json,summary,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)"
    ).bind(item.id,user.id,item.title,item.model,JSON.stringify(item.messages),item.summary,t,t).run();
    return json({data:item});
  }

  const convMatch=p.match(/^\/api\/conversations\/([^/]+)$/);
  if(convMatch && request.method==="PUT"){
    const id=convMatch[1],b=await bodyJson(request);
    const old=await env.DB.prepare("SELECT * FROM conversations WHERE id=? AND user_id=?").bind(id,user.id).first();
    if(!old)return json({error:"Conversația nu a fost găsită."},404);
    const title=Object.hasOwn(b,"title")?String(b.title):old.title;
    const model=Object.hasOwn(b,"model")?String(b.model):old.model;
    const messages=Object.hasOwn(b,"messages")&&Array.isArray(b.messages)?b.messages:JSON.parse(old.messages_json||"[]");
    await env.DB.prepare(
      "UPDATE conversations SET title=?,model=?,messages_json=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(title,model,JSON.stringify(messages),now(),id,user.id).run();
    const fresh=await env.DB.prepare("SELECT * FROM conversations WHERE id=? AND user_id=?").bind(id,user.id).first();
    return json({data:{id:fresh.id,title:fresh.title,model:fresh.model,messages:JSON.parse(fresh.messages_json||"[]"),summary:fresh.summary||"",createdAt:fresh.created_at,updatedAt:fresh.updated_at}});
  }
  if(convMatch && request.method==="DELETE"){
    await env.DB.prepare("DELETE FROM conversations WHERE id=? AND user_id=?").bind(convMatch[1],user.id).run();
    return json({ok:true});
  }

  if(p==="/api/memory" && request.method==="GET"){
    const r=await env.DB.prepare("SELECT id,text,pinned,source,created_at FROM memories WHERE user_id=? ORDER BY pinned DESC,created_at DESC").bind(user.id).all();
    return json({enabled:true,data:(r.results||[]).map(x=>({...x,createdAt:x.created_at,pinned:!!x.pinned}))});
  }
  if(p==="/api/memory" && request.method==="POST"){
    const b=await bodyJson(request), text=String(b.text||"").trim();
    if(!text)return json({error:"Memoria este goală."},400);
    const item={id:uuid(),text:text.slice(0,20000),pinned:!!b.pinned,source:"manual",createdAt:now()};
    await env.DB.prepare("INSERT INTO memories(id,user_id,text,pinned,source,created_at) VALUES(?,?,?,?,?,?)")
      .bind(item.id,user.id,item.text,item.pinned?1:0,item.source,item.createdAt).run();
    return json({data:item});
  }

  if(p==="/api/chat" && request.method==="POST"){
    const b=await bodyJson(request);
    const prepared=await chatMessages(env,user,b.messages);
    try{
      const out=await routeAI(env,prepared);
      return json({
        choices:[{index:0,message:{role:"assistant",content:out.text},finish_reason:"stop"}],
        model:out.model,
        provider:out.provider,
        mode:"performance-max"
      });
    }catch(e){
      return json({error:e.message},502);
    }
  }

  return json({error:"Endpoint inexistent."},404);
}

export default {
  async fetch(request, env) {
    try { return await router(request,env); }
    catch(e){ return json({error:"Eroare AI Stoica: "+e.message},500); }
  }
};
