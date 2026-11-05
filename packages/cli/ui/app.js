"use strict";
const $=id=>document.getElementById(id);
const token=document.querySelector('meta[name="timewarp-token"]').content;
const state={view:"timeline",status:null,events:[],checkpoints:[],sessions:[],selected:null,pending:null};
const escapeHtml=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dt=v=>v?new Date(v).toLocaleString():"—";
const bytes=n=>n<1024?n+" B":n<1048576?(n/1024).toFixed(1)+" KB":(n/1048576).toFixed(1)+" MB";
const short=s=>s?s.slice(0,12):"—";
async function api(path,data){
  const response=await fetch("/api/"+path,{method:data===undefined?"GET":"POST",headers:{"X-Timewarp-Token":token,...(data===undefined?{}:{"Content-Type":"application/json"})},body:data===undefined?undefined:JSON.stringify(data)});
  const out=await response.json();
  if(!response.ok)throw new Error(out.error||"Unknown TimeWarp error");
  return out;
}
function toast(message){
  const e=document.createElement("div");e.className="toast";e.textContent=message;
  $("toast-region").append(e);setTimeout(()=>e.remove(),5500);
}
async function refresh(){
  try{
    const [status,events,checkpoints,sessions]=await Promise.all([
      api("status"),api("timeline?limit=2000"),api("checkpoints"),api("sessions")
    ]);
    Object.assign(state,{status,events,checkpoints,sessions});
    $("project-label").textContent=status.project.split(/[\\/]/).filter(Boolean).pop()||status.project;
    $("count-events").textContent=Number(status.events).toLocaleString();
    $("count-checkpoints").textContent=checkpoints.length.toLocaleString();
    $("count-sessions").textContent=sessions.length.toLocaleString();
    $("count-bytes").textContent=bytes(status.logicalBlobBytes);
    if(status.pendingRecovery)toast("An interrupted restore requires recovery. Use timewarp recover --yes.");
    render();
  }catch(e){toast(e.message);$("feed").innerHTML='<div class="empty">Cannot read project data. Check that TimeWarp is initialized.</div>';}
}
const titles={
  timeline:["Activity timeline","Explore filesystem events recorded from your real project."],
  checkpoints:["Your checkpoints","Browse immutable project states and safely rewind your files."],
  sessions:["Recording sessions","See when TimeWarp recorded development activity."],
  settings:["Privacy & settings","Your local-first development flight recorder."]
};
function view(which){
  state.view=which;state.selected=null;
  document.querySelectorAll(".nav-item").forEach(e=>e.classList.toggle("active",e.dataset.view===which));
  $("view-title").textContent=titles[which][0];$("view-subtitle").textContent=titles[which][1];
  $("filters").hidden=which!=="timeline";
  $("inspector").innerHTML='<div class="inspector-empty"><div class="orbit">⌁</div><h3>Inspect your history</h3><p>Select an event or checkpoint to view details and safe restore controls.</p></div>';
  render();
}
function render(){
  if(state.view==="timeline")renderTimeline();
  else if(state.view==="checkpoints")renderCheckpoints();
  else if(state.view==="sessions")renderSessions();
  else renderSettings();
}
function kindSymbol(kind){return {created:"+",modified:"✎",deleted:"−",renamed:"↗",chmod:"♮","directory-created":"▣","directory-deleted":"□"}[kind]||"•";}
function renderTimeline(){
  $("feed-title").textContent="Recorded changes";$("feed-desc").textContent="Filesystem observations · agent attribution unknown";
  const q=$("filter-query").value.toLowerCase(),kind=$("filter-kind").value;
  const filtered=state.events.filter(e=>e.relativePath.toLowerCase().includes(q)&&(!kind||e.eventType===kind));
  $("feed-count").textContent=filtered.length+" events";
  if(!filtered.length){$("feed").innerHTML='<div class="empty">No events match. Start recording with <b>timewarp watch .</b>, then modify a file.</div>';return;}
  $("feed").innerHTML=filtered.map(e=>'<button class="event '+(state.selected===e.id?"selected":"")+'" data-event="'+e.id+'"><span class="event-mark '+escapeHtml(e.eventType)+'">'+kindSymbol(e.eventType)+'</span><span class="event-main"><strong>'+escapeHtml(e.relativePath)+'</strong><small>'+escapeHtml(e.eventType)+' · filesystem observation</small></span><span class="event-time">'+escapeHtml(new Date(e.timestamp).toLocaleTimeString())+'</span></button>').join("");
}
function renderCheckpoints(){
  $("feed-title").textContent="Saved states";$("feed-desc").textContent="Content-addressed · durable on disk";
  $("feed-count").textContent=state.checkpoints.length+" saved";
  $("feed").innerHTML=state.checkpoints.length?state.checkpoints.map(c=>'<div class="checkpoint-row"><span class="mark">◈</span><span class="info"><strong>'+escapeHtml(c.label)+'</strong><small>'+dt(c.createdAt)+' · '+c.fileCount+' files · '+short(c.id)+'</small></span><button class="quiet-button" data-checkpoint="'+escapeHtml(c.id)+'">Inspect</button></div>').join(""):'<div class="empty">No checkpoints yet. Select “+ Checkpoint” above to capture the current state.</div>';
}
function renderSessions(){
  $("feed-title").textContent="Sessions";$("feed-desc").textContent="Watch sessions and explicit command wrappers";
  $("feed-count").textContent=state.sessions.length+" sessions";
  $("feed").innerHTML=state.sessions.length?state.sessions.map(s=>'<div class="session-row"><strong>'+escapeHtml(s.kind==='watch'?"◷ Watch session":"⌘ Process wrapper")+'</strong><small>Started '+dt(s.startedAt)+' · '+(s.endedAt?"Ended "+dt(s.endedAt):"No end timestamp")+'</small><small>Session ID: '+escapeHtml(s.id)+'</small></div>').join(""):'<div class="empty">No sessions recorded.</div>';
}
function renderSettings(){
  $("feed-title").textContent="Storage & privacy";$("feed-desc").textContent="No cloud service required";
  $("feed-count").textContent="Offline";
  const config=state.status?.config||{};
  $("feed").innerHTML='<div class="inspector-content"><h3>Stored on your device</h3><p class="meta">Project: '+escapeHtml(state.status?.project)+'</p><p class="meta">Metadata: .timewarp/timeline.sqlite</p><p class="meta">Blobs: .timewarp/objects/</p><p class="meta">Max file: '+bytes(config.maxFileBytes||0)+'</p><p class="meta">Reconciliation: '+escapeHtml(config.reconcileIntervalMs)+' ms</p><p class="meta">Debounce: '+escapeHtml(config.debounceMs)+' ms</p><p>TimeWarp skips symlinks and common build directories. Agents are not identified from filesystem changes alone. Commands must be explicitly wrapped.</p><p class="warning">Restores change local files only, never package registries, databases, deployments or remote services.</p></div>';
}
async function inspectEvent(n){
  const e=state.events.find(x=>x.id===n);if(!e)return;
  state.selected=n;renderTimeline();
  $("inspector").innerHTML='<div class="inspector-content"><div class="tag">'+escapeHtml(e.eventType.toUpperCase())+' · FILESYSTEM</div><h3>'+escapeHtml(e.relativePath)+'</h3><p class="meta">'+dt(e.timestamp)+'<br>Session '+escapeHtml(short(e.sessionId))+'<br>Before '+escapeHtml(short(e.beforeSnapshotId))+'<br>After '+escapeHtml(short(e.afterSnapshotId))+'<br>Agent attribution: unverified</p><h4>Change diff</h4><div class="diff">Loading actual snapshot objects…</div></div>';
  if(!e.beforeSnapshotId&&!e.afterSnapshotId){$("inspector").querySelector(".diff").textContent="Directory change · no file content diff.";return;}
  try{
    const data=await api("diff?before="+encodeURIComponent(e.beforeSnapshotId||"")+"&after="+encodeURIComponent(e.afterSnapshotId||""));
    const lines=data.diff.split("\n");
    $("inspector").querySelector(".diff").innerHTML=lines.map(line=>'<div class="diff-line '+(line.startsWith("+++")||line.startsWith("---")?"header":line.startsWith("+")?"plus":line.startsWith("-")?"minus":"")+'">'+escapeHtml(line)+'</div>').join("");
  }catch(err){toast(err.message);}
}
async function inspectCheckpoint(id){
  const c=state.checkpoints.find(x=>x.id===id);if(!c)return;
  state.selected=id;
  $("inspector").innerHTML='<div class="inspector-content"><div class="tag">IMMUTABLE CHECKPOINT</div><h3>'+escapeHtml(c.label)+'</h3><p class="meta">'+dt(c.createdAt)+'<br>'+c.fileCount+' files · '+escapeHtml(c.id)+'</p><h4>Differences from working tree</h4><div id="checkpoint-plan">Calculating current file hashes...</div></div>';
  try{
    const plan=await api("restore-plan?id="+encodeURIComponent(id));
    const target=$("checkpoint-plan");if(!target)return;
    const items=plan.operations.slice(0,100).map(op=>'<div class="session-row"><strong>'+escapeHtml(op.action)+' · '+escapeHtml(op.path)+'</strong><small>Current '+escapeHtml(short(op.before))+' → checkpoint '+escapeHtml(short(op.after))+'</small><button class="quiet-button" data-restore-file="'+escapeHtml(op.path)+'" data-restore-checkpoint="'+escapeHtml(id)+'">Restore only this file</button></div>').join("");
    target.innerHTML='<p class="meta">'+plan.created+' create · '+plan.modified+' modify · '+plan.deleted+' delete</p>'+(items||'<p class="good">Working tree already matches this checkpoint.</p>')+(plan.operations.length>100?'<p>Showing first 100 paths. Full restore includes all planned changes.</p>':'')+'<div class="action-row"><button class="danger-button" data-restore="'+escapeHtml(id)+'" '+(!plan.operations.length?"disabled":"")+'>Preview full restore</button></div>';
  }catch(err){toast(err.message);}
}
async function preview(id,path){
  try{
    const q="restore-plan?id="+encodeURIComponent(id)+(path?"&path="+encodeURIComponent(path):"");
    const plan=await api(q);
    if(!plan.operations.length){toast("No changes to restore.");return;}
    state.pending={id,path,plan};
    $("confirm-title").textContent=path?"Restore this file?":"Restore this checkpoint?";
    $("confirm-text").textContent=path?"TimeWarp will change "+path+".":"TimeWarp will change "+plan.operations.length+" file(s) in your project.";
    $("confirm-plan").textContent=plan.created+" created · "+plan.modified+" modified · "+plan.deleted+" deleted\n"+plan.operations.slice(0,10).map(op=>op.action+" "+op.path).join("\n")+(plan.operations.length>10?"\n… and "+(plan.operations.length-10)+" more":"");
    $("confirm-dialog").showModal();
  }catch(e){toast(e.message);}
}
async function createCheckpoint(){
  const label=prompt("Checkpoint name:","Before AI changes");
  if(label===null)return;
  try{const cp=await api("checkpoint",{label:label.trim()||"Manual checkpoint"});toast("Checkpoint saved: "+short(cp.id));await refresh();view("checkpoints");}
  catch(e){toast(e.message);}
}
$("confirm-dialog").addEventListener("close",async()=>{
  if($("confirm-dialog").returnValue!=="confirm"||!state.pending)return;
  const {id,path}=state.pending;state.pending=null;
  $("confirm-apply").disabled=true;
  try{const result=await api("restore",{id,path,confirm:true});toast("Restored "+result.changed+" files. Safety checkpoint "+short(result.safetyCheckpointId));await refresh();view("checkpoints");}
  catch(e){toast("Restore failed: "+e.message);}
  finally{$("confirm-apply").disabled=false;}
});
$("new-checkpoint").addEventListener("click",createCheckpoint);
$("refresh").addEventListener("click",refresh);
$("filter-query").addEventListener("input",renderTimeline);
$("filter-kind").addEventListener("change",renderTimeline);
$("search-trigger").addEventListener("click",()=>{$("filter-query").focus();view("timeline");$("filter-query").focus();});
document.querySelectorAll(".nav-item").forEach(e=>e.addEventListener("click",()=>view(e.dataset.view)));
$("close-inspector").addEventListener("click",()=>{$("inspector").innerHTML='<div class="inspector-empty"><div class="orbit">⌁</div><h3>Inspector cleared</h3><p>Select an item to continue.</p></div>';});
document.addEventListener("click",e=>{
  const button=e.target.closest("button");
  if(!button)return;
  if(button.dataset.event)inspectEvent(Number(button.dataset.event));
  else if(button.dataset.checkpoint)inspectCheckpoint(button.dataset.checkpoint);
  else if(button.dataset.restore)preview(button.dataset.restore);
  else if(button.dataset.restoreFile)preview(button.dataset.restoreCheckpoint,button.dataset.restoreFile);
});
document.addEventListener("keydown",e=>{
  if(!(e.metaKey||e.ctrlKey)){
    if(!["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)&&/^[1-4]$/.test(e.key))view(["timeline","checkpoints","sessions","settings"][Number(e.key)-1]);
    return;
  }
  if(e.key.toLowerCase()==="f"||e.key.toLowerCase()==="k"){e.preventDefault();view("timeline");$("filter-query").focus();}
  else if(e.key.toLowerCase()==="r"){e.preventDefault();refresh();}
  else if(e.key.toLowerCase()==="z"&&e.shiftKey){e.preventDefault();view("checkpoints");}
});
refresh();
