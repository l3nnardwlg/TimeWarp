# ⏪ TimeWarp

**Your AI broke your project? Rewind everything.**

TimeWarp is a local-first development flight recorder. Observe real filesystem changes, inspect an interactive timeline, save immutable checkpoints, preview exactly what a restore will change, and safely recover files after an AI coding agent goes wrong.

> **Development status:** v0.1.0 release candidate in progress. The CLI and local UI are implemented and covered by CI, but npm publication, native desktop installers, performance benchmarks and final security validation are still pending. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Quick demo

Build from source:

~~~bash
git clone https://github.com/l3nnardwlg/TimeWarp.git
cd TimeWarp
corepack enable
pnpm install
pnpm build
pnpm test
~~~

Initialize an existing project:

~~~bash
node /path/to/TimeWarp/packages/cli/dist/cli.js init /path/to/project
node /path/to/TimeWarp/packages/cli/dist/cli.js watch /path/to/project
~~~

Let your AI assistant edit files. Stop the watcher with Ctrl+C. Then inspect changes, save a checkpoint or open the real local dashboard:

~~~bash
node /path/to/TimeWarp/packages/cli/dist/cli.js timeline --project /path/to/project
node /path/to/TimeWarp/packages/cli/dist/cli.js checkpoints --project /path/to/project
node /path/to/TimeWarp/packages/cli/dist/cli.js ui --project /path/to/project
~~~

The browser dashboard is served from **http://127.0.0.1:47329**. It shows recorded events, real file diffs, checkpoint manifests and explicit restore previews.

## Rewind safely

~~~bash
# Preview file operations: this does not change the working tree.
timewarp restore <checkpoint-id>

# Confirm: save a safety checkpoint, restore and verify content.
timewarp restore <checkpoint-id> --yes

# Recover from the most recent completed restore.
timewarp undo --yes

# If a restoration was interrupted, stop other writers first.
timewarp recover --yes
~~~

Use the built CLI path in place of <code>timewarp</code> unless you have linked the command to your PATH.

## Main features

| Feature | Current implementation |
| --- | --- |
| File recording | Native recursive watcher where available plus periodic reconciliation scans |
| Events | Creates, edits, deletes, detectable renames, directory changes and permission changes |
| Storage | SQLite metadata, local SHA-256 content-addressed blob store |
| Snapshots | Durable immutable checkpoints with deduplication and hash verification |
| Restoration | Exact file-level preview, safety checkpoint, guarded apply, verification and recovery journal |
| Timeline | Chronological events with file, type, session and content diffs |
| Interface | Dark responsive loopback dashboard plus React/Tauri desktop companion source |
| Process wrapper | Explicit command metadata and filesystem reconciliation |
| Privacy | Offline by design, no telemetry or API key required |
| Agent attribution | Never guessed from filesystem activity |

## CLI reference

| Command | Purpose |
| --- | --- |
| <code>timewarp init [path]</code> | Initialize a new local recording project |
| <code>timewarp watch [path]</code> | Watch changes until Ctrl+C |
| <code>timewarp status --json</code> | Show machine-readable stats |
| <code>timewarp sessions</code> | List recorded sessions |
| <code>timewarp timeline --limit 100</code> | Inspect recorded events |
| <code>timewarp checkpoint "label"</code> | Capture a project checkpoint |
| <code>timewarp checkpoints</code> | List available checkpoints |
| <code>timewarp diff &lt;a&gt; &lt;b&gt;</code> | Compare checkpoint file contents |
| <code>timewarp restore &lt;id&gt;</code> | Preview full restore |
| <code>timewarp restore &lt;id&gt; --yes</code> | Apply full restore |
| <code>timewarp restore-file &lt;path&gt; --checkpoint &lt;id&gt; --yes</code> | Restore one file |
| <code>timewarp undo --yes</code> | Undo latest completed restore |
| <code>timewarp recover --yes</code> | Recover interrupted restore |
| <code>timewarp run -- npm test</code> | Record an explicitly wrapped process |
| <code>timewarp doctor</code> | Verify latest checkpoint integrity |
| <code>timewarp config</code> | Show or change project configuration |
| <code>timewarp gc</code> | Remove unreferenced objects |
| <code>timewarp ui</code> | Launch loopback dashboard |

Commands that modify files require **--yes** and never execute commands from historical events. JSON output is available for CLI automation.

## Installation / package status

- **Node.js 22.13+** is required. Node 24 is recommended for its newer built-in SQLite implementation. Node 22 may print an experimental warning.
- macOS, Windows and Linux are exercised in the CLI's Node 22/24 CI matrix.
- pnpm 10 is used for building. Rust stable and Tauri 2 platform prerequisites are additionally required for native desktop compilation.

You can build a standalone npm installation tarball without any unpublished internal dependency:

~~~bash
pnpm install && pnpm build
npm pack ./packages/cli/release
~~~

**The package has not been published.** The npm name <code>timewarp-dev</code> is provisional until name availability and ownership are confirmed. A future published CLI will support <code>npx timewarp-dev watch .</code>.

## Local-only privacy

TimeWarp stores data under your project's **.timewarp/** folder. Add that directory to your own project's <code>.gitignore</code> to avoid committing source snapshots.

Create a <code>.timewarpignore</code> before recording sensitive projects:

~~~gitignore
.env
.env.*
private/
*.pem
*.key
~~~

Default exclusions include Git internals, TimeWarp's own storage, node_modules, dist, build and common caches. Excluding a file later does not erase historical snapshots already taken. Captured contents are **not encrypted at rest**.

### What TimeWarp cannot undo

- Database mutations, remote API calls or cloud deployments.
- Dependencies installed, commands run, Git pushes and external side effects.
- Symlink targets and unsupported filesystem metadata.
- Every intermediate write made between watcher observations.

Restoration is not globally atomic across multiple files; individual replacements are atomic only where supported by the underlying filesystem. If power loss or another error interrupts a restore, use the manual recovery command. **Keep independent backups.**

## Known limitations

- Agent integrations for Claude Code, Codex and Cursor are not implemented yet; raw filesystem changes are intentionally marked un-attributed.
- Concurrent independent restores are not yet serialized with a project-wide interprocess lock.
- Reconciliation may coalesce rapid edits; file contents larger than the configurable max (32 MiB default) are rejected rather than silently skipped.
- Diff rendering is bounded for responsiveness; binary/large files have no inline text diff.
- Directory events are recorded, but exact empty-directory restoration is not yet available.
- Retention quotas, encryption and verified 50k-file benchmarks remain planned.
- The desktop native installers and signing/notarization are not verified yet.
- Real application screenshots will be added after validated native builds; this README intentionally contains none.

## Build, maintain and contribute

[Contribution guide](CONTRIBUTING.md) · [Architecture](ARCHITECTURE.md) · [Security](SECURITY.md) · [Development](DEVELOPMENT.md) · [Roadmap](docs/ROADMAP.md) · [Demo script](docs/DEMO.md) · [Changelog](CHANGELOG.md)

MIT licensed. Unaffiliated with any AI agent vendor.
