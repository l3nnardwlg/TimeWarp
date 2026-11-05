
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { Activity, ArrowLeft, ArrowRight, Check, ChevronRight, Clock3, Code2, Command, Database, FileClock, FileDiff, FilePlus2, Folder, GitBranch, HardDrive, History, Lock, Play, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles, Terminal, Trash2, X } from "lucide-react";
import "./style.css";

type View = "timeline" | "checkpoints" | "sessions";
type Event = { id:number;sessionId:string;timestamp:string;eventType:string;relativePath:string;beforeSnapshotId:string|null;afterSnapshotId:string|null;source:string;agentId:string|null;metadata:Record<string,unknown> };
type Checkpoint = {id:string;label:string;createdAt:string;fileCount:number};
type Session = {id:string;startedAt:string;endedAt:string|null;kind:string};
type Op = {path:string;action:"create"|"modify"|"delete";before:string|null;after:string|null};
type Plan = {checkpointId:string;operations:Op[];created:number;modified:number;deleted:number};
type Stats = {project:string;events:number;logicalBlobBytes:number;pendingRecovery:number;config:{maxFileBytes:number}};
type Connection = {port:number;token:string};
type Selection = {kind:"event";event:Event}|{kind:"checkpoint";checkpoint:Checkpoint};

const formatTime=(v:string)=>new Date(v).toLocaleString();
const formatBytes=(v:number)=>v<1024?v+" B":v<1048576?(v/1024).toFixed(1)+" KB":(v/1048576).toFixed(1)+" MB";
const short=(v:string|null)=>v?v.slice(0,11):"none";

function App(){
  const [folder,setFolder]=useState("");
  const [connection,setConnection]=useState<Connection|null>(null);
  const [connecting,setConnecting]=useState(false);
  const [error,setError]=useState("");
  const [view,setView]=useState<View>("timeline");
  const [events,setEvents]=useState<Event[]>([]);
  const [checkpoints,setCheckpoints]=useState<Checkpoint[]>([]);
  const [sessions,setSessions]=useState<Session[]>([]);
  const [stats,setStats]=useState<Stats|null>(null);
  const [filter,setFilter]=useState("");
  const [kind,setKind]=useState("");
  const [selected,setSelected]=useState<Selection|null>(null);
  const [diff,setDiff]=useState("");
  const [plan,setPlan]=useState<Plan|null>(null);
  const [confirmPlan,setConfirmPlan]=useState<{plan:Plan;path?:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");

  const api=useCallback(async<T,>(endpoint:string,data?:Record<string,unknown>):Promise<T>=>{
    if(!connection)throw new Error("Not connected");
    const res=await fetch("http://127.0.0.1:"+connection.port+"/api/"+endpoint,{
      method:data?"POST":"GET",
      headers:{"X-Timewarp-Token":connection.token,...(data?{"Content-Type":"application/json"}:{})},
      body:data?JSON.stringify(data):undefined
    });
    const result:unknown=await res.json();
    if(!res.ok)throw new Error(typeof result==="object"&&result&&"error" in result?String(result.error):"Request failed");
    return result as T;
  },[connection]);
  const refresh=useCallback(async()=>{
    if(!connection)return;
    try{
      const [nextStats,nextEvents,nextCheckpoints,nextSessions]=await Promise.all([
        api<Stats>("status"),api<Event[]>("timeline?limit=10000"),
        api<Checkpoint[]>("checkpoints"),api<Session[]>("sessions")
      ]);
      setStats(nextStats);setEvents(nextEvents);setCheckpoints(nextCheckpoints);setSessions(nextSessions);
      setError("");
    }catch(e){setError(String(e));}
  },[api,connection]);
  useEffect(()=>{void refresh();const t=setInterval(()=>void refresh(),5000);return()=>clearInterval(t);},[refresh]);
  useEffect(()=>{
    const shortcuts=(e:KeyboardEvent)=>{
      if(!(e.ctrlKey||e.metaKey))return;
      if(e.key.toLowerCase()==="f"||e.key.toLowerCase()==="k"){e.preventDefault();setView("timeline");document.getElementById("filter")?.focus();}
      if(e.key.toLowerCase()==="r"){e.preventDefault();void refresh();}
      if(e.key.toLowerCase()==="z"&&e.shiftKey){e.preventDefault();setView("checkpoints");}
    };
    window.addEventListener("keydown",shortcuts);return()=>window.removeEventListener("keydown",shortcuts);
  },[refresh]);
  async function connect(){
    if(!folder.trim())return setError("Enter the full path of an initialized project.");
    setConnecting(true);setError("");
    try{
      const result=await invoke<Connection>("launch_timewarp",{projectPath:folder.trim()});
      setConnection(result);
    }catch(e){setError(String(e));}
    finally{setConnecting(false);}
  }
  async function inspectEvent(event:Event){
    setSelected({kind:"event",event});setPlan(null);setDiff("Loading actual snapshot objects…");
    try{const out=await api<{diff:string}>("diff?before="+encodeURIComponent(event.beforeSnapshotId||"")+"&after="+encodeURIComponent(event.afterSnapshotId||""));setDiff(out.diff);}
    catch(e){setDiff(String(e));}
  }
  async function inspectCheckpoint(c:Checkpoint){
    setSelected({kind:"checkpoint",checkpoint:c});setPlan(null);
    try{setPlan(await api<Plan>("restore-plan?id="+encodeURIComponent(c.id)));}
    catch(e){setError(String(e));}
  }
  async function previewRestore(id:string,path?:string){
    try{
      const q="restore-plan?id="+encodeURIComponent(id)+(path?"&path="+encodeURIComponent(path):"");
      const value=await api<Plan>(q);
      if(!value.operations.length){setNotice("Already matches the selected checkpoint.");return;}
      setConfirmPlan({plan:value,path});
    }catch(e){setError(String(e));}
  }
  async function applyRestore(){
    if(!confirmPlan)return;
    setBusy(true);setError("");
    try{
      const result=await api<{safetyCheckpointId:string;changed:number}>("restore",{id:confirmPlan.plan.checkpointId,path:confirmPlan.path,confirm:true});
      setNotice("Restored "+result.changed+" file(s). Reversible via safety checkpoint "+short(result.safetyCheckpointId)+".");
      setConfirmPlan(null);setSelected(null);await refresh();
    }catch(e){setError(String(e));setConfirmPlan(null);}
    finally{setBusy(false);}
  }
  async function createCheckpoint(){
    const name=window.prompt("Checkpoint name","Before AI changes");
    if(name===null)return;
    setBusy(true);
    try{
      const cp=await api<Checkpoint>("checkpoint",{label:name.trim()||"Manual checkpoint"});
      setNotice("Saved checkpoint "+short(cp.id));setView("checkpoints");await refresh();
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function undoLast(){
    if(!window.confirm("Undo the most recent completed restore? A new safety checkpoint will be created first."))return;
    setBusy(true);
    try{await api("undo",{confirm:true});setNotice("The last restore was undone.");await refresh();}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  const filtered=events.filter(e=>(!kind||e.eventType===kind)&&e.relativePath.toLowerCase().includes(filter.toLowerCase()));
  const iconFor=(event:Event)=>{
    switch(event.eventType){
      case "created":return <FilePlus2 size={16}/>;
      case "deleted":return <Trash2 size={16}/>;
      case "renamed":return <ArrowRight size={16}/>;
      default:return <FileDiff size={16}/>;
    }
  };
  if(!connection)return <div className="connect-shell"><div className="connect-card">
    <div className="logo-large"><History size={33}/></div>
    <div className="overline">WELCOME TO TIMEWARP</div>
    <h1>Development time travel.<br/><span>Without the time machine.</span></h1>
    <p>Connect a local project to inspect every recorded change and safely recover an earlier state.</p>
    <label htmlFor="project-path">PROJECT DIRECTORY</label>
    <div className="path-input"><Folder size={20}/><input id="project-path" value={folder} onChange={e=>setFolder(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void connect();}} placeholder="/path/to/your/project" autoFocus/></div>
    {error&&<div className="error">{error}</div>}
    <button disabled={connecting} className="btn primary connect-button" onClick={()=>void connect()}>{connecting?"Connecting…":"Open project"}<ArrowRight size={17}/></button>
    <div className="connect-hint"><Terminal size={16}/> Initialize first: <code>timewarp init</code></div>
    <div className="trust"><Lock size={15}/> LOCAL-FIRST <span>·</span> NO CLOUD <span>·</span> NO TELEMETRY</div>
  </div></div>;
  return <div className="layout">
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol"><History size={23}/></div><div><strong>TimeWarp</strong><small>DEVELOPER EDITION</small></div></div>
      <p className="menu-label">WORKSPACE</p>
      <nav>{([
        ["timeline",Activity,"Activity timeline"],["checkpoints",FileClock,"Checkpoints"],["sessions",Clock3,"Sessions"]
      ] as const).map(([name,Icon,label])=><button key={name} className={"nav "+(view===name?"active":"")} onClick={()=>{setView(name);setSelected(null);}}><Icon size={18}/>{label}<ChevronRight size={14} className="chevron"/></button>)}</nav>
      <div className="nav-help"><div className="local-status"><span className="status-dot"/> LOCAL RECORDING DATA</div><p>Nothing is sent to an external server. You control all snapshots.</p></div>
    </aside>
    <div className="page">
      <header className="topbar">
        <div className="crumb">WORKSPACE <ChevronRight size={13}/> <span>{stats?.project.split(/[\\/]/).filter(Boolean).pop()||"Project"}</span></div>
        <div className="actions"><button className="btn ghost" onClick={()=>void undoLast()} disabled={busy}><RotateCcw size={15}/> Undo restore</button><button className="btn ghost icon-only" title="Refresh" onClick={()=>void refresh()}><RefreshCw size={17}/></button><button className="btn primary" disabled={busy} onClick={()=>void createCheckpoint()}><Plus size={17}/> Checkpoint</button></div>
      </header>
      <main className="content">
        <div className="top-label"><Sparkles size={13}/> YOUR LOCAL DEV FLIGHT RECORDER</div>
        <div className="headline"><div><h1>{view==="timeline"?"Activity timeline":view==="checkpoints"?"Checkpoints":"Recording sessions"}</h1><p>{view==="timeline"?"Everything TimeWarp observed, in chronological order.":view==="checkpoints"?"Immutable recovery points for your project.":"History of explicitly started recording sessions."}</p></div><div className="tag">PRIVATE PROJECT</div></div>
        {error&&<div className="error banner">{error}</div>}
        {notice&&<div className="notice banner"><Check size={16}/>{notice}<button onClick={()=>setNotice("")}><X size={14}/></button></div>}
        {stats?.pendingRecovery? <div className="error banner">Interrupted restoration detected. Use <code>timewarp recover --yes</code> in the CLI before restoring further files.</div>:null}
        <div className="metrics">
          <div className="metric"><span>Recorded events</span><strong>{stats?.events.toLocaleString()??"—"}</strong><small>Observed file changes</small></div>
          <div className="metric"><span>Checkpoints</span><strong>{checkpoints.length}</strong><small>Recoverable states</small></div>
          <div className="metric"><span>Sessions</span><strong>{sessions.length}</strong><small>Historical sessions</small></div>
          <div className="metric"><span>Snapshot storage</span><strong>{formatBytes(stats?.logicalBlobBytes??0)}</strong><small>Deduplicated checkpoint data</small></div>
        </div>
        <div className="work">
          <section className="feed-card">
            <div className="card-title"><div><h2>{view==="timeline"?"Timeline":view==="checkpoints"?"Saved states":"Sessions"}</h2><p>{view==="timeline"?"Verified filesystem observations":"Local metadata stored in SQLite"}</p></div><span className="counter">{view==="timeline"?filtered.length:view==="checkpoints"?checkpoints.length:sessions.length} entries</span></div>
            {view==="timeline"&&<div className="filters"><label><Search size={17}/><input id="filter" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Search by filename..."/></label><select aria-label="Event type" value={kind} onChange={e=>setKind(e.target.value)}><option value="">All changes</option><option value="created">Created</option><option value="modified">Modified</option><option value="deleted">Deleted</option><option value="renamed">Renamed</option><option value="chmod">Permissions</option></select></div>}
            <div className="feed-scroll">
            {view==="timeline"&&(filtered.length?filtered.map(event=><button key={event.id} className={"entry "+(selected?.kind==="event"&&selected.event.id===event.id?"active":"")} onClick={()=>void inspectEvent(event)}><span className={"event-icon "+event.eventType}>{iconFor(event)}</span><span className="entry-main"><b>{event.relativePath}</b><small>{event.eventType} · origin not attributed</small></span><time>{new Date(event.timestamp).toLocaleTimeString()}</time></button>):<div className="empty">No file changes match the filter.<br/>Start <code>timewarp watch .</code> and modify a file.</div>)}
            {view==="checkpoints"&&(checkpoints.length?checkpoints.map(cp=><button key={cp.id} className={"entry "+(selected?.kind==="checkpoint"&&selected.checkpoint.id===cp.id?"active":"")} onClick={()=>void inspectCheckpoint(cp)}><span className="event-icon checkpoint"><GitBranch size={17}/></span><span className="entry-main"><b>{cp.label}</b><small>{formatTime(cp.createdAt)} · {cp.fileCount} files</small></span><ChevronRight size={16}/></button>):<div className="empty">No checkpoints exist yet.</div>)}
            {view==="sessions"&&(sessions.length?sessions.map(s=><div key={s.id} className="session-entry"><span className="event-icon checkpoint">{s.kind==="watch"?<Activity size={17}/>:<Command size={17}/>}</span><div className="entry-main"><b>{s.kind==="watch"?"Watch session":"Wrapped process"}</b><small>{formatTime(s.startedAt)} → {s.endedAt?formatTime(s.endedAt):"No end timestamp"}<br/>{short(s.id)}</small></div></div>):<div className="empty">No sessions recorded yet.</div>)}
            </div>
          </section>
          <section className="inspector-card">
            <div className="inspector-top"><span>INSPECTOR</span><button title="Clear selection" onClick={()=>{setSelected(null);setPlan(null);}}><X size={17}/></button></div>
            {!selected?<div className="inspector-placeholder"><div className="placeholder-symbol"><Code2 size={30}/></div><h3>Every change has a story.</h3><p>Select an event or checkpoint to inspect recorded data or preview a safe restore.</p></div>:null}
            {selected?.kind==="event"&&<div className="inspector-detail"><div className="overline">FILESYSTEM · {selected.event.eventType.toUpperCase()}</div><h3>{selected.event.relativePath}</h3><div className="metadata">Observed: {formatTime(selected.event.timestamp)}<br/>Session: {short(selected.event.sessionId)}<br/>Agent: unknown / not attributed<br/>Before: {short(selected.event.beforeSnapshotId)}<br/>After: {short(selected.event.afterSnapshotId)}</div><h4>Content diff</h4><div className="diff">{diff.split("\n").map((line,i)=><div key={i} className={line.startsWith("+")?"add":line.startsWith("-")?"remove":""}>{line||" "}</div>)}</div></div>}
            {selected?.kind==="checkpoint"&&<div className="inspector-detail"><div className="overline">RESTORABLE CHECKPOINT</div><h3>{selected.checkpoint.label}</h3><div className="metadata">{formatTime(selected.checkpoint.createdAt)}<br/>ID: {selected.checkpoint.id}<br/>{selected.checkpoint.fileCount} files</div>{!plan?<p>Inspecting current working files…</p>:<><div className="plan-totals">{plan.created} create · {plan.modified} modify · {plan.deleted} delete</div><div className="operation-list">{plan.operations.slice(0,100).map(op=><div className="operation" key={op.path}><span>{op.action}</span><b title={op.path}>{op.path}</b><button title="Restore only this file" onClick={()=>void previewRestore(plan.checkpointId,op.path)}><RotateCcw size={14}/></button></div>)}</div><button className="btn danger full" onClick={()=>void previewRestore(selected.checkpoint.id)} disabled={!plan.operations.length}><RotateCcw size={16}/> Preview full restore</button>{plan.operations.length===0&&<p className="safe-note"><ShieldCheck size={16}/> Working tree matches this checkpoint.</p>}</>}</div>}
          </section>
        </div>
        <footer><ShieldCheck size={14}/> TimeWarp v0.1.0 · Local-first · No telemetry <span>External side effects cannot be restored.</span></footer>
      </main>
    </div>
    {confirmPlan&&<div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-heading"><div className="modal-icon"><RotateCcw size={23}/></div><h2 id="confirm-heading">Confirm restoration</h2><p>You are about to modify {confirmPlan.plan.operations.length} local file(s). This cannot undo deployments, database changes or arbitrary commands.</p><div className="plan-totals">{confirmPlan.plan.created} created · {confirmPlan.plan.modified} modified · {confirmPlan.plan.deleted} deleted</div><div className="modal-operations">{confirmPlan.plan.operations.slice(0,12).map(op=><div key={op.path}><span>{op.action}</span>{op.path}</div>)}</div><p className="safe-note"><ShieldCheck size={16}/> A reversible safety checkpoint is created before any change.</p><div className="modal-actions"><button className="btn ghost" disabled={busy} onClick={()=>setConfirmPlan(null)}>Cancel</button><button className="btn danger" disabled={busy} onClick={()=>void applyRestore()}>{busy?"Restoring…":"Confirm restore"}</button></div></div></div>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
