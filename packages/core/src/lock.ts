
import { randomUUID } from "node:crypto";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Store } from "./store.js";
import { TimeWarpError } from "./types.js";

interface Owner { pid:number; token:string; startedAt:string; }
const location=(s:Store)=>join(s.dir,"restore.lock");
function alive(pid:number):boolean{
  try{process.kill(pid,0);return true;}
  catch(error){return (error as NodeJS.ErrnoException).code!=="ESRCH";}
}
export async function isRestoreLocked(s:Store):Promise<boolean>{
  try{await stat(location(s));return true;}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}
}
export async function withRestoreLock<T>(s:Store,action:()=>Promise<T>):Promise<T>{
  const path=location(s);
  const owner:Owner={pid:process.pid,token:randomUUID(),startedAt:new Date().toISOString()};
  let handle:Awaited<ReturnType<typeof open>>|undefined;
  for(let attempt=0;attempt<3;attempt++){
    try{
      handle=await open(path,"wx",0o600);
      await handle.writeFile(JSON.stringify(owner));
      await handle.sync();
      break;
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
      let existing:Owner;
      try{existing=JSON.parse(await readFile(path,"utf8")) as Owner;}
      catch{throw new TimeWarpError("Project restore lock is unreadable. Ensure no restore is running before removing .timewarp/restore.lock.","LOCKED");}
      if(!Number.isSafeInteger(existing.pid)||existing.pid<1||typeof existing.token!=="string"){
        throw new TimeWarpError("Invalid restore lock. Inspect it before manual cleanup.","LOCKED");
      }
      if(alive(existing.pid)){
        throw new TimeWarpError("Another TimeWarp process owns the restore lock (PID "+existing.pid+").","LOCKED");
      }
      // Crash remnant: only reap a lock that has the same content as we inspected.
      const repeat=await readFile(path,"utf8");
      if(repeat!==JSON.stringify(existing))throw new TimeWarpError("Restore lock changed while checking its owner.","LOCKED");
      try{await unlink(path);}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
    }
  }
  if(!handle)throw new TimeWarpError("Cannot acquire exclusive project restore lock.","LOCKED");
  try{return await action();}
  finally{
    await handle.close();
    try{
      const current=JSON.parse(await readFile(path,"utf8")) as Owner;
      if(current.token===owner.token)await unlink(path);
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=="ENOENT"){
        // Do not override the outcome of a completed restore due to an altered lock.
      }
    }
  }
}
