import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const secret = 'dedicated-test-token-longer-than-32-characters';
function listen(server) {
  return new Promise(resolve => server.listen(0,'127.0.0.1',() => resolve(server.address().port)));
}
async function stop(server) { await new Promise(resolve => server.close(resolve)); }
test('MCP: authenticated all-provider discovery and safe chat routing', async () => {
  let models = [
    {id:'gemini/flash',type:'chat'},
    {id:'openai/pro',type:'chat'},
    {id:'gemini/embedding-2',type:'embedding'},
    {id:'gemini/gemini-3.1-flash-tts-preview'},
  ];
  const called = [];
  const upstream = http.createServer(async (req,res) => {
    res.setHeader('content-type','application/json');
    if(req.headers.authorization !== 'Bearer test-omni-key') {res.statusCode=401;return res.end('{}');}
    if(req.url === '/v1/models') return res.end(JSON.stringify({data:models}));
    if(req.url === '/v1/chat/completions') {
      let body=''; for await (const chunk of req) body+=chunk;
      called.push(JSON.parse(body).model);
      return res.end(JSON.stringify({choices:[{message:{content:'Hello from provider'}}]}));
    }
    res.statusCode=404;res.end('{}');
  });
  const upPort=await listen(upstream);
  const serverPath=join(dirname(fileURLToPath(import.meta.url)),'server.mjs');
  // A free port can be assigned by the OS; wait until it is released before spawning MCP.
  const temporary = http.createServer();
  const port=await listen(temporary);await stop(temporary);
  const child=spawn(process.execPath,[serverPath],{
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',OMNIROUTE_BASE_URL:'http://127.0.0.1:'+upPort+'/v1',
      OMNIROUTE_API_KEY:'test-omni-key',MCP_CLIENT_TOKEN:secret,MCP_ALLOWED_MODELS:'',MCP_EXCLUDED_MODELS:'',MCP_REQUESTS_PER_MINUTE:'30'},
    stdio:'pipe'
  });
  try {
    const url='http://127.0.0.1:'+port;
    let ready=false;
    for(let i=0;i<50;i++){try{if((await fetch(url+'/healthz')).ok){ready=true;break;}}catch{} await delay(50);}
    assert.ok(ready,'MCP server failed to start');
    const post=async (method,params={},headers={}) => {
      const r=await fetch(url+'/mcp',{method:'POST',
        headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json',...headers},
        body:JSON.stringify({jsonrpc:'2.0',id:7,method,params})});
      return [r.status,await r.json()];
    };
    const noKey=await fetch(url+'/mcp',{method:'POST'});
    assert.equal(noKey.status,401);
    const [badOrigin]=await post('tools/list',{}, {Origin:'https://bad.example'});
    assert.equal(badOrigin,403);
    const [initCode,init]=await post('initialize',{protocolVersion:'2025-11-25'});
    assert.equal(initCode,200);assert.equal(init.result.protocolVersion,'2025-11-25');
    const [,listTools]=await post('tools/list');
    assert.deepEqual(listTools.result.tools.map(t=>t.name),['list_ai_stoica_models','ask_ai_stoica']);
    const [,list]=await post('tools/call',{name:'list_ai_stoica_models',arguments:{}});
    const modelsResult=JSON.parse(list.result.content[0].text);
    assert.deepEqual(modelsResult.chatModelIds,['gemini/flash','openai/pro']);
    assert.equal(modelsResult.nonChatModelIds.length,2);
    const [,reject]=await post('tools/call',{name:'ask_ai_stoica',arguments:{model:'gemini/embedding-2',prompt:'Hello'}});
    assert.equal(reject.result.isError,true);
    const [,answer]=await post('tools/call',{name:'ask_ai_stoica',arguments:{model:'openai/pro',prompt:'Hello'}});
    assert.match(answer.result.content[0].text,/Hello from provider/);
    models.push({id:'groq/new',type:'chat'});
    const [,refresh]=await post('tools/call',{name:'list_ai_stoica_models',arguments:{}});
    assert.ok(JSON.parse(refresh.result.content[0].text).chatModelIds.includes('groq/new'));
    const [,other]=await post('tools/call',{name:'ask_ai_stoica',arguments:{model:'groq/new',prompt:'Hello'}});
    assert.match(other.result.content[0].text,/Hello from provider/);
    assert.deepEqual(called,['openai/pro','groq/new']);
    assert.ok(!JSON.stringify(other).includes('test-omni-key'));
  } finally {
    child.kill('SIGTERM');await stop(upstream);
  }
});
