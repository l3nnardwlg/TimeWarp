# Real demo script

1. Create a disposable local project with one working source file.
2. Run **timewarp init .** and then **timewarp watch .**.
3. In another terminal deliberately break the source file and create an unwanted file (or let an AI agent do it).
4. Open **timewarp ui** to inspect actual timeline events and hash-backed diffs.
5. Select the initial baseline checkpoint and preview the exact planned modifications and deletions.
6. Explicitly confirm the restore, or use **timewarp restore ID --yes**.
7. Verify the working source is restored and the unwanted file is gone.
8. Run **timewarp undo --yes**, and confirm the broken version has returned.

Record a real session before publishing a demo. Do not substitute screenshots or fabricated events.
