const http=require("http");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {startLocalGateway}=require("../local-gateway.cjs");

function expect(v,m){if(!v)throw new Error(m)}
function listen(server){return new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve(server.address().port))})}
function closeServer(server){return new Promise(resolve=>server.close(resolve))}
async function jsonBody(req){let b="";for await(const c of req)b+=c;return b?JSON.parse(b):{}}

async function main(){
  let policyCalls=0,maxBatch=0;
  const notifications=[];
  const cloud=http.createServer(async(req,res)=>{
    res.setHeader("content-type","application/json");
    if(req.url==="/auth/me"){
      if(req.headers.authorization!=="Bearer owner-token"){res.statusCode=401;return res.end(JSON.stringify({error:"bad token"}))}
      return res.end(JSON.stringify({
        user:{id:"owner-1",email:"owner@example.com",name:"Owner",role:"owner",status:"active"},
        permissions:{chat:true,groq:true,cerebras:true,gemini:true,cloudflare:true,openrouter:true,openai:true,anthropic:true}
      }));
    }
    if(req.url==="/api/ai/access"&&req.method==="POST"){
      const body=await jsonBody(req),models=Array.isArray(body.models)?body.models:[];
      policyCalls++;maxBatch=Math.max(maxBatch,models.length);
      if(models.length>200){res.statusCode=413;return res.end(JSON.stringify({error:"Prea multe modele într-o singură verificare."}))}
      return res.end(JSON.stringify({data:models.map(model=>({model,allowed:true,reason:""})),policyEnforced:true,paidAiEnabled:true}));
    }
    res.statusCode=404;res.end(JSON.stringify({error:"not found"}));
  });
  const cloudPort=await listen(cloud);

  const modelRows=Array.from({length:325},(_,i)=>({id:"groq/model-"+String(i+1).padStart(3,"0"),provider:"groq"}));
  const omni=http.createServer(async(req,res)=>{
    res.setHeader("content-type","application/json");
    if(req.url==="/v1/models")return res.end(JSON.stringify({data:modelRows}));
    if(req.url==="/v1/chat/completions"&&req.method==="POST"){
      const body=await jsonBody(req);
      const allText=JSON.stringify(body.messages||[]);
      const content=allText.includes("AI_STOICA_NO_NOTIFICATION")?"AI_STOICA_NO_NOTIFICATION":"Rezultat automatizare test";
      return res.end(JSON.stringify({choices:[{message:{content}}]}));
    }
    res.statusCode=404;res.end(JSON.stringify({error:"not found"}));
  });
  const omniPort=await listen(omni);

  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"ai-stoica-infra-"));
  const gateway=startLocalGateway({
    dataDir,port:8802,host:"127.0.0.1",
    getOmniConfig:()=>({
      baseUrl:"http://127.0.0.1:"+omniPort+"/v1",
      controlApiUrl:"http://127.0.0.1:"+cloudPort,
      apiKey:"",
      model:"groq/model-001"
    }),
    onAutomationResult:(x)=>notifications.push(x)
  });
  const base="http://127.0.0.1:8802",headers={authorization:"Bearer owner-token","content-type":"application/json"};
  try{
    await new Promise(r=>setTimeout(r,120));
    let r=await fetch(base+"/api/models",{headers:{authorization:"Bearer owner-token"}});
    const catalog=await r.json();
    expect(r.ok,catalog.error||"Large model catalog failed");
    expect(catalog.manualModels?.length===325,"Complete Owner-permitted manual catalog was not preserved");
    expect(catalog.data?.length===325,"Complete manual permitted catalog expected");
    expect(policyCalls>=3,"Model policy should be checked in multiple batches");
    expect(maxBatch<=200,"A policy request exceeded the server safety limit");

    r=await fetch(base+"/api/plugins/direct",{method:"POST",headers,body:JSON.stringify({
      name:"GitHub",description:"Open GitHub directly",trigger:"@github",appUrl:"https://github.com/"
    })});
    const direct=await r.json();
    expect(r.ok,direct.error||"Direct plugin setup failed");
    expect(direct.data?.mode==="direct_app","Direct plugin mode missing");
    expect(direct.data?.oauthConnected===false,"Direct plugin must not require OAuth");

    r=await fetch(base+"/api/plugins/"+direct.data.id+"/test",{method:"POST",headers,body:JSON.stringify({message:"test"})});
    const directTest=await r.json();
    expect(r.ok&&directTest.direct===true,"Direct plugin test should succeed without OAuth");
    expect(directTest.appUrl==="https://github.com/","Direct plugin app URL missing");

    r=await fetch(base+"/api/memory/capture",{method:"POST",headers,body:JSON.stringify({
      userText:"Prefer să folosesc tema întunecată și vreau ca AI Stoica să păstreze această preferință."
    })});
    const captured=await r.json();
    expect(r.ok&&captured.stored===true,"Durable memory preference was not captured");

    r=await fetch(base+"/api/memory/capture",{method:"POST",headers,body:JSON.stringify({userText:"Ce oră este?"})});
    const ephemeral=await r.json();
    expect(r.ok&&ephemeral.stored===false,"Ephemeral chat should not be stored as long-term memory");

    const summary=await fetch(base+"/api/memory/summary",{headers:{authorization:"Bearer owner-token"}}).then(x=>x.json());
    expect(summary.data?.count===1,"Memory summary should contain one durable item");
    expect(summary.data?.categories?.["preferință"]===1,"Memory category should identify the preference");

    r=await fetch(base+"/api/automations",{method:"POST",headers,body:JSON.stringify({
      title:"Raport test",prompt:"Trimite raportul de test.",frequency:"daily",time:"09:00",
      timingMode:"exact_schedule",notify:true,model:"groq/model-001"
    })});
    const automation=await r.json();
    expect(r.ok,automation.error||"Automation creation failed");
    expect(automation.data?.nextRunAt>0,"Automation next run is missing");

    r=await fetch(base+"/api/automations/"+automation.data.id+"/run",{method:"POST",headers,body:"{}"});
    const automationRun=await r.json();
    expect(r.ok,automationRun.error||"Automation run failed");
    expect(automationRun.data?.lastStatus==="delivered","Automation delivery status missing");
    expect(notifications.length===1,"Automation result should emit one notification");

    r=await fetch(base+"/api/automations",{method:"POST",headers,body:JSON.stringify({
      title:"Monitor test",prompt:"Verifică dacă s-a schimbat ceva.",frequency:"hourly",
      timingMode:"condition_watch",notify:true,model:"groq/model-001"
    })});
    const watch=await r.json();
    expect(r.ok,watch.error||"Condition watch creation failed");
    r=await fetch(base+"/api/automations/"+watch.data.id+"/run",{method:"POST",headers,body:"{}"});
    const watchRun=await r.json();
    expect(r.ok,watchRun.error||"Condition watch run failed");
    expect(watchRun.data?.lastStatus==="checked_no_change","Condition watch should suppress unchanged results");
    expect(notifications.length===1,"Condition watch should not notify when nothing changed");

    r=await fetch(base+"/api/plugins/oauth/start",{method:"POST",headers,body:JSON.stringify({
      name:"GitHub",provider:"github",clientId:"test-client-id",
      authUrl:"https://github.com/login/oauth/authorize",
      tokenUrl:"https://github.com/login/oauth/access_token",
      apiUrl:"https://api.github.com/user/repos",
      method:"GET",scopes:"read:user"
    })});
    const oauth=await r.json();
    expect(r.ok,oauth.error||"OAuth start failed");
    const u=new URL(oauth.authorizeUrl);
    expect(u.hostname==="github.com","OAuth should open the configured provider");
    expect(u.searchParams.get("client_id")==="test-client-id","OAuth client id missing");
    expect(!!u.searchParams.get("state"),"OAuth state missing");
    expect(!!u.searchParams.get("code_challenge"),"OAuth PKCE challenge missing");
    expect(String(u.searchParams.get("redirect_uri")||"").includes("/api/plugins/oauth/callback"),"OAuth callback missing");

    console.log("INFRASTRUCTURE_REGRESSION_TESTS_PASSED");
  }finally{
    await gateway.close();await closeServer(cloud);await closeServer(omni);
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
