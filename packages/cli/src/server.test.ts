
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { Store, initializeState } from "@timewarp/core";
import { startServer } from "./server.js";

async function availablePort():Promise<number>{
  const server=createServer();
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve());});
  const address=server.address();const port=typeof address==="object"&&address?address.port:0;
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  return port;
}
test("real dashboard API denies unauthenticated requests and performs confirmed restore + undo",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"tw-api-test-"));
  const file=join(dir,"app.js");await writeFile(file,"working");
  const s=new Store(dir,true);
  let server:Awaited<ReturnType<typeof startServer>>|undefined;
  try{
    const baseline=await initializeState(s);
    await writeFile(file,"broken");
    server=await startServer(s,await availablePort());
    const home=await fetch(server.url);
    assert.equal(home.status,200);
    const html=await home.text();
    const token=html.match(/name="timewarp-token" content="([a-f0-9]{64})"/)?.[1];
    assert.ok(token,"actual per-process token is delivered to local dashboard");
    const denied=await fetch(server.url+"/api/status");
    assert.equal(denied.status,403);
    const h={"X-Timewarp-Token":token!};
    const status=await fetch(server.url+"/api/status",{headers:h});
    assert.equal(status.status,200);
    const plan=await fetch(server.url+"/api/restore-plan?id="+baseline.id,{headers:h});
    assert.equal(plan.status,200);
    const preview=(await plan.json()) as {modified:number};
    assert.equal(preview.modified,1);
    const notConfirmed=await fetch(server.url+"/api/restore",{method:"POST",headers:{...h,"Content-Type":"application/json"},body:JSON.stringify({id:baseline.id})});
    assert.equal(notConfirmed.status,400);
    assert.equal(await readFile(file,"utf8"),"broken");
    const confirmed=await fetch(server.url+"/api/restore",{method:"POST",headers:{...h,"Content-Type":"application/json"},body:JSON.stringify({id:baseline.id,confirm:true})});
    assert.equal(confirmed.status,200);
    assert.equal(await readFile(file,"utf8"),"working");
    const undone=await fetch(server.url+"/api/undo",{method:"POST",headers:{...h,"Content-Type":"application/json"},body:JSON.stringify({confirm:true})});
    assert.equal(undone.status,200);
    assert.equal(await readFile(file,"utf8"),"broken");
  }finally{
    if(server)await new Promise<void>((resolve,reject)=>server!.server.close(e=>e?reject(e):resolve()));
    s.close();await rm(dir,{recursive:true,force:true});
  }
});
