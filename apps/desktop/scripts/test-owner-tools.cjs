const fs=require("fs");
const os=require("os");
const path=require("path");
const {startLocalGateway}=require("../local-gateway.cjs");

function expect(v,m){if(!v)throw new Error(m)}

async function main(){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"ai-stoica-tools-"));
  const port=8797;
  const gateway=startLocalGateway({
    dataDir,port,host:"127.0.0.1",
    getOmniConfig:()=>({
      baseUrl:"http://127.0.0.1:65530/v1",
      controlApiUrl:"",
      apiKey:"",
      model:"test-model",
      webSearchEnabled:false,
      projectContextEnabled:true,
      githubAutoContext:false,
      githubRepo:"",
      githubToken:"",
      serverHost:""
    })
  });
  const base="http://127.0.0.1:"+port;
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

    console.log("OWNER_TOOLS_TESTS_PASSED");
  } finally {
    await gateway.close();
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
}

main().catch(e=>{console.error(e);process.exit(1)});
