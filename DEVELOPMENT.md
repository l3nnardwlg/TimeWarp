# Development

## Requirements

- Node.js 22.13+ (24 recommended)
- corepack and pnpm 10
- Git
- Rust stable and platform-specific Tauri 2 dependencies for the native desktop

~~~bash
corepack enable
pnpm install
pnpm build
pnpm check
pnpm test
~~~

Run the CLI directly:

~~~bash
mkdir -p /tmp/timewarp-demo
node packages/cli/dist/cli.js init /tmp/timewarp-demo
node packages/cli/dist/cli.js watch /tmp/timewarp-demo
node packages/cli/dist/cli.js ui --project /tmp/timewarp-demo
~~~

The CLI build also creates **packages/cli/release/** with a standalone dependency-free bundle. Test the packaged executable and build an npm tarball:

~~~bash
node packages/cli/release/cli.js --help
npm pack ./packages/cli/release
~~~

To develop the native React/Tauri client:

~~~bash
export TIMEWARP_CLI_PATH="$(pwd)/packages/cli/release/cli.js"
pnpm --filter @timewarp/desktop tauri dev
~~~

Windows uses an equivalent environment variable. The native app asks for the full path of a project previously initialized by TimeWarp. For Linux Tauri builds, install documented WebKitGTK, appindicator and compilation dependencies.

## Validation

The CI matrix runs type checking, tests, builds and a CLI smoke test on Windows, macOS and Linux under Node 22/24. Native packaging and platform signing require separate verification.

Use real temporary directories in recorder and restore integration tests. Do not mark a feature production-ready solely from type checking.
