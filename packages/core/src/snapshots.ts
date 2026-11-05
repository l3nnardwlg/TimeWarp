
import { randomUUID } from "node:crypto";
import { readdir, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { Store } from "./store.js";
import { withRestoreLock } from "./lock.js";
import { currentFiles, recordBlob, walk, verifyBlob, blobPath } from "./files.js";
import { type Checkpoint, type FileRecord, TimeWarpError } from "./types.js";

export async function checkpoint(s:Store,label="Manual checkpoint",sessionId:string|null=null):Promise<Checkpoint>{
  if(s.pending().length)throw new TimeWarpError("Unfinished restore detected. Run timewarp recover --yes first.","RECOVERY_REQUIRED");
  return withRestoreLock(s,()=>uncheckedCheckpoint(s,label,sessionId));
}
export async function uncheckedCheckpoint(s:Store,label:string,sessionId:string|null=null):Promise<Checkpoint>{
  const map=await currentFiles(s);
  const cp: Checkpoint={id:randomUUID(),createdAt:new Date().toISOString(),label,sessionId,fileCount:map.size};
  s.saveCheckpoint(cp,[...map.values()]);
  return cp;
}
export async function initializeState(s:Store):Promise<Checkpoint>{
  if(s.checkpoints(1).length)return s.checkpoints(1)[0]!;
  const scanned=await walk(s);
  const records:FileRecord[]=[];
  for(const f of scanned.files)records.push(await recordBlob(s,f.path));
  s.replaceState(records,scanned.dirs);
  const cp:Checkpoint={id:randomUUID(),createdAt:new Date().toISOString(),label:"Initial baseline",sessionId:null,fileCount:records.length};
  s.saveCheckpoint(cp,records);
  return cp;
}
export async function verifyCheckpoint(s:Store,id:string):Promise<{files:number;verified:number}>{
  const files=s.checkpointFiles(id); const verified=new Set<string>();
  for(const f of files.values())if(!verified.has(f.sha)){await verifyBlob(s,f.sha);verified.add(f.sha);}
  return {files:files.size,verified:verified.size};
}
export async function garbageCollect(s:Store):Promise<{removed:number;bytes:number}>{
  if(s.pending().length)throw new TimeWarpError("Cannot run GC while a restore is incomplete.","RECOVERY_REQUIRED");
  const keep=new Set<string>();
  for(const row of s.db.prepare("SELECT DISTINCT sha FROM checkpoint_files UNION SELECT DISTINCT sha FROM file_state UNION SELECT before_sha FROM events WHERE before_sha IS NOT NULL UNION SELECT after_sha FROM events WHERE after_sha IS NOT NULL").all() as Array<{sha:string}>)keep.add(row.sha);
  let removed=0,bytes=0;
  const dir=join(s.dir,"objects");
  let buckets:string[]=[];
  try{buckets=await readdir(dir);}catch{return {removed,bytes};}
  for(const bucket of buckets){
    if(!/^[a-f0-9]{2}$/.test(bucket))continue;
    const folder=join(dir,bucket);
    for(const hash of await readdir(folder)){
      if(!/^[a-f0-9]{64}$/.test(hash) || keep.has(hash))continue;
      const file=join(folder,hash);
      try{const {size}=await import("node:fs/promises").then(fs=>fs.stat(file));await unlink(file);removed++;bytes+=size;}catch{ /* concurrent deletion */ }
    }
    try{await rmdir(folder);}catch{}
  }
  return {removed,bytes};
}
