const fs=require("fs");
const os=require("os");
const path=require("path");
const {startLocalGateway}=require("../local-gateway.cjs");

function expect(v,m){if(!v)throw new Error(m)}

async function main(){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"ai-stoica-tools-"));
  const port=8797;
  const cfg={
    baseUrl:"http://127.0.0.1:65530/v1",
    controlApiUrl:"",
    apiKey:"",
    model:"test-model",
    webSearchEnabled:false,
    projectContextEnabled:true,
    githubAutoContext:false,
    githubRepo:"",
    githubToken:"",
    serverHost:"",
    directChatEnabled:true,
    directChatCostPolicy:"free_only",
    directChatProviderOrder:"cerebras,groq",
    blockedProviders:"",
    cerebrasApiKey:"test-cerebras-key",
    cerebrasModel:"gpt-oss-120b",
    groqApiKey:"test-groq-key",
    groqModel:"llama-3.3-70b-versatile"
  };
  const gateway=startLocalGateway({dataDir,port,host:"127.0.0.1",getOmniConfig:()=>cfg});
  const base="http://127.0.0.1:"+port;
  const realFetch=globalThis.fetch;
  let cerebrasCalls=0,groqCalls=0;
  globalThis.fetch=async (url,init)=>{
    const target=String(url);
    if(target==="https://api.cerebras.ai/v1/chat/completions"){
      cerebrasCalls++;
      return new Response(JSON.stringify({error:{message:"rate limited"}}),{status:429,headers:{"content-type":"application/json"}});
    }
    if(target==="https://api.groq.com/openai/v1/chat/completions"){
      groqCalls++;
      let body={};try{body=JSON.parse(String(init?.body||"{}"))}catch{}
      if(body.stream){
        const sse='data: {"choices":[{"delta":{"content":"GROQ_STREAM_OK"}}]}\\n\\ndata: [DONE]\\n\\n';
        return new Response(sse,{status:200,headers:{"content-type":"text/event-stream"}});
      }
      return new Response(JSON.stringify({choices:[{message:{content:"GROQ_DIRECT_OK"}}]}),{status:200,headers:{"content-type":"application/json"}});
    }
    return realFetch(url,init);
  };
  try{
    await new Promise(r=>setTimeout(r,100));
    let r=await fetch(base+"/auth/register",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({email:"owner-tools@example.com",password:"password123",name:"Owner Tools"})
    });
    let data=await r.json();
    expect(r.ok,data.error||"register failed");
    const token=data.token;
    const headers={authorization:"Bearer "+token,"content-type":"application/json"};

    r=await fetch(base+"/api/tools/code/run",{
      method:"POST",headers,
      body:JSON.stringify({language:"javascript",code:"console.log(2+3)"})
    });
    expect(r.status===403,"Non-owner code execution must be blocked");

    const storePath=path.join(dataDir,"ai-stoica-data.json");
    const db=JSON.parse(fs.readFileSync(storePath,"utf8"));
    const user=db.users.find(x=>x.email==="owner-tools@example.com");
    expect(user,"test user missing");
    user.role="owner";
    fs.writeFileSync(storePath,JSON.stringify(db,null,2),"utf8");

    r=await fetch(base+"/api/tools/code/run",{
      method:"POST",headers,
      body:JSON.stringify({language:"javascript",code:"console.log(2+3)"})
    });
    data=await r.json();
    expect(r.ok,data.error||"Owner code execution failed");
    expect(data.data?.code===0,"Owner code execution exit code was not 0");
    expect(String(data.data?.stdout||"").trim()==="5","Owner code execution output mismatch");

    // 0.7.16: a chosen model that does not answer is reported, never replaced by a direct API on its own.
    r=await fetch(base+"/api/chat",{method:"POST",headers,body:JSON.stringify({model:"test-model",messages:[{role:"user",content:"test fallback direct"}]})});
    data=await r.json();
    expect(r.status===502&&/Modelul ales «test-model»/.test(data.error||"")&&cerebrasCalls===0&&groqCalls===0,"A failing chosen model must not fall back without «Rezervă automată»: "+JSON.stringify(data).slice(0,300));
    // With «Rezervă automată» turned on, the direct APIs answer in order (Cerebras, then Groq).
    cfg.chatFallbackOnFailure=true;await new Promise(x=>setTimeout(x,2100));
    r=await fetch(base+"/api/chat",{method:"POST",headers,body:JSON.stringify({model:"test-model",messages:[{role:"user",content:"test fallback direct"}]})});
    data=await r.json();
    expect(r.ok,data.error||"Direct chat fallback failed");
    expect(data?.choices?.[0]?.message?.content==="GROQ_DIRECT_OK","Groq direct fallback response mismatch");
    expect(r.headers.get("x-ai-stoica-route")==="direct-fallback","Direct fallback route header missing");
    expect(r.headers.get("x-ai-stoica-provider")==="groq","Direct fallback provider header mismatch");
    expect(cerebrasCalls===1&&groqCalls===1,"Fallback order Cerebras -> Groq was not respected");

    r=await fetch(base+"/api/chat/stream",{method:"POST",headers,body:JSON.stringify({model:"test-model",messages:[{role:"user",content:"test streaming fallback"}]})});
    const streamText=await r.text();
    expect(r.ok,"Direct streaming fallback failed");
    expect(streamText.includes("GROQ_STREAM_OK"),"Groq streaming fallback content missing");
    expect(streamText.includes("direct-fallback"),"Streaming route metadata missing direct-fallback");
    expect(cerebrasCalls===2&&groqCalls===2,"Streaming fallback order Cerebras -> Groq was not respected");

    console.log("OWNER_TOOLS_TESTS_PASSED");
  } finally {
    globalThis.fetch=realFetch;
    await gateway.close();
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
}

main().catch(e=>{console.error(e);process.exit(1)});
