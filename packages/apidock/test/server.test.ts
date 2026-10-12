import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createServer, createSpecSource, FileStorage, hostKeys, isPrivateAddress, MemoryStorage, resolveProxyUrl } from '../src/server/index.js';
import { testApi } from './fixtures.js';

describe('proxy policy', () => {
  it('detects private and special addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('normalizes host allowlist entries', () => {
    expect([...hostKeys(['api:3000', 'https://staging.example.com', 'example.org'])]).toEqual([
      'api:3000',
      'staging.example.com:443',
      'example.org:80',
      'example.org:443',
    ]);
  });

  it('resolves relative URLs against the target and enforces the allowlist', () => {
    expect(resolveProxyUrl({ method: 'GET', url: '/users' }, { target: 'http://127.0.0.1:3000' })).toEqual({
      url: new URL('http://127.0.0.1:3000/users'),
      checkPrivate: false,
    });
    expect(() => resolveProxyUrl({ method: 'GET', url: 'http://evil.test/' }, { target: 'http://127.0.0.1:3000' })).toThrow(/not allowed/);
    expect(() => resolveProxyUrl({ method: 'GET', url: '/users' }, {})).toThrow(/absolute URL/);
    expect(() => resolveProxyUrl({ method: 'GET', url: 'file:///etc/passwd' }, { options: { allowedHosts: ['*'] } })).toThrow(/protocol/);
    expect(resolveProxyUrl({ method: 'GET', url: 'https://api.example.com/x' }, { options: { allowedHosts: ['*'] } }).checkPrivate).toBe(true);
    expect(resolveProxyUrl({ method: 'GET', url: 'https://staging.example.com/x' }, { allowed: ['https://staging.example.com'] }).checkPrivate).toBe(false);
  });
});

describe('storage', () => {
  it('memory storage supports put/get/delete/trim', async () => {
    const s = new MemoryStorage();
    for (let i = 0; i < 5; i++) await s.put('items', { id: String(i) });
    await s.put('items', { id: '1', v: 'updated' } as { id: string });
    await s.trim('items', 3);
    expect((await s.list('items')).map((i) => i.id)).toEqual(['2', '3', '4']);
    expect(await s.delete('items', '3')).toBe(true);
    expect(await s.get('items', '3')).toBeUndefined();
    await expect(s.list('../etc')).rejects.toThrow(/invalid collection/);
  });

  it('file storage persists, self-gitignores and survives concurrent writes', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'apidock-')), '.apidock');
    const s = new FileStorage(dir);
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.put('history', { id: String(i) })));
    expect(await new FileStorage(dir).list('history')).toHaveLength(20);
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('*\n');
  });
});

describe('spec source', () => {
  it('loads YAML files and keeps serving the last good document on failure', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'apidock-')), 'openapi.yaml');
    await writeFile(file, 'openapi: 3.1.0\ninfo:\n  title: From YAML\n  version: "1"\npaths: {}\n');
    const src = createSpecSource(file, { refreshMs: 0 });
    expect((await src.get()).info.title).toBe('From YAML');

    await writeFile(file, 'swagger: "2.0"\n');
    expect((await src.reload()).info.title).toBe('From YAML');
    expect(src.lastError).toMatch(/Swagger 2.0/);
  });

  it('re-evaluates function sources', async () => {
    const src = createSpecSource(() => testApi.toOpenAPI());
    expect((await src.get()).paths?.['/users']).toBeDefined();
  });

  it('fails clearly for non-OpenAPI input', async () => {
    await expect(createSpecSource({ hello: 'world' } as never).get()).rejects.toThrow(/not an OpenAPI 3.x document/);
  });
});

describe('devtools server (e2e)', () => {
  const app = express().use('/apidock', createServer({ spec: () => testApi.toOpenAPI() }));

  it('serves the OpenAPI document and config', async () => {
    const spec = await request(app).get('/apidock/api/spec').expect(200);
    expect(spec.body.paths['/users/{id}'].get.operationId).toBe('getUser');
    const config = await request(app).get('/apidock/api/config').expect(200);
    expect(config.body.mock).toBe('../mock');
  });

  it('serves mock responses on spec paths and honors Prefer code', async () => {
    const res = await request(app).get('/apidock/mock/users/u_42').expect(200);
    expect(res.headers['x-apidock-mock']).toBe('/users/{id}');
    expect(res.body).toMatchObject({ id: expect.any(String), name: expect.any(String), email: expect.stringContaining('@') });

    const missing = await request(app).get('/apidock/mock/users/u_42').set('prefer', 'code=404').expect(404);
    expect(missing.body).toMatchObject({ error: expect.any(String) });

    await request(app).get('/apidock/mock/definitely/not-here').expect(404).expect((r) => {
      expect(r.headers['x-apidock-mock']).toBe('no-match');
    });
  });

  it('POST /api/mock returns the proxy-shaped response and records history', async () => {
    const res = await request(app).post('/apidock/api/mock').send({ method: 'POST', url: '/users', operationId: 'createUser' }).expect(200);
    expect(res.body.status).toBe(201);
    expect(JSON.parse(res.body.body)).toMatchObject({ name: expect.any(String) });

    const history = await request(app).get('/apidock/api/history').expect(200);
    expect(history.body[0]).toMatchObject({ operationId: 'createUser', request: { method: 'POST', url: '/users' } });
  });

  it('stores and replaces environments + collections', async () => {
    const envs = [{ id: 'dev', name: 'Development', baseUrl: 'http://localhost:3000', variables: [{ key: 'token', value: 's3cret', secret: true }] }];
    await request(app).put('/apidock/api/environments').send(envs).expect(200);
    expect((await request(app).get('/apidock/api/environments')).body[0].variables[0]).toMatchObject({ key: 'token', secret: true });
    await request(app).put('/apidock/api/environments').send({ nope: 1 }).expect(400);

    const cols = [{ id: 'c1', name: 'Smoke', requests: [{ id: 'r1', name: 'List users', method: 'GET', url: '/api/users', createdAt: new Date().toISOString() }] }];
    await request(app).put('/apidock/api/collections').send(cols).expect(200);
    expect((await request(app).get('/apidock/api/collections')).body[0].requests).toHaveLength(1);
  });

  it('scrubs secret env values out of stored history', async () => {
    await request(app).put('/apidock/api/environments').send([
      { id: 'dev', name: 'Dev', baseUrl: 'http://localhost:3999', variables: [{ key: 'key', value: 'sk-live-1234', secret: true }] },
    ]).expect(200);
    // Proxy will fail to connect (nothing on :3999) but the history entry is still written.
    await request(app)
      .post('/apidock/api/proxy')
      .send({ method: 'GET', url: 'http://localhost:3999/x?t=sk-live-1234', headers: { 'x-auth': 'sk-live-1234' } })
      .expect((r) => expect([502, 403]).toContain(r.status));
    const history = await request(app).get('/apidock/api/history').expect(200);
    expect(history.body[0].request.url).toContain('[redacted]');
    expect(history.body[0].request.headers['x-auth']).toBe('[redacted]');
  });
});

describe('design, snapshots and diff (e2e)', () => {
  const app = express().use('/apidock', createServer({ spec: () => testApi.toOpenAPI() }));

  const drafts = [
    {
      id: 'getPets',
      name: 'List pets',
      method: 'GET',
      path: '/pets/:petId',
      params: [{ name: 'petId', in: 'path', type: 'string' }],
      responseBody: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['cat', 'dog'] } } },
    },
  ];

  it('stores drafts and mocks them through /mock', async () => {
    await request(app).put('/apidock/api/drafts').send(drafts).expect(200);
    const stored = await request(app).get('/apidock/api/drafts').expect(200);
    expect(stored.body[0].method).toBe('GET');

    // The draft is not in the real spec, yet the mock answers for it.
    const res = await request(app).get('/apidock/mock/pets/abc').expect(200);
    expect(res.headers['x-apidock-mock']).toBe('/pets/{petId}');
    expect(['cat', 'dog']).toContain(res.body.kind);
  });

  it('rejects malformed drafts', async () => {
    await request(app).put('/apidock/api/drafts').send([{ id: 'x', name: 'bad', method: 'YEET', path: '/x' }]).expect(400);
    await request(app).put('/apidock/api/drafts').send([{ id: 'x', name: 'bad', method: 'GET', path: 'no-slash' }]).expect(400);
  });

  it('generates a defineApi contract from drafts', async () => {
    const res = await request(app).post('/apidock/api/design/codegen').send({}).expect(200);
    expect(res.body.code).toContain("import { defineApi } from 'apidock'");
    expect(res.body.code).toContain('path: "/pets/:petId"');
    expect(res.body.code).toContain('getPets');
  });

  it('snapshots the live spec and diffs against it', async () => {
    const snap = await request(app).post('/apidock/api/snapshots').send({ name: 'v1' }).expect(201);
    const list = await request(app).get('/apidock/api/snapshots').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].spec).toBeUndefined(); // meta only

    // Identical → no changes.
    const same = await request(app).post('/apidock/api/diff').send({ snapshot: snap.body.id }).expect(200);
    expect(same.body.ok).toBe(true);
    expect(same.body.changes).toHaveLength(0);

    // Post a modified "old" spec: dropping an operation must be breaking.
    const old = testApi.toOpenAPI();
    const head = JSON.parse(JSON.stringify(old));
    delete head.paths['/users/{id}'].delete;
    const report = await request(app).post('/apidock/api/diff').send({ spec: old, head }).expect(200);
    expect(report.body.ok).toBe(false);
    expect(report.body.breaking.some((c: { rule: string; at: string }) => c.rule === 'operation.removed' && c.at === 'DELETE /users/{id}')).toBe(true);

    await request(app).delete(`/apidock/api/snapshots/${snap.body.id}`).expect(204);
    await request(app).post('/apidock/api/diff').send({ snapshot: snap.body.id }).expect(404);
  });
});
