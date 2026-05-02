# `scripts/`

Two file extensions live here on purpose:

- **`.mjs` — system glue.** Runs against macOS / launchctl / curl / the
  filesystem. Only imports from `node:*`, never from the project graph.
  Must be runnable before `pnpm install` (e.g. on a fresh deploy box).
- **`.ts` — project glue.** Imports the project source via the `@/...`
  alias to read config or instantiate the Fastify app. Run via
  `node --import tsx ...` (already wired up in `package.json` scripts).

The split is by **runtime characteristics**, not aesthetic preference. If
a new script needs to read `config.opencli.binaryPath`, write it as
`.ts`. If it just renders a plist and shells out to `launchctl`, write
it as `.mjs` and put any shared helpers in [`lib/launchd.mjs`](./lib/launchd.mjs).

## Inventory

| File | Kind | Purpose |
|---|---|---|
| `install-launchd.mjs` | system | Install snap-mind server LaunchAgent |
| `uninstall-launchd.mjs` | system | Uninstall snap-mind server LaunchAgent |
| `install-chrome-launchd.mjs` | system | Install dedicated Chrome (CDP) LaunchAgent |
| `uninstall-chrome-launchd.mjs` | system | Uninstall the Chrome LaunchAgent |
| `lib/launchd.mjs` | system | Shared helpers — `assertMacOS`, `renderTemplate`, `plutilLint`, `launchctl{Load,Unload}`, `curlProbe`, log formatters |
| `snap-mind.server.plist.template` | system | XML template rendered by `install-launchd.mjs` |
| `snap-mind.chrome.plist.template` | system | XML template rendered by `install-chrome-launchd.mjs` |
| `check-opencli.ts` | project | Compares local opencli vs npm latest vs `MIN_OPENCLI_VERSION`; pre-commit hook gate |
| `gen-api-doc.ts` | project | Boots Fastify, extracts OpenAPI spec, regenerates `docs/api/reference.md`; pre-commit drift gate |

## Conventions

- All `.mjs` scripts have `#!/usr/bin/env node` and the executable bit
  set, but the documented invocation is `node scripts/<name>.mjs` so
  callers don't depend on PATH lookup of `node`.
- All scripts log with a `[script-name]` prefix on stdout/stderr so
  output is grep-able when multiple scripts run in the same session.
- `.mjs` install/uninstall scripts are **idempotent**; safe to re-run.
