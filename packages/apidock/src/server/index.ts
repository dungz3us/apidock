import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { MemoryStorage, newId, type Storage } from '../storage/index.js';
import type { Violation } from '../sdk/report.js';
import { runContractTest, type ContractRunReport } from './contract-run.js';
import { diffSpecs } from './diff.js';
import { generateContract } from './codegen.js';
import { draftsToDoc, mergeDrafts, validateDrafts, type DesignDraft } from './drafts.js';
import { buildMockResponse, mockHandler, type OpenAPIDoc } from './mock.js';
import { ProxyError, sendProxied, type ProxyOptions, type ProxyRequest, type ProxyResponse } from './proxy.js';
import { runScenario, type Scenario, type ScenarioReport } from './scenario.js';
import { createSpecSource, isSpecSource, type SpecInput, type SpecSource } from './spec-source.js';
import { FALLBACK_HTML, findUiDir } from './ui.js';

export { createSpecSource, type SpecInput, type SpecSource } from './spec-source.js';
export { buildMockResponse, matchOperation, mockFromSchema, mockHandler, pickResponse } from './mock.js';
export type { MockRequest, MockResult } from './mock.js';
export { runContractTest } from './contract-run.js';
export type { ContractCaseResult, ContractRunReport } from './contract-run.js';
export { runScenario } from './scenario.js';
export type { Scenario, ScenarioReport, ScenarioStep, StepResult } from './scenario.js';
export { diffSpecs } from './diff.js';
export type { Change, ChangeLevel, DiffReport } from './diff.js';
export { generateContract, schemaToZod } from './codegen.js';
export { draftsToDoc, draftToPathItem, mergeDrafts, validateDrafts } from './drafts.js';
export type { DesignDraft, DraftParam } from './drafts.js';
export { validateResponseBody } from './jsschema.js';
export { HttpReporter, StorageReporter } from '../sdk/report.js';
export type { Reporter, Violation, ViolationKind, ViolationInput } from '../sdk/report.js';
export { hostKeys, isPrivateAddress, ProxyError, resolveProxyUrl, sendProxied } from './proxy.js';
export type { ProxyContext, ProxyOptions, ProxyRequest, ProxyResponse } from './proxy.js';
export { FileStorage, MemoryStorage, newId, type Entity, type Storage } from '../storage/index.js';

export interface ServerOptions {
  spec: SpecInput | SpecSource;
  storage?: Storage;
  /** Base URL for relative requests sent from the client (e.g. the API being documented). */
  target?: string | ((req: Request) => string | undefined);
  proxy?: ProxyOptions;
  /** Auto refresh interval for URL/file specs (ms). */
  refreshMs?: number;
  title?: string;
  /** Max stored history entries. Default 200. */
  historyLimit?: number;
  /** `embedded` when mounted inside the documented app, `standalone` for `apidock serve`. */
  mode?: 'embedded' | 'standalone';
  uiDir?: string;
}

export interface HistoryEntry {
  id: string;
  at: string;
  operationId?: string;
  request: ProxyRequest;
  response?: Omit<ProxyResponse, 'body'> & { body: string };
  error?: string;
}

export interface Environment {
  id: string;
  name: string;
  baseUrl: string;
  variables?: { key: string; value: string; secret?: boolean }[];
}

export interface SavedRequest {
  id: string;
  name: string;
  method: string;
  /** Path or URL as drafted (may contain `{{variables}}`). */
  url: string;
  headers?: Record<string, string>;
  body?: string;
  createdAt: string;
}

export interface Collection {
  id: string;
  name: string;
  requests: SavedRequest[];
}

export interface SpecSnapshot {
  id: string;
  name: string;
  at: string;
  spec: OpenAPIDoc;
}

export { interpolate } from './vars.js';

export const envVars = (env: Environment | undefined): Record<string, string> =>
  Object.fromEntries((env?.variables ?? []).map((v) => [v.key, v.value]));

const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token']);
const STORED_BODY_LIMIT = 64 * 1024;

const redact = (headers: Record<string, string> = {}): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, SENSITIVE_HEADERS.has(k.toLowerCase()) ? '[redacted]' : v]));

const clip = (s: string | undefined): string | undefined =>
  s !== undefined && s.length > STORED_BODY_LIMIT ? `${s.slice(0, STORED_BODY_LIMIT)}\n…[truncated]` : s;

/** Replace secret environment values anywhere they appear, so tokens never reach history/disk. */
const scrubSecrets = (value: string | undefined, secrets: string[]): string | undefined => {
  if (!value) return value;
  for (const s of secrets) if (s.length >= 4) value = value.split(s).join('[redacted]');
  return value;
};

function validateEnvironments(body: unknown): Environment[] {
  if (!Array.isArray(body)) throw new ProxyError('Body must be an array of environments', 400);
  return body.map((e, i) => {
    const env = e as Environment;
    if (!env || typeof env.id !== 'string' || typeof env.name !== 'string' || typeof env.baseUrl !== 'string')
      throw new ProxyError(`Environment ${i}: "id", "name" and "baseUrl" are required strings`, 400);
    if (env.variables !== undefined && !Array.isArray(env.variables)) throw new ProxyError(`Environment ${i}: "variables" must be an array`, 400);
    return {
      id: env.id,
      name: env.name,
      baseUrl: env.baseUrl,
      variables: (env.variables ?? []).map((v) => {
        if (!v || typeof v.key !== 'string' || typeof v.value !== 'string') throw new ProxyError(`Environment ${i}: every variable needs "key" and "value"`, 400);
        return { key: v.key, value: v.value, ...(v.secret ? { secret: true } : {}) };
      }),
    };
  });
}

function validateCollections(body: unknown): Collection[] {
  if (!Array.isArray(body)) throw new ProxyError('Body must be an array of collections', 400);
  return body.map((c, i) => {
    const col = c as Collection;
    if (!col || typeof col.id !== 'string' || typeof col.name !== 'string' || !Array.isArray(col.requests))
      throw new ProxyError(`Collection ${i}: "id", "name" and "requests" are required`, 400);
    for (const r of col.requests) {
      if (!r || typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.method !== 'string' || typeof r.url !== 'string')
        throw new ProxyError(`Collection ${col.name}: every request needs "id", "name", "method" and "url"`, 400);
    }
    return { id: col.id, name: col.name, requests: col.requests };
  });
}

const replaceCollection = (storage: Storage) => async (name: string, items: { id: string }[]) => {
  await storage.replaceAll(name, items);
};

function parseProxyRequest(body: unknown): ProxyRequest & { operationId?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.method !== 'string' || typeof b.url !== 'string') throw new ProxyError('"method" and "url" are required strings', 400);
  if (b.headers !== undefined && (typeof b.headers !== 'object' || b.headers === null)) throw new ProxyError('"headers" must be an object', 400);
  if (b.body !== undefined && typeof b.body !== 'string') throw new ProxyError('"body" must be a string', 400);
  return {
    method: b.method,
    url: b.url,
    headers: b.headers as Record<string, string> | undefined,
    body: b.body as string | undefined,
    operationId: typeof b.operationId === 'string' ? b.operationId : undefined,
  };
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const route = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res, next).catch(next);
};

export const API_VERSION = '0.1.0';

export function createServer(options: ServerOptions): Router {
  const spec = isSpecSource(options.spec) ? options.spec : createSpecSource(options.spec, { refreshMs: options.refreshMs });
  const storage = options.storage ?? new MemoryStorage();
  const historyLimit = options.historyLimit ?? 200;
  const uiDir = options.uiDir ?? findUiDir();
  const resolveTarget = (req: Request) => (typeof options.target === 'function' ? options.target(req) : options.target);

  const router = express.Router();
  const api = express.Router();
  api.use(express.json({ limit: '2mb' }));
  api.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    next();
  });

  api.get(
    '/config',
    route(async (req, res) => {
      const doc = await spec.get().catch(() => undefined);
      res.json({
        version: API_VERSION,
        mode: options.mode ?? 'embedded',
        title: options.title ?? doc?.info.title ?? 'ApiDock',
        target: resolveTarget(req) ?? null,
        mock: '../mock',
        specError: spec.lastError ?? null,
        specLoadedAt: spec.loadedAt ?? null,
      });
    }),
  );

  api.get(
    '/spec',
    route(async (req, res) => {
      const doc = await spec.get();
      if (req.query.format === 'yaml') res.type('application/yaml').send(toYaml(doc));
      else res.json(doc);
    }),
  );

  api.post(
    '/spec/reload',
    route(async (_req, res) => {
      const doc = await spec.reload();
      res.json({ ok: !spec.lastError, error: spec.lastError ?? null, title: doc.info.title });
    }),
  );

  api.get(
    '/history',
    route(async (_req, res) => {
      res.json((await storage.list<HistoryEntry>('history')).reverse());
    }),
  );
  api.delete(
    '/history',
    route(async (_req, res) => {
      for (const e of await storage.list('history')) await storage.delete('history', e.id);
      res.status(204).end();
    }),
  );
  api.delete(
    '/history/:id',
    route(async (req, res) => {
      res.status((await storage.delete('history', String(req.params.id))) ? 204 : 404).end();
    }),
  );

  api.post(
    '/proxy',
    route(async (req, res) => {
      const { operationId, ...proxyReq } = parseProxyRequest(req.body);
      const envs = await storage.list<Environment>('environments');
      const secrets = envs.flatMap((e) => (e.variables ?? []).filter((v) => v.secret).map((v) => v.value));
      const entry: HistoryEntry = {
        id: newId(),
        at: new Date().toISOString(),
        ...(operationId ? { operationId } : {}),
        request: {
          method: proxyReq.method,
          url: scrubSecrets(proxyReq.url, secrets)!,
          headers: Object.fromEntries(Object.entries(redact(proxyReq.headers)).map(([k, v]) => [k, scrubSecrets(v, secrets)!])),
          body: scrubSecrets(clip(proxyReq.body), secrets),
        },
      };
      try {
        const result = await sendProxied(proxyReq, {
          target: resolveTarget(req),
          allowed: envs.map((e) => e.baseUrl),
          options: options.proxy,
        });
        entry.response = { ...result, headers: redact(result.headers), body: clip(result.body)! };
        res.json(result);
      } catch (err) {
        entry.error = (err as Error).message;
        throw err;
      } finally {
        await storage.put('history', entry);
        await storage.trim('history', historyLimit);
      }
    }),
  );

  /** Live spec with design drafts merged in — used by mock endpoints so drafts can be tried early. */
  const specWithDrafts = async () => mergeDrafts((await spec.get()) as OpenAPIDoc, await storage.list<DesignDraft>('drafts'));

  // Runs the mock engine through the same pipeline as the proxy (same response shape + history),
  // so the client can switch "Mock / Env" without a second code path.
  api.post(
    '/mock',
    route(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const method = typeof body.method === 'string' ? body.method : 'GET';
      const url = typeof body.url === 'string' ? body.url : undefined;
      if (!url) throw new ProxyError('"url" (path like /users/1) is required', 400);
      const operationId = typeof body.operationId === 'string' ? body.operationId : undefined;
      const delay = typeof body.delay === 'number' ? body.delay : undefined;
      const preferCode = typeof body.code === 'number' ? body.code : undefined;
      const preferExample = typeof body.example === 'string' ? body.example : undefined;

      const started = performance.now();
      const doc = await specWithDrafts();
      const result = buildMockResponse(doc, { method, path: url.split('?')[0]!, preferCode, preferExample, delayMs: delay });
      if (delay) await new Promise((r) => setTimeout(r, delay));

      const response: ProxyResponse = {
        url: `mock:${result.matched ? `${method.toUpperCase()} ${result.matched.path}` : url}`,
        status: result.status,
        statusText: result.status === 404 && result.error === 'no-match' ? 'No matching operation' : 'Mocked',
        headers: { 'content-type': result.mediaType, 'x-apidock-mock': result.matched?.path ?? 'no-match', ...result.headers },
        body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2),
        encoding: 'utf8',
        size: JSON.stringify(result.body ?? null).length,
        durationMs: Math.round((performance.now() - started) * 10) / 10,
        truncated: false,
      };
      await storage.put('history', {
        id: newId(),
        at: new Date().toISOString(),
        ...(operationId ? { operationId } : {}),
        request: { method, url, headers: {}, body: typeof body.body === 'string' ? clip(body.body) : undefined },
        response: { ...response, headers: redact(response.headers), body: clip(response.body)! },
      } satisfies HistoryEntry);
      await storage.trim('history', historyLimit);
      res.json(response);
    }),
  );

  api.get(
    '/environments',
    route(async (_req, res) => res.json(await storage.list<Environment>('environments'))),
  );
  api.put(
    '/environments',
    route(async (req, res) => {
      const envs = validateEnvironments(req.body);
      await replaceCollection(storage)('environments', envs);
      res.json(envs);
    }),
  );

  api.get(
    '/collections',
    route(async (_req, res) => res.json(await storage.list<Collection>('collections'))),
  );
  api.put(
    '/collections',
    route(async (req, res) => {
      const cols = validateCollections(req.body);
      await replaceCollection(storage)('collections', cols);
      res.json(cols);
    }),
  );

  api.get(
    '/violations',
    route(async (_req, res) => res.json((await storage.list<Violation>('violations')).reverse())),
  );
  api.delete(
    '/violations',
    route(async (_req, res) => {
      for (const v of await storage.list('violations')) await storage.delete('violations', v.id);
      res.status(204).end();
    }),
  );
  // Ingest endpoint for HttpReporter (standalone/remote SDKs).
  api.post(
    '/violations/batch',
    route(async (req, res) => {
      const items = Array.isArray(req.body) ? (req.body as Violation[]) : [];
      for (const v of items.slice(0, 500)) {
        if (!v.id || !v.at || typeof v.method !== 'string' || !Array.isArray(v.issues)) continue;
        await storage.put('violations', v);
      }
      await storage.trim('violations', 1000);
      res.status(202).json({ accepted: items.length });
    }),
  );

  const targetOrSelf = async (req: Request, explicit?: string): Promise<string> => {
    const target = explicit ?? resolveTarget(req);
    if (!target) throw new ProxyError('No base URL. Pass "baseUrl", configure --target, or run embedded.', 400);
    return target;
  };

  api.post(
    '/contract-run',
    route(async (req, res) => {
      const body = (req.body ?? {}) as { baseUrl?: string; operationId?: string; headers?: Record<string, string> };
      const baseUrl = await targetOrSelf(req, body.baseUrl);
      const report = await runContractTest((await spec.get()) as OpenAPIDoc, {
        baseUrl,
        operationId: body.operationId,
        headers: body.headers,
      });
      for (const r of report.results.filter((r) => !r.ok)) {
        await storage.put('violations', {
          id: newId(),
          at: report.at,
          kind: 'contract-run',
          operationId: r.operationId,
          method: r.method,
          path: r.path,
          status: r.status,
          issues: r.issues.map((i) => ({ location: 'response' as const, path: i.path, message: i.message })),
        } satisfies Violation);
      }
      await storage.trim('violations', 1000);
      res.json(report);
    }),
  );

  api.get(
    '/scenarios',
    route(async (_req, res) => res.json(await storage.list<Scenario & { id: string }>('scenarios'))),
  );
  api.put(
    '/scenarios',
    route(async (req, res) => {
      if (!Array.isArray(req.body)) throw new ProxyError('Body must be an array of scenarios', 400);
      const items = req.body as (Scenario & { id: string })[];
      for (const s of items) {
        if (!s.id || !s.name || !Array.isArray(s.steps)) throw new ProxyError('Every scenario needs "id", "name" and "steps"', 400);
      }
      await replaceCollection(storage)('scenarios', items);
      res.json(items);
    }),
  );
  api.post(
    '/scenario-run',
    route(async (req, res) => {
      const body = (req.body ?? {}) as { scenario?: Scenario; baseUrl?: string };
      if (!body.scenario || !Array.isArray(body.scenario.steps)) throw new ProxyError('"scenario" with "steps" is required', 400);
      const baseUrl = await targetOrSelf(req, body.baseUrl ?? body.scenario.baseUrl);
      const report: ScenarioReport = await runScenario(body.scenario, baseUrl, (await spec.get()) as OpenAPIDoc);
      res.json(report);
    }),
  );

  api.get(
    '/drafts',
    route(async (_req, res) => res.json(await storage.list<DesignDraft>('drafts'))),
  );
  api.put(
    '/drafts',
    route(async (req, res) => {
      const drafts = validateDrafts(req.body);
      await storage.replaceAll('drafts', drafts);
      res.json(drafts);
    }),
  );
  api.post(
    '/design/codegen',
    route(async (req, res) => {
      const drafts = req.body && Array.isArray(req.body.drafts) ? validateDrafts(req.body.drafts) : await storage.list<DesignDraft>('drafts');
      res.json({ code: generateContract(draftsToDoc(drafts)) });
    }),
  );

  api.get(
    '/snapshots',
    route(async (_req, res) =>
      res.json((await storage.list<SpecSnapshot>('snapshots')).map(({ id, name, at }) => ({ id, name, at }))),
    ),
  );
  api.post(
    '/snapshots',
    route(async (req, res) => {
      const name = typeof (req.body as { name?: unknown })?.name === 'string' ? (req.body as { name: string }).name : 'snapshot';
      const snap: SpecSnapshot = { id: newId(), name, at: new Date().toISOString(), spec: (await spec.get()) as OpenAPIDoc };
      await storage.put('snapshots', snap);
      res.status(201).json({ id: snap.id, name: snap.name, at: snap.at });
    }),
  );
  api.delete(
    '/snapshots/:id',
    route(async (req, res) => {
      res.status((await storage.delete('snapshots', String(req.params.id))) ? 204 : 404).end();
    }),
  );

  // POST {snapshot?: id, spec?: doc, specText?: yaml|json, head?: doc} → diff base vs head (head defaults to the live spec).
  api.post(
    '/diff',
    route(async (req, res) => {
      const body = (req.body ?? {}) as { snapshot?: string; spec?: OpenAPIDoc; specText?: string; head?: OpenAPIDoc };
      let baseDoc: OpenAPIDoc | undefined = body.spec;
      if (body.specText) baseDoc = parseYaml(body.specText) as OpenAPIDoc;
      if (body.snapshot) {
        const snap = await storage.get<SpecSnapshot>('snapshots', body.snapshot);
        if (!snap) throw new ProxyError(`Snapshot "${body.snapshot}" not found`, 404);
        baseDoc = snap.spec;
      }
      if (!baseDoc?.openapi) throw new ProxyError('Provide a valid OpenAPI 3.x document via "spec", "specText" or "snapshot"', 400);
      const headDoc = body.head ?? ((await spec.get()) as OpenAPIDoc);
      res.json(diffSpecs(baseDoc, headDoc));
    }),
  );

  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof ProxyError ? err.status : ((err as { status?: number }).status ?? 500);
    res.status(status).json({ error: (err as Error).message ?? 'Internal error' });
  });

  router.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });
  // Public mock endpoints — the spec's paths under the mount (e.g. /apidock/mock/users/u_1).
  router.all('/mock/*splat', (req, res, next) => {
    void mockHandler(specWithDrafts)(req, res).catch(next);
  });
  router.use('/api', api);

  // UI assets use relative URLs, so the mount point must end with "/".
  router.get('/', (req, res, next) => {
    const [path, query = ''] = req.originalUrl.split('?');
    if (!path!.endsWith('/')) return res.redirect(301, `${path}/${query ? `?${query}` : ''}`);
    if (!uiDir) return res.type('html').send(FALLBACK_HTML);
    next();
  });
  if (uiDir) router.use(express.static(uiDir, { index: 'index.html', maxAge: '1h', setHeaders: noCacheHtml }));

  return router;
}

function noCacheHtml(res: Response, path: string): void {
  if (path.endsWith('.html')) res.setHeader('cache-control', 'no-cache');
}
