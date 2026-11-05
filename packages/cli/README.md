# timewarp-dev

Local-first history and safe restores for AI-assisted development.

The npm package has **not** been published yet. Build a standalone tarball locally:

`pnpm install && pnpm build && npm pack ./packages/cli/release`

After publishing under a verified package name:

`npx timewarp-dev init && npx timewarp-dev watch .`

No cloud account, database server or AI API key required. Requires Node.js 22.13+ (Node 24 recommended). See the repository README for safety limitations.
