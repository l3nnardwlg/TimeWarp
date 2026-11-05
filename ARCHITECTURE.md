# Architecture

TimeWarp uses a **TypeScript-first, local-first** monorepo.

~~~text
apps/desktop (React/Tauri)
      │ launches local CLI via Rust
      ▼
packages/cli (commands + token-authenticated loopback HTTP API)
      │
      ▼
packages/core
      ├── store.ts       SQLite schema, sessions, events, checkpoints, journals
      ├── files.ts       exclusions, path checks, streamed content objects
      ├── snapshots.ts   checkpoint capture, validation, garbage collection
      ├── recorder.ts    watcher, reconciliation, event normalization
      ├── diff.ts        checkpoint and bounded textual diff
      └── restore.ts     preflight, safety checkpoint, apply, undo, recovery
~~~

## Disk model

Local SQLite tables: sessions, events, file_state, directory_state, checkpoints, checkpoint_files, restore_operations; the process wrapper creates a commands table lazily.

Immutable file content uses SHA-256 and is stored under **.timewarp/objects/aa/sha256**. Checkpoint manifests reference blobs by digest. The object store is independent of Git and can reconstruct states after process restarts.

SQLite uses WAL and FULL synchronous mode. Events are ordered by persisted insertion ID, not by an inferred agent timeline.

## Recorder semantics

The native recursive watcher signals a need to reconcile. Reconciliation enumerates visible paths and hashes changed files; it also runs periodically to discover missed changes. Rapid intermediate writes may be coalesced. Rename detection is a best-effort same-hash match. Observed filesystem events have source=filesystem and agentId=null.

## Safe restore state machine

1. Plan target differences against the current real working tree.
2. Validate paths, snapshot objects and available disk space.
3. Capture the whole current project as a safety checkpoint.
4. Verify the planned original file hashes still match.
5. Insert a persisted restore journal entry.
6. For each file, check the precondition, write a temporary file and atomically replace it where possible, then verify its digest.
7. Update tracked state; mark operation completed.
8. If interrupted, block further restore and use explicit recovery to replay the safety checkpoint.

There is **no universal transaction across filesystem files**. The journal makes deterministic manual recovery possible; it cannot protect against malicious writers or physical storage failure.

## UI and transport

The CLI serves its real SQLite-backed data to a browser on 127.0.0.1, using a random process token and Origin/Host validation. The React/Tauri companion starts that CLI service via Rust and uses a bearer token passed through native IPC. This companion depends on the CLI being installed or configured via TIMEWARP_CLI_PATH.

No cloud service or AI API is required. Agent-specific hooks are intentionally not invented.
