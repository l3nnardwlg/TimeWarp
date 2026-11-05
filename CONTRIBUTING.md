# Contributing to TimeWarp

Thank you for building a trustworthy developer recovery tool.

1. Open an issue before significant behavioral or security-sensitive changes.
2. Fork, branch, and run: **corepack enable && pnpm install && pnpm build && pnpm test && pnpm check**.
3. Add tests for real files and real temporary directories. Do not rely solely on mocked filesystem tests.
4. Never guess an agent's identity from un-attributed filesystem observations.
5. Never upload recorded source, credentials or command output without explicit informed consent.
6. Include a PR description, user-facing limitations and the exact tests actually executed.

CI targets Node 22/24 on Windows, Linux and macOS. Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
