# Security policy

## Status and reporting

TimeWarp 0.1.0 is under active development. Do not rely on it as the only backup for important work.

For vulnerabilities, use GitHub's private vulnerability reporting / advisory channel if enabled. If unavailable, create an issue requesting a private reporting channel **without publishing details, secrets or exploits**.

## Boundaries

- No telemetry or automatic external uploads. All snapshots remain local.
- State files are stored under **PROJECT/.timewarp/** with restrictive permissions where supported.
- SQLite metadata and SHA-256 object blobs are **not encrypted at rest**. Protect the local account and disk.
- The dashboard binds to 127.0.0.1 only and requires a random bearer token for API calls. Do not expose or reverse-proxy it.
- Path validation prevents relative traversal and restore via detected symlinks. A trusted local filesystem is assumed; adversarial concurrent path mutation remains a threat.
- Restoration includes hash preflight, safety checkpoints and a progress journal. Multi-file atomicity is not guaranteed.
- Sensitive files may be recorded unless excluded. Configure .timewarpignore before starting; excluding files later does not erase already recorded blobs.
- Command output is inherited, not logged. Wrapped command argument redaction is best effort only: do not pass credentials on the command line.
- Native filesystem permissions vary between Unix-like systems and Windows ACLs.

## Not covered

Ransomware running with your permissions, malicious administrators, full disk loss, secret files already recorded, simultaneous uncoordinated restore processes, remote cloud state, package registry changes and database side effects.

Deleting the .timewarp directory removes TimeWarp records, but SSD and filesystem deletion does not guarantee secure physical erasure.
