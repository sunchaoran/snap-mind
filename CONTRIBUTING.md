# Contributing to SnapMind

Thanks for taking a look. SnapMind is an early-stage personal project that's now open source — contributions are welcome but the bar for "what fits" is opinionated. Read this before sending a PR.

## What this project is (and isn't)

**Is**: a personal screenshot-to-knowledge-base pipeline. Backend reads/writes an Obsidian-style markdown vault. Closed-source mobile/desktop apps connect to it for ingestion and browsing.

**Isn't**:
- A note-taking app (Obsidian is the editor)
- A multi-tenant SaaS (that's the future Cloud variant — separate repo)
- A general AI screenshot tool — the design is opinionated around the vault as data

If your idea diverges from this, file an issue first to discuss before implementing.

## Scope guidelines

PRs likely to land:

- Bug fixes in the pipeline (fetcher fallback paths, VLM merger, parser edge cases)
- New platform-specific extraction prompts (`src/prompts/platforms/`)
- Cross-platform packaging improvements (Docker, install scripts)
- Documentation improvements
- Test coverage

PRs likely to bounce without prior discussion:

- New endpoints or wire-format changes (these are public contract — see [API design](./docs/architecture/api-design.md))
- New storage backends (the design discusses why this isn't a priority)
- New auth schemes (V1 is API-key-only by intent; JWT is for Cloud)
- Major architectural changes
- Adding heavy dependencies (Redis, full-text search engines, etc.)

## Development setup

Prerequisites:
- Node.js 24+
- pnpm 10+
- A working OpenRouter API key (for VLM)
- A vault directory (Obsidian vault on iCloud Drive recommended for personal use)

```bash
git clone https://github.com/<your-fork>/snap-mind
cd snap-mind
pnpm install
cp .env.example .env  # fill in API_KEY, OPENROUTER_API_KEY, OBSIDIAN_VAULT_PATH
pnpm dev              # tsx watch on src/index.ts
```

For tests:
```bash
pnpm test:run         # all vitest specs
pnpm typecheck        # tsc --noEmit
pnpm lint             # biome check
pnpm lint:fix         # biome check --fix
```

## Branch / commit conventions

We use **gitflow**:

- `main` — release tags only
- `develop` — integration branch, default branch for PRs
- `feature/<short-name>` — new functionality
- `chore/<short-name>` — refactor / non-feature work
- `docs/<short-name>` — docs-only changes

Merge via `--no-ff` so the merge commit captures the unit of work.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(api): add GET /clip/:id detail endpoint
fix(fetcher): handle 403 from L2 web fetch
docs: clarify deployment guide for Linux
chore(deps): bump fastify to 5.9.0
```

## Code style

- **Biome** for lint + format. CI runs `pnpm lint` strict.
- **TypeScript strict mode**. No `any` without comment justifying it.
- **Tests** for new behavior. Vitest, in-process Fastify (`app.inject()`).
- **Comments** for the *why*, not the *what*. Surface tradeoffs.

## Wire format & API stability

The HTTP API under `/api/v1/` is a **public contract** — closed-source apps depend on it. Treat it as such:

- Adding new endpoints: OK
- Adding optional fields to responses: OK
- Removing endpoints / fields / changing field types: requires a `/api/v2/` and a deprecation plan
- Error codes (the `error.code` field) are stable; messages are not

### API documentation is auto-generated

The HTTP API doc at [`docs/api/reference.md`](./docs/api/reference.md) is **generated** from the OpenAPI spec emitted by Fastify (`src/server/plugins/swagger.ts` + per-route `schema` annotations). Don't edit `reference.md` by hand — it'll be overwritten.

When changing routes or wire types, regenerate:

```bash
pnpm gen:api-doc
```

The pre-commit hook runs `pnpm gen:api-doc --check` whenever you touch `src/server/plugins/swagger.ts`, `src/server/routes/*`, or `src/types/wire.ts`, and rejects the commit on drift. Update `docs/architecture/data-model.md` by hand if the underlying domain shape changes.

## License

By contributing, you agree your contribution is licensed under the project's [AGPL-3.0](./LICENSE). If your employer has any claim on your work, get sign-off before contributing.

## Reporting issues

Include:
- Backend version (commit hash or release tag)
- Node version, OS
- A minimal repro
- For pipeline bugs: the `clipId` if available, and a redacted log excerpt (server logs include `X-Request-Id`)

For security issues that shouldn't be public, see [SECURITY.md](./SECURITY.md) (TBD).
