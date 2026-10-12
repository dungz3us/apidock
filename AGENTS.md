# ApiDock workspace

pnpm monorepo. `apidock` = installable package (SDK + devtools server + Express adapter + prebuilt UI), `ui` = Vite/React source of the devtools SPA, `demo` = example Express app.

## Commands

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"  # node/pnpm not on default PATH

pnpm -r build          # tsdown → dist (apidock) + vite → packages/apidock/ui-dist (ui)
pnpm test              # vitest in packages/apidock (64 tests)
pnpm -r typecheck      # tsc --noEmit everywhere
pnpm -C packages/demo dev    # demo API on :3000 → http://localhost:3000/apidock/
```

## Layout

- `packages/apidock/src/cli.ts` — `apidock serve` standalone mode (needs `--auth` or `--no-auth`; `--target` defaults to the spec URL's origin), `apidock test`, `apidock diff <old> <new>`
- `docker/` — `Dockerfile` (apidock service), `Dockerfile.demo`, `compose.example.yml`

- `packages/apidock/src/sdk/` — `defineApi` contract DSL, `toOpenAPI`, request/response validation, `report.ts` (`Reporter`, `StorageReporter`, `HttpReporter`)
- `packages/apidock/src/express/` — `createRouter` (`report` option for violations), `serveSpec`, `apidock()` mount
- `packages/apidock/src/server/` — `createServer` (UI, spec, history, SSRF-guarded proxy, violations/contract-run/scenario/drafts/snapshots/diff/codegen endpoints), `spec-source`, `mock`, `jsschema` (ajv 2020-12), `contract-run`, `scenario`, `diff`, `codegen`, `drafts`
- `packages/apidock/src/storage/` — `MemoryStorage` / `FileStorage`
- `packages/ui/src/` — devtools SPA; `pnpm -C packages/ui build` emits into `packages/apidock/ui-dist`
- `packages/demo/src/` — contract + server; imports resolve to `src` via export condition `apidock-source` (tsx + `customConditions`)

## Conventions

- Package `apidock` is ESM-only (`"type": "module"`, `.js` outputs). Exports: `apidock`, `apidock/express`, `apidock/server`.
- UI uses relative `base` — it must work under any mount path (`/apidock/`).
- Design direction: RFC-style (see `packages/ui/.impeccable/surfaces/packages-ui.md`, `PRODUCT.md`); run `~/.agents/skills/impeccable/scripts/impeccable detect --json <files>` after UI changes.
- Dependencies pinned exactly (`-E`), only versions published ≥7 days.
- Demo history is in-memory; `FileStorage` writes to `APIDOCK_DATA_DIR` or `.apidock/`.
