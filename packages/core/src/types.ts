
export type EventKind = "created" | "modified" | "deleted" | "renamed" | "chmod" | "directory-created" | "directory-deleted";
export interface TimeWarpEvent {
  id: number; sessionId: string; timestamp: string; eventType: EventKind;
  relativePath: string; beforeSnapshotId: string | null; afterSnapshotId: string | null;
  source: "filesystem" | "process" | "agent"; agentId: string | null;
  metadata: Record<string, unknown>;
}
export interface FileRecord { path: string; sha: string; size: number; mode: number; mtimeMs: number; }
export interface Session { id: string; startedAt: string; endedAt: string | null; kind: string; }
export interface Checkpoint { id: string; createdAt: string; label: string; sessionId: string | null; fileCount: number; }
export interface RestoreOperation { action: "create" | "modify" | "delete"; path: string; before: string | null; after: string | null; mode?: number; }
export interface RestorePlan { checkpointId: string; operations: RestoreOperation[]; created: number; modified: number; deleted: number; }
export interface TimeWarpConfig { maxFileBytes: number; reconcileIntervalMs: number; debounceMs: number; }
export const DEFAULT_CONFIG: TimeWarpConfig = { maxFileBytes: 32 * 1024 * 1024, reconcileIntervalMs: 10000, debounceMs: 450 };
export class TimeWarpError extends Error { constructor(message: string, public readonly code = "TIMEWARP_ERROR") { super(message); this.name = "TimeWarpError"; } }
