const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { startLocalGateway } = require("../local-gateway.cjs");

function expect(condition, message){ if(!condition) throw new Error(message); }
function listen(server){ return new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve(server.address().port));}); }
function closeServer(server){ return new Promise(resolve=>server.close(()=>resolve())); }
async function jsonBody(req){let body="";for await(const chunk of req)body+=chunk;return body?JSON.parse(body):{};}

async function main(){
  let omniChatCalls=0;
  const cloud=http.createServer(async(req,res)=>{
    res.setHeader("content-type","application/json");
    if(req.url==="/auth/me"){
      if(req.headers.authorization!=="Bearer normal-token"){res.statusCode=401;return res.end(JSON.stringify({error:"bad token"}))}
      return res.end(JSON.stringify({
        user:{id:"user-1",email:"normal@example.com",name:"Normal",role:"user",status:"active"},
        permissions:{chat:true,groq:true,cerebras:true,gemini:true,cloudflare:true,openrouter:true,openai:false,anthropic:false}
      }));
    }
    if(req.url==="/api/ai/access"&&req.method==="POST"){
      const body=await jsonBody(req);
      const models=Array.isArray(body.models)?body.models:[body.model].filter(Boolean);
      const data=models.map(model=>{
        const value=String(model);
        const allowed=/^groq\//i.test(value);
        return {model:value,allowed,reason:allowed?"":"Model plătit sau neaprobat pentru acest cont."};
      });
      return res.end(JSON.stringify({data,policyEnforced:true,paidAiEnabled:true}));
    }
    res.statusCode=404;res.end(JSON.stringify({error:"not found"}));
  });
  const cloudPort=await listen(cloud);

  const omni=http.createServer(async(req,res)=>{
    res.setHeader("content-type","application/json");
    if(req.url==="/v1/models"&&req.method==="GET"){
      return res.end(JSON.stringify({data:[
        {id:"Ai principal"},
        {id:"openai/gpt-5"},
        {id:"groq/llama-3.3-70b-versatile"},
        {id:"mystery-model"}
      ]}));
    }
    if(req.url==="/v1/chat/completions"&&req.method==="POST"){
      omniChatCalls++;
      const body=await jsonBody(req);
      return res.end(JSON.stringify({choices:[{message:{content:"ok "+body.model}}]}));
    }
    res.statusCode=404;res.end(JSON.stringify({error:"not found"}));
  });
  const omniPort=await listen(omni);

  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"ai-stoica-policy-"));
  const gateway=startLocalGateway({
    dataDir,port:8798,host:"127.0.0.1",
    getOmniConfig:()=>({
      baseUrl:`http://127.0.0.1:${omniPort}/v1`,
      controlApiUrl:`http://127.0.0.1:${cloudPort}`,
      apiKey:"",
      model:"groq/llama-3.3-70b-versatile"
    })
  });
  const base="http://127.0.0.1:8798";
  const headers={authorization:"Bearer normal-token","content-type":"application/json"};

  try{
    await new Promise(r=>setTimeout(r,120));

    let r=await fetch(base+"/api/models",{headers:{authorization:"Bearer normal-token"}});
    const models=await r.json();
    expect(r.ok,"Filtered models endpoint failed");
    expect(models.policyEnforced===true,"Model response must mark policy enforcement");
    expect(Array.isArray(models.data)&&models.data.length===1,"Normal account should see only the model permitted by Owner");
    expect(models.data[0].id==="groq/llama-3.3-70b-versatile","Selector should contain only Owner-permitted models");
    expect(Array.isArray(models.manualModels)&&models.manualModels.length===1,"Manual selector must expose only Owner-permitted models");
    expect(models.manualModels[0].id==="groq/llama-3.3-70b-versatile","Groq permitted model missing from manual catalog");

    // "Ai principal" exists in OmniRoute as a combo: it is used as is and the Owner policy still applies.
    r=await fetch(base+"/api/chat",{method:"POST",headers,body:JSON.stringify({model:"Ai principal",messages:[{role:"user",content:"Spune-mi pe scurt ce este un API."}]})});
    expect(r.status===403,"The OmniRoute combo behind the alias must still pass the Owner policy");
    expect(omniChatCalls===0,"Denied alias reached OmniRoute");

    // "AI Stoica" has no combo in OmniRoute: it maps to the configured default model instead of failing with 409.
    r=await fetch(base+"/api/chat",{method:"POST",headers,body:JSON.stringify({model:"AI Stoica",messages:[{role:"user",content:"test"}]})});
    let body=await r.json();
    expect(r.ok&&body?.choices?.[0]?.message?.content==="ok groq/llama-3.3-70b-versatile","Alias must map to the configured default model: "+JSON.stringify(body));
    expect(omniChatCalls===1,"Mapped alias did not reach OmniRoute");

    r=await fetch(base+"/api/chat",{method:"POST",headers,body:JSON.stringify({model:"openai/gpt-5",messages:[{role:"user",content:"test"}]})});
    expect(r.status===403,"OpenAI model must be rejected for normal account");
    expect(omniChatCalls===1,"Denied OpenAI request reached OmniRoute");

    r=await fetch(base+"/api/chat",{method:"POST",headers,body:JSON.stringify({model:"groq/llama-3.3-70b-versatile",messages:[{role:"user",content:"test"}]})});
    expect(r.ok,"Permitted Groq model should work");
    expect(omniChatCalls===2,"Permitted Groq request did not reach OmniRoute");

    r=await fetch(base+"/api/chat",{method:"POST",headers,body:JSON.stringify({model:"mystery-model",messages:[{role:"user",content:"test"}]})});
    expect(r.status===403,"Unknown model must fail closed");
    expect(omniChatCalls===2,"Unknown denied model reached OmniRoute");

    console.log("DESKTOP_AI_ACCESS_ENFORCEMENT_TESTS_PASSED");
  } finally {
    await gateway.close();
    await closeServer(cloud);
    await closeServer(omni);
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
}

main().catch(err=>{console.error(err);process.exit(1)});
