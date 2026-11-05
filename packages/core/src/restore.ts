
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import { Store } from "./store.js";
import { assertNoSymlink, blobPath, currentFiles, deleteSafe, diskAvailable, hashFile, verifyBlob, walk, writeBlobAtomic } from "./files.js";
import { uncheckedCheckpoint } from "./snapshots.js";
import { TimeWarpError, type FileRecord, type RestorePlan, type RestoreOperation } from "./types.js";

export async function planRestore(s:Store,checkpointId:string,onlyPath?:string):Promise<RestorePlan>{
  if(s.pending().length)throw new TimeWarpError("Unfinished restore detected. Run timewarp recover --yes first.","RECOVERY_REQUIRED");
  const target=s.checkpointFiles(checkpointId);
  const actual=await currentFiles(s);
  const names=onlyPath?[onlyPath]:[...new Set([...target.keys(),...actual.keys()])].sort();
  const operations:RestoreOperation[]=[];
  for(const p of names){
    await assertNoSymlink(s,p);
    const before=actual.get(p),after=target.get(p);
    if(before?.sha===after?.sha && (!after || before?.mode===after.mode))continue;
    if(!before && !after)continue;
    operations.push({action:!before?"create":!after?"delete":"modify",path:p,before:before?.sha??null,after:after?.sha??null,mode:after?.mode});
  }
  return {checkpointId,operations,created:operations.filter(x=>x.action==="create").length,modified:operations.filter(x=>x.action==="modify").length,deleted:operations.filter(x=>x.action==="delete").length};
}
async function preflight(s:Store,plan:RestorePlan):Promise<void>{
  const target=s.checkpointFiles(plan.checkpointId);
  let bytes=0;
  for(const op of plan.operations){
    await assertNoSymlink(s,op.path);
    if(op.after){
      const record=target.get(op.path);
      if(!record || record.sha!==op.after)throw new TimeWarpError("Restore plan does not match target checkpoint.","INVALID_PLAN");
      await verifyBlob(s,op.after);
      bytes+=record.size;
    }
    if(op.before){
      const path=await assertNoSymlink(s,op.path);
      await access(path,constants.R_OK);
    }
  }
  if(bytes>await diskAvailable(s))throw new TimeWarpError("Insufficient free disk space for restoration.","NO_SPACE");
}
async function unchanged(s:Store,op:RestoreOperation):Promise<void>{
  const dest=await assertNoSymlink(s,op.path);
  try{
    const st=await lstat(dest);
    if(!st.isFile())throw new TimeWarpError("Target is no longer a regular file: "+op.path,"CONFLICT");
    if(op.before===null)throw new TimeWarpError("New file appeared after preview: "+op.path,"CONFLICT");
    const hash=await hashFile(dest);
    if(hash!==op.before)throw new TimeWarpError("File changed since preview: "+op.path,"CONFLICT");
  }catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT"){
      if(op.before!==null)throw new TimeWarpError("File disappeared after preview: "+op.path,"CONFLICT");
      return;
    }
    throw e;
  }
}
async function applyChanges(s:Store,plan:RestorePlan,operationId?:string):Promise<void>{
  for(let i=0;i<plan.operations.length;i++){
    const op=plan.operations[i]!;
    await unchanged(s,op);
    if(op.after)await writeBlobAtomic(s,op.path,op.after,op.mode);
    else await deleteSafe(s,op.path);
    if(op.after && await hashFile(await assertNoSymlink(s,op.path))!==op.after)throw new TimeWarpError("Post-restore verification failed: "+op.path,"VERIFY_FAILED");
    if(operationId)s.restoreStep(operationId,i);
  }
}
async function refreshState(s:Store):Promise<void>{
  const map=await currentFiles(s);const dirs=(await walk(s)).dirs;
  s.replaceState([...map.values()],dirs);
}
export async function restore(s:Store,checkpointId:string,onlyPath?:string):Promise<{operationId:string;safetyCheckpointId:string;changed:number}>{
  const plan=await planRestore(s,checkpointId,onlyPath);
  await preflight(s,plan);
  // Capture the entire current tree, including untracked new files, before mutating it.
  const safety=await uncheckedCheckpoint(s,"Before restore to "+checkpointId);
  const safetyMap=s.checkpointFiles(safety.id);
  for(const op of plan.operations)if((safetyMap.get(op.path)?.sha??null)!==op.before)
    throw new TimeWarpError("Project changed after preview; no files restored.","CONFLICT");
  const id=randomUUID();
  s.addRestore(id,checkpointId,safety.id,plan);
  try{
    await applyChanges(s,plan,id);
    await refreshState(s);
    s.restoreStatus(id,"completed");
  }catch(e){
    s.restoreStatus(id,"recovery_required",String(e));
    throw new TimeWarpError("Restore interrupted: "+String(e)+". Run timewarp recover --yes to roll back to the safety checkpoint.","RESTORE_INTERRUPTED");
  }
  return {operationId:id,safetyCheckpointId:safety.id,changed:plan.operations.length};
}
export async function recover(s:Store):Promise<{recovered:number}>{
  const pending=s.pending();
  let recovered=0;
  for(const operation of pending){
    const id=String(operation.id),safetyId=String(operation.safety_id);
    s.restoreStatus(id,"recovering");
    try{
      const expected=s.checkpointFiles(safetyId);
      const actual=await currentFiles(s);
      const names=[...new Set([...expected.keys(),...actual.keys()])].sort();
      // Recovery deliberately ignores previous current hashes; it is replayable after a crash.
      for(const p of names){
        const before=actual.get(p),after=expected.get(p);
        if(before?.sha===after?.sha && (!after || before?.mode===after.mode))continue;
        if(after)await writeBlobAtomic(s,p,after.sha,after.mode);
        else await deleteSafe(s,p);
      }
      await refreshState(s);
      s.restoreStatus(id,"recovered");
      recovered++;
    }catch(e){s.restoreStatus(id,"recovery_required",String(e));throw e;}
  }
  return {recovered};
}
export async function undo(s:Store):Promise<{operationId:string;safetyCheckpointId:string;changed:number}>{
  const last=s.lastSuccessful();
  if(!last)throw new TimeWarpError("No completed restoration to undo.","NOT_FOUND");
  return restore(s,String(last.safety_id));
}
