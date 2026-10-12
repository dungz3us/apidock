import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createRouter, type Handlers } from '../src/express/index.js';
import { defineApi } from '../src/sdk/contract.js';
import { HttpReporter, StorageReporter, type ViolationInput } from '../src/sdk/report.js';
import { createServer, MemoryStorage, type Violation } from '../src/server/index.js';
import { runContractTest } from '../src/server/contract-run.js';
import { runScenario, type Scenario } from '../src/server/scenario.js';
import { toOpenAPI } from '../src/sdk/openapi.js';
import { testApi } from './fixtures.js';

const doc = testApi.toOpenAPI();

function demoApp(bad?: boolean) {
  const app = express();
  app.use(express.json());
  app.get('/users', (_req, res) => res.json([{ id: 'u_1', name: 'Ada', email: 'ada@x.io' }]));
  app.get('/users/:id', (req, res) =>
    req.params.id === 'missing' ? res.status(404).json({ error: 'nope' }) : res.json({ id: req.params.id, name: 'Ada', email: bad ? 'not-an-email' : 'ada@x.io' }),
  );
  app.post('/users', (req, res) => res.status(201).json({ id: 'u_9', ...req.body }));
  app.delete('/users/:id', (_req, res) => res.status(204).end());
  return app;
}

const listen = (app: express.Express | express.Router) =>
  new Promise<string>((resolve) => {
    const srv = express().use('/api', app).listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(srv.address() as { port: number }).port}`),
    );
  });

describe('contract run', () => {
  it('validates every operation against a live server', async () => {
    const base = await listen(demoApp());
    const report = await runContractTest(doc, { baseUrl: base });
    expect(report.total).toBeGreaterThanOrEqual(4);
    expect(report.failed).toBe(0);
  });

  it('flags schema violations and undeclared statuses', async () => {
    const badDoc = {
      openapi: '3.1.0',
      info: { title: 't', version: '1' },
      servers: [{ url: '/api' }],
      paths: {
        '/users': { get: { operationId: 'list', responses: { 200: { content: { 'application/json': { schema: { type: 'array', items: { type: 'object', required: ['nope'], properties: { nope: { type: 'string' } } } } } } } } } },
      },
    };
    const base = await listen(demoApp());
    const report = await runContractTest(badDoc as never, { baseUrl: base });
    expect(report.failed).toBe(1);
    expect(report.results[0]!.issues[0]!.message).toMatch(/required property.*nope/);
  });
});

describe('scenario runner', () => {
  it('extracts vars across steps and evaluates expectations', async () => {
    const base = await listen(demoApp());
    const scenario: Scenario = {
      name: 'create-then-get',
      vars: { mail: 'bot@x.io' },
      steps: [
        {
          id: 'create',
          request: { method: 'POST', url: '/api/users', headers: { 'content-type': 'application/json' }, body: '{"name":"B","email":"{{mail}}"}' },
          extract: { uid: '$.id' },
          expect: { status: 201, body: { '$.email': '{{mail}}' }, maxMs: 5000 },
        },
        { id: 'read', request: { method: 'GET', url: '/api/users/{{uid}}' }, expect: { status: 200, matchSpec: true } },
      ],
    };
    const report = await runScenario(scenario, base, doc);
    expect(report.ok).toBe(true);
    expect(report.steps[0]!.extracted).toEqual({ uid: 'u_9' });
  });

  it('stops at the first failing step', async () => {
    const base = await listen(demoApp());
    const report = await runScenario(
      { name: 'x', steps: [
        { id: 'one', request: { method: 'GET', url: '/api/users/missing' }, expect: { status: 200 } },
        { id: 'two', request: { method: 'GET', url: '/api/users/1' } },
      ] },
      base,
    );
    expect(report.ok).toBe(false);
    expect(report.steps).toHaveLength(1);
  });
});

describe('reporters', () => {
  it('StorageReporter writes to storage', async () => {
    const storage = new MemoryStorage();
    const rep = new StorageReporter(storage);
    rep.report({ kind: 'response-schema', method: 'GET', path: '/x', status: 200, issues: [{ location: 'response', path: 'a', message: 'bad' }] });
    await vi.waitFor(async () => expect(await storage.list('violations')).toHaveLength(1));
  });

  it('HttpReporter batches to /api/violations/batch', async () => {
    const storage = new MemoryStorage();
    const server = createServer({ spec: doc, storage });
    const base = await new Promise<string>((resolve) => {
      const srv = express().use(server).listen(0, '127.0.0.1', () =>
        resolve(`http://127.0.0.1:${(srv.address() as { port: number }).port}`),
      );
    });
    const rep = new HttpReporter({ baseUrl: base, intervalMs: 10 });
    rep.report({ kind: 'response-schema', method: 'GET', path: '/x', issues: [] });
    rep.report({ kind: 'request-schema', method: 'POST', path: '/y', issues: [] });
    await rep.flush();
    const stored = await storage.list<Violation>('violations');
    expect(stored).toHaveLength(2);
  });
});

describe('express report option', () => {
  const api = defineApi({
    info: { title: 't', version: '1' },
    routes: {
      broken: {
        method: 'GET',
        path: '/broken',
        responses: { 200: z.object({ id: z.string() }) },
      },
      guarded: {
        method: 'GET',
        path: '/guarded',
        query: z.object({ n: z.coerce.number() }),
        responses: { 200: z.object({ ok: z.boolean() }) },
      },
    },
  });

  it('reports response schema + request violations to the reporter', async () => {
    const violations: ViolationInput[] = [];
    const handlers: Handlers<typeof api.routes> = {
      // @ts-expect-error deliberately returns a body that violates the contract
      broken: () => ({ status: 200, body: { wrong: true } }),
      guarded: () => ({ status: 200, body: { ok: true } }),
    };
    const app = express().use(createRouter(api, handlers, { report: { report: (v) => violations.push(v) } }));

    await request(app).get('/broken').expect(200); // mode off: still responds
    await request(app).get('/guarded?n=nope').expect(400);

    expect(violations).toHaveLength(2);
    expect(violations[0]).toMatchObject({ kind: 'response-schema', operationId: 'broken', status: 200 });
    expect(violations[1]).toMatchObject({ kind: 'request-schema', operationId: 'guarded' });
  });

  it('strict mode still wins over reporting', async () => {
    const handlers: Handlers<typeof api.routes> = {
      // @ts-expect-error deliberately returns a body that violates the contract
      broken: () => ({ status: 200, body: {} }),
      guarded: () => ({ status: 200, body: { ok: true } }),
    };
    const app = express().use(createRouter(api, handlers, { validateResponses: 'strict', report: { report: () => undefined } }));
    const res = await request(app).get('/broken').expect(500);
    expect(res.body.error).toBe('ContractViolation');
  });
});
