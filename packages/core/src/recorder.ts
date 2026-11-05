
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { Store } from "./store.js";
import { isRestoreLocked } from "./lock.js";
import { walk, recordBlob } from "./files.js";
import { initializeState } from "./snapshots.js";
import { type FileRecord, type EventKind } from "./types.js";
interface Change { type:EventKind; path:string; before:string|null; after:string|null; metadata:Record<string,unknown>; }
export async function reconcile(s:Store,sessionId:string):Promise<{changes:number;files:number}>{
  if(await isRestoreLocked(s))return {changes:0,files:s.state().size};
  const previous=s.state();
  const oldDirs=s.directories();
  const snapshot=await walk(s);
  const current=new Map<string,FileRecord>();
  const added:FileRecord[]=[];
  const removed:FileRecord[]=[];
  const changes:Change[]=[];
  for(const item of snapshot.files){
    const prior=previous.get(item.path);
    if(prior && prior.size===item.size && prior.mtimeMs===item.mtimeMs && prior.mode===item.mode){
      current.set(item.path,prior); continue;
    }
    const next=await recordBlob(s,item.path);
    current.set(item.path,next);
    if(!prior){added.push(next);continue;}
    if(prior.sha!==next.sha)changes.push({type:"modified",path:item.path,before:prior.sha,after:next.sha,metadata:{size:next.size}});
    else if(prior.mode!==next.mode)changes.push({type:"chmod",path:item.path,before:prior.sha,after:next.sha,metadata:{beforeMode:prior.mode,afterMode:next.mode}});
  }
  for(const p of previous.values())if(!current.has(p.path))removed.push(p);
  const used=new Set<string>();
  for(const newFile of added){
    const match=removed.find(old=>old.sha===newFile.sha && !used.has(old.path));
    if(match){
      used.add(match.path);
      changes.push({type:"renamed",path:newFile.path,before:match.sha,after:newFile.sha,metadata:{from:match.path}});
    }else changes.push({type:"created",path:newFile.path,before:null,after:newFile.sha,metadata:{size:newFile.size}});
  }
  for(const old of removed)if(!used.has(old.path))changes.push({type:"deleted",path:old.path,before:old.sha,after:null,metadata:{size:old.size}});
  const dirs=new Set(snapshot.dirs);
  for(const p of dirs)if(!oldDirs.has(p))changes.push({type:"directory-created",path:p,before:null,after:null,metadata:{}});
  for(const p of oldDirs)if(!dirs.has(p))changes.push({type:"directory-deleted",path:p,before:null,after:null,metadata:{}});
  changes.sort((a,b)=>a.path.localeCompare(b.path));
  // Never persist a partially restored tree into the observed state.
  if(await isRestoreLocked(s))return {changes:0,files:previous.size};
  s.transaction(()=>{
    s.db.exec("DELETE FROM file_state; DELETE FROM directory_state;");
    const insert=s.db.prepare("INSERT INTO file_state(path,sha,size,mode,mtime_ms) VALUES(?,?,?,?,?)");
    for(const f of current.values())insert.run(f.path,f.sha,f.size,f.mode,f.mtimeMs);
    const dir=s.db.prepare("INSERT INTO directory_state(path) VALUES(?)");
    for(const p of dirs)dir.run(p);
    for(const event of changes)s.log(sessionId,event.type,event.path,event.before,event.after,event.metadata);
  });
  return {changes:changes.length,files:current.size};
}
export async function watchProject(s:Store,opts:{signal:AbortSignal;onChange?:(count:number)=>void;onWarning?:(message:string)=>void}):Promise<void>{
  await initializeState(s);
  const session=s.startSession("watch");
  let watcher:FSWatcher|undefined;
  let scheduled:NodeJS.Timeout|undefined;
  let timer:NodeJS.Timeout|undefined;
  let inflight=Promise.resolve();
  const run=()=>{
    inflight=inflight.then(async()=>{
      const result=await reconcile(s,session.id);
      if(result.changes)opts.onChange?.(result.changes);
    }).catch(e=>{opts.onWarning?.("Reconciliation failed: "+String(e));});
  };
  const schedule=()=>{
    if(scheduled)clearTimeout(scheduled);
    scheduled=setTimeout(run,s.config.debounceMs);
  };
  try{
    await reconcile(s,session.id);
    try{
      watcher=fsWatch(s.root,{recursive:true},()=>schedule());
      watcher.on("error",e=>{opts.onWarning?.("Watcher failure; periodic scans remain active: "+e.message);watcher?.close();watcher=undefined;});
    }catch(e){opts.onWarning?.("Native watcher unavailable; falling back to reconciliation scans: "+String(e));}
    timer=setInterval(run,s.config.reconcileIntervalMs);
    await new Promise<void>(resolve=>{
      if(opts.signal.aborted)resolve();
      else opts.signal.addEventListener("abort",()=>resolve(),{once:true});
    });
  }finally{
    watcher?.close();
    if(timer)clearInterval(timer);
    if(scheduled){clearTimeout(scheduled);run();}
    await inflight;
    s.endSession(session.id);
  }
}
