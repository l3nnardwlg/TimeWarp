
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, realpathSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_CONFIG, TimeWarpError, type TimeWarpConfig, type FileRecord, type Checkpoint, type Session, type TimeWarpEvent, type RestorePlan } from "./types.js";

interface Row { [key: string]: unknown; }
const str = (v: unknown) => String(v ?? "");
export class Store {
  readonly root: string;
  readonly dir: string;
  readonly db: DatabaseSync;
  readonly config: TimeWarpConfig;
  constructor(root: string, create = false) {
    this.root = realpathSync(resolve(root));
    this.dir = join(this.root, ".timewarp");
    if (!existsSync(this.dir) && !create) throw new TimeWarpError("Not initialized. Run timewarp init first.", "NOT_INITIALIZED");
    if (create) mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (!existsSync(this.dir)) throw new TimeWarpError("TimeWarp state directory is missing.", "NOT_INITIALIZED");
    try { chmodSync(this.dir, 0o700); } catch { /* Windows */ }
    const configPath = join(this.dir, "config.json");
    if (create && !existsSync(configPath)) writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    let user: unknown = {};
    try { user = JSON.parse(readFileSync(configPath, "utf8")); } catch (e) {
      if (existsSync(configPath)) throw new TimeWarpError("Invalid .timewarp/config.json: " + String(e), "BAD_CONFIG");
    }
    if (typeof user !== "object" || user === null || Array.isArray(user)) throw new TimeWarpError("Configuration must be an object.", "BAD_CONFIG");
    const c = { ...DEFAULT_CONFIG, ...user as Partial<TimeWarpConfig> };
    for (const key of ["maxFileBytes", "reconcileIntervalMs", "debounceMs"] as const) {
      if (!Number.isSafeInteger(c[key]) || c[key] < 1) throw new TimeWarpError("Invalid configuration: " + key, "BAD_CONFIG");
    }
    this.config = c;
    this.db = new DatabaseSync(join(this.dir, "timeline.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.db.exec([
      "CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT, kind TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, timestamp TEXT NOT NULL, event_type TEXT NOT NULL, path TEXT NOT NULL, before_sha TEXT, after_sha TEXT, source TEXT NOT NULL, agent_id TEXT, metadata TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id,id)",
      "CREATE TABLE IF NOT EXISTS file_state(path TEXT PRIMARY KEY, sha TEXT NOT NULL, size INTEGER NOT NULL, mode INTEGER NOT NULL, mtime_ms REAL NOT NULL)",
      "CREATE TABLE IF NOT EXISTS directory_state(path TEXT PRIMARY KEY)",
      "CREATE TABLE IF NOT EXISTS checkpoints(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, label TEXT NOT NULL, session_id TEXT, file_count INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS checkpoint_files(checkpoint_id TEXT NOT NULL, path TEXT NOT NULL, sha TEXT NOT NULL, size INTEGER NOT NULL, mode INTEGER NOT NULL, mtime_ms REAL NOT NULL, PRIMARY KEY(checkpoint_id,path), FOREIGN KEY(checkpoint_id) REFERENCES checkpoints(id))",
      "CREATE TABLE IF NOT EXISTS restore_operations(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL, checkpoint_id TEXT NOT NULL, safety_id TEXT NOT NULL, plan_json TEXT NOT NULL, last_step INTEGER NOT NULL DEFAULT -1, error TEXT)",
      "CREATE INDEX IF NOT EXISTS idx_restore_status ON restore_operations(status,created_at)"
    ].join(";") + ";");
  }
  close() { this.db.close(); }
  transaction(fn: () => void) {
    this.db.exec("BEGIN IMMEDIATE");
    try { fn(); this.db.exec("COMMIT"); } catch(e) { this.db.exec("ROLLBACK"); throw e; }
  }
  startSession(kind = "watch"): Session {
    const s: Session = { id: randomUUID(), startedAt: new Date().toISOString(), endedAt: null, kind };
    this.db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(s.id, s.startedAt, s.endedAt, s.kind);
    return s;
  }
  endSession(id: string) { this.db.prepare("UPDATE sessions SET ended_at=? WHERE id=?").run(new Date().toISOString(), id); }
  sessions(limit = 50): Session[] {
    return (this.db.prepare("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?").all(limit) as Row[]).map(r=>({id:str(r.id),startedAt:str(r.started_at),endedAt:r.ended_at ? str(r.ended_at):null,kind:str(r.kind)}));
  }
  events(limit = 200, session?: string): TimeWarpEvent[] {
    const q = session ? this.db.prepare("SELECT * FROM events WHERE session_id=? ORDER BY id DESC LIMIT ?").all(session, limit) : this.db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit);
    return (q as Row[]).map(r=>({id:Number(r.id),sessionId:str(r.session_id),timestamp:str(r.timestamp),eventType:str(r.event_type) as TimeWarpEvent["eventType"],relativePath:str(r.path),beforeSnapshotId:r.before_sha ? str(r.before_sha):null,afterSnapshotId:r.after_sha ? str(r.after_sha):null,source:str(r.source) as TimeWarpEvent["source"],agentId:r.agent_id ? str(r.agent_id):null,metadata:JSON.parse(str(r.metadata)) as Record<string,unknown>}));
  }
  log(session: string, type: string, path: string, before: string|null, after: string|null, metadata: Record<string, unknown>={}) {
    this.db.prepare("INSERT INTO events(session_id,timestamp,event_type,path,before_sha,after_sha,source,agent_id,metadata) VALUES(?,?,?,?,?,?,?,?,?)").run(session,new Date().toISOString(),type,path,before,after,"filesystem",null,JSON.stringify(metadata));
  }
  state(): Map<string,FileRecord> {
    return new Map((this.db.prepare("SELECT * FROM file_state").all() as Row[]).map(r=>[str(r.path),{path:str(r.path),sha:str(r.sha),size:Number(r.size),mode:Number(r.mode),mtimeMs:Number(r.mtime_ms)}]));
  }
  directories(): Set<string> { return new Set((this.db.prepare("SELECT path FROM directory_state").all() as Row[]).map(r=>str(r.path))); }
  replaceState(files: FileRecord[], dirs: string[]) {
    this.transaction(()=>{
      this.db.exec("DELETE FROM file_state; DELETE FROM directory_state;");
      const f=this.db.prepare("INSERT INTO file_state VALUES(?,?,?,?,?)");
      for (const r of files) f.run(r.path,r.sha,r.size,r.mode,r.mtimeMs);
      const d=this.db.prepare("INSERT INTO directory_state VALUES(?)");
      for (const p of dirs) d.run(p);
    });
  }
  saveCheckpoint(cp: Checkpoint, files: FileRecord[]) {
    this.transaction(()=>{
      this.db.prepare("INSERT INTO checkpoints VALUES(?,?,?,?,?)").run(cp.id,cp.createdAt,cp.label,cp.sessionId,cp.fileCount);
      const s=this.db.prepare("INSERT INTO checkpoint_files VALUES(?,?,?,?,?,?)");
      for (const f of files) s.run(cp.id,f.path,f.sha,f.size,f.mode,f.mtimeMs);
    });
  }
  checkpoints(limit=100): Checkpoint[] {
    return (this.db.prepare("SELECT * FROM checkpoints ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(r=>({id:str(r.id),createdAt:str(r.created_at),label:str(r.label),sessionId:r.session_id?str(r.session_id):null,fileCount:Number(r.file_count)}));
  }
  checkpoint(id: string): Checkpoint {
    const r=this.db.prepare("SELECT * FROM checkpoints WHERE id=?").get(id) as Row|undefined;
    if (!r) throw new TimeWarpError("Checkpoint not found: " + id, "NOT_FOUND");
    return {id:str(r.id),createdAt:str(r.created_at),label:str(r.label),sessionId:r.session_id?str(r.session_id):null,fileCount:Number(r.file_count)};
  }
  checkpointFiles(id: string): Map<string,FileRecord> {
    this.checkpoint(id);
    return new Map((this.db.prepare("SELECT path,sha,size,mode,mtime_ms FROM checkpoint_files WHERE checkpoint_id=?").all(id) as Row[]).map(r=>[str(r.path),{path:str(r.path),sha:str(r.sha),size:Number(r.size),mode:Number(r.mode),mtimeMs:Number(r.mtime_ms)}]));
  }
  addRestore(id: string,target: string,safety: string, plan: RestorePlan) {
    this.db.prepare("INSERT INTO restore_operations(id,created_at,status,checkpoint_id,safety_id,plan_json,last_step) VALUES(?,?,?,?,?,?,-1)").run(id,new Date().toISOString(),"applying",target,safety,JSON.stringify(plan));
  }
  restoreStep(id: string,index: number) { this.db.prepare("UPDATE restore_operations SET last_step=? WHERE id=?").run(index,id); }
  restoreStatus(id: string,status: string,error: string|null=null) { this.db.prepare("UPDATE restore_operations SET status=?,error=? WHERE id=?").run(status,error,id); }
  pending(): Row[] { return this.db.prepare("SELECT * FROM restore_operations WHERE status IN ('applying','recovery_required','recovering') ORDER BY created_at").all() as Row[]; }
  lastSuccessful(): Row|undefined { return this.db.prepare("SELECT * FROM restore_operations WHERE status='completed' ORDER BY created_at DESC LIMIT 1").get() as Row|undefined; }
  stats() {
    const events = this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as Row;
    const blobs = this.db.prepare("SELECT COUNT(DISTINCT sha) AS n, COALESCE(SUM(size),0) AS bytes FROM (SELECT sha,MAX(size) AS size FROM checkpoint_files GROUP BY sha)").get() as Row;
    return {project:this.root,events:Number(events.n),sessions:this.sessions(10),checkpoints:this.checkpoints(10),storedBlobs:Number(blobs.n),logicalBlobBytes:Number(blobs.bytes),pendingRecovery:this.pending().length,config:this.config};
  }
  configPath(){return join(this.dir,"config.json");}
}
export function projectRoot(path = "."): string {
  let current = realpathSync(resolve(path));
  while (true) {
    if (existsSync(join(current,".timewarp"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new TimeWarpError("Not initialized. Run timewarp init in the project root.", "NOT_INITIALIZED");
    current=parent;
  }
}
