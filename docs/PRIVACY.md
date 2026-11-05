# Privacy questions

**Does TimeWarp upload source?** No. The current recorder, CLI and dashboard operate locally without telemetry.

**Does it know which AI agent wrote a file?** No. Raw file changes are intentionally unattributed.

**Can it store secrets?** Yes, if the user includes them in recorded paths. Configure .timewarpignore before recording. Previously stored objects are not erased by later exclusions.

**Is it encrypted?** No, use OS-level disk encryption.

**Does it log process output?** The explicit run wrapper inherits output and does not persist stdout or stderr. Avoid passing secrets as command arguments.

**Will it undo databases or deployments?** No. Restoration only modifies local project files.
