# ApiDock

Self-hosted, Apidog-style API devtools for Node.js — **code-first OpenAPI 3.1 contracts, interactive docs, a try-it-out client, a spec-driven mock server, contract tests and multi-step scenarios**, all running on your own infrastructure.

Two ways to run it:

- **Embedded** — install into your Express app, get a devtools UI at `/apidock` and `defineApi` contracts that generate the spec, validate requests/responses and report violations.
- **Standalone** — `apidock serve` or the Docker image next to any API that exposes an OpenAPI document (any language). Docs, mock, environments, collections, contract tests and diff — nothing embedded in your backend.

```bash
npm install apidock zod express
```

## Embedded mode (Express)

```ts
import express from 'express';
import { z } from 'zod';
import { defineApi } from 'apidock';
import { apidock } from 'apidock/express';

const api = defineApi({
  info: { title: 'My API', version: '1.0.0' },
  routes: {
    getUser: {
      method: 'GET',
      path: '/users/:id',
      params: z.object({ id: z.string() }),
      responses: { 200: UserSchema, 404: ErrorSchema },
    },
    createUser: {
      method: 'POST',
      path: '/users',
      body: z.object({ name: z.string(), email: z.email() }),
      responses: { 201: UserSchema },
    },
  },
});

const app = express();
app.use('/api', api.router(handlers)); // handlers are fully typed from the contract
app.use('/apidock', apidock({ api })); // devtools UI — auto-disabled when NODE_ENV=production
app.listen(3000);
```

Open `http://localhost:3000/apidock/` — every route in the contract becomes a documented, callable, mockable operation.

Already have routes (or a NestJS/FastAPI app that already emits OpenAPI)? Skip `defineApi` and point ApiDock at an existing document:

```ts
app.use('/apidock', apidock({ spec: () => buildMyOpenApi() })); // function — re-read on every load
app.use('/apidock', apidock({ spec: './openapi.yaml' }));       // file
app.use('/apidock', apidock({ spec: 'https://api.internal/openapi.json' })); // URL, auto-refreshed
```

## What's inside

| Area | Details |
|---|---|
| Docs | RFC-style reference grouped by tag + a lazy-loaded Scalar view |
| Try it out | Request builder → safe server-side proxy (SSRF-guarded: DNS resolves before connecting, private/link-local/metadata IPs blocked, allowlist, timeouts, size limits) |
| Mock | `GET /apidock/mock/<spec-path>` — data generated from JSON Schema (examples → `format` → field-name heuristics → faker). `Prefer: code=404`, `Prefer: example=name`, `?__delay=ms` |
| Environments | Named base URLs + `{{variables}}`, secret masking, secrets scrubbed from stored history |
| Collections | Save/replay request drafts |
| Contract tests | `POST /api/contract-run` exercises every operation with generated input and validates status + body against the spec |
| Scenarios | Multi-step flows with `{{vars}}`, JSONPath extraction, assertions (status / body / latency / spec match) |
| Violations | `StorageReporter` (embedded) and `HttpReporter` (standalone; batched, sampled, non-blocking) |
| Diff | `POST /api/diff`, `/api/snapshots`, and `apidock diff old.yaml new.json` — breaking-change detection for CI |
| Design | Draft endpoints designed in the UI are mockable immediately and can be emitted as `defineApi` TypeScript |

## Standalone mode

```bash
npx apidock serve --spec https://localhost:3000/openapi.json \
  --port 4000 --data /data --auth admin:s3cret --target http://localhost:3000
```

`serve` requires `--auth user:pass` (or `APIDOCK_AUTH`) — or explicit `--no-auth` for local-only use.

```bash
apidock test --spec http://api/openapi.json --base http://api --reporter junit   # contract tests for CI, exit≠0 on failure
apidock diff old.yaml new.yaml                                                  # breaking-change check, exit≠0 on breaking
```

Environment equivalents: `APIDOCK_AUTH`, `APIDOCK_DATA_DIR`, `APIDOCK_ALLOW_HOSTS`, `APIDOCK_REFRESH`, `PORT`.

### Docker

```bash
docker run -p 4000:4000 -v apidock-data:/data \
  ghcr.io/<org>/apidock serve --spec http://api:3000/openapi.json --auth admin:s3cret
```

See `docker/compose.example.yml` for a sidecar-style deployment next to your API.

## Reporting contract violations from production traffic

```ts
import { HttpReporter } from 'apidock';
import { createRouter } from 'apidock/express';

const report = new HttpReporter({ baseUrl: 'http://apidock:4000', headers: { authorization: 'Basic …' }, sampleRate: 0.1 });
app.use('/api', createRouter(api, handlers, { report, validateResponses: 'warn' }));
```

Request and response violations are buffered and posted to the devtools server — they appear under **Tests → Violations**. Reporting never throws and never delays a request.

## Security defaults

- `apidock()` mounts nothing when `NODE_ENV=production` unless `enabled: true`
- Optional `auth` (basic auth or any Express middleware) on the devtools mount
- Proxy only calls the configured target, declared environment base URLs or `--allow-host` entries; everything else — including RFC1918, loopback, link-local and `169.254.169.254` — is refused
- `authorization`, `cookie`, `x-api-key`… are stored as `[redacted]`; environment secrets are scrubbed from URLs, headers and bodies in history

## Requirements

Node ≥ 20.19, ESM. `express@^5` (embedded adapter) and `zod@^4` (contract DSL) are peer dependencies — the standalone server works without either.
