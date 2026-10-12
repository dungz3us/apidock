# ApiDock

Self-hosted, Apidog-style API devtools for Node.js — code-first OpenAPI 3.1 contracts, interactive docs, try-it-out client, spec-driven mock server, contract tests, scenarios and breaking-change diff. Runs embedded in your Express app or standalone via CLI/Docker.

```
packages/
  apidock/   the published package — SDK + devtools server + Express adapter + CLI + bundled UI
  ui/        Vite + React source of the devtools UI (builds into apidock/ui-dist)
  demo/      example Express app (users/posts) with ApiDock mounted at /apidock
docker/      Dockerfile + compose example for standalone deployment
```

## Quick start

```bash
pnpm install
pnpm -C packages/demo dev      # demo API on :3000 → http://localhost:3000/apidock/
```

## Commands

```bash
pnpm -r build        # build UI then package
pnpm test            # vitest suite
pnpm -r typecheck    # tsc --noEmit
```

See [packages/apidock/README.md](packages/apidock/README.md) for usage docs (embedded & standalone modes, CLI, reporters, security defaults) and [PRODUCT.md](PRODUCT.md) for the product direction.
