import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apidock, createRouter, serveSpec, validate, type Handlers } from '../src/express/index.js';
import { MemoryStorage } from '../src/storage/index.js';
import { testApi } from './fixtures.js';

type User = { id: string; name: string; email: string };

function makeApp(opts: { auth?: { username: string; password: string }; enabled?: boolean; storage?: MemoryStorage } = {}) {
  const users = new Map<string, User>([['u_1', { id: 'u_1', name: 'Ada', email: 'ada@example.com' }]]);
  const handlers: Handlers<typeof testApi.routes> = {
    listUsers: ({ query }) => ({ status: 200, body: [...users.values()].slice(0, query.limit ?? 100) }),
    getUser: ({ params }) => {
      const user = users.get(params.id);
      return user ? { status: 200, body: user } : { status: 404, body: { error: 'not found' } };
    },
    createUser: ({ body }) => {
      const user = { id: `u_${users.size + 1}`, ...body };
      users.set(user.id, user);
      return { status: 201, body: user };
    },
    deleteUser: ({ params }) => {
      users.delete(params.id);
      return { status: 204 };
    },
  };
  const app = express();
  app.use('/api', createRouter(testApi, handlers));
  app.get('/openapi.json', serveSpec(testApi));
  app.use('/apidock', apidock({ api: testApi, storage: opts.storage ?? new MemoryStorage(), ...opts }));
  return app;
}

describe('createRouter', () => {
  const app = makeApp();

  it('serves typed handlers with coerced input', async () => {
    const list = await request(app).get('/api/users?limit=1');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const created = await request(app).post('/api/users').send({ name: 'Linus', email: 'linus@example.com' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 'u_2', name: 'Linus' });

    expect((await request(app).get('/api/users/nope')).status).toBe(404);
    expect((await request(app).delete('/api/users/u_2')).status).toBe(204);
  });

  it('rejects invalid requests with located issues', async () => {
    const res = await request(app).post('/api/users').send({ name: '', email: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.issues.map((i: { location: string; path: string }) => `${i.location}:${i.path}`)).toEqual(['body:name', 'body:email']);
    expect((await request(app).get('/api/users?limit=0')).status).toBe(400);
  });

  it('serves the spec', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.body.paths['/users/{id}'].get.operationId).toBe('getUser');
  });

  it('enforces handler return types at compile time', () => {
    const check: Handlers<typeof testApi.routes>['getUser'] = () =>
      // @ts-expect-error 201 is not a declared status for getUser
      ({ status: 201, body: { id: '1', name: 'a', email: 'a@b.co' } });
    const check2: Handlers<typeof testApi.routes>['getUser'] = () =>
      // @ts-expect-error body does not match User
      ({ status: 200, body: { id: 1 } });
    const check3: Handlers<typeof testApi.routes>['deleteUser'] = ({ params }) => {
      const id: string = params.id;
      // @ts-expect-error only path params exist
      void params.other;
      return { status: 204, headers: { 'x-deleted': id } };
    };
    expect([check, check2, check3]).toHaveLength(3);
  });

  it('can validate responses strictly', async () => {
    const broken = express();
    broken.use(createRouter(testApi, makeHandlersReturning({ id: 'x' }) as never, { validateResponses: 'strict' }));
    const res = await request(broken).get('/users/x');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('ContractViolation');
  });
});

function makeHandlersReturning(body: unknown) {
  const h = () => ({ status: 200, body });
  return { listUsers: h, getUser: h, createUser: h, deleteUser: h };
}

describe('validate middleware for existing routes', () => {
  it('exposes parsed input on res.locals', async () => {
    const app = express();
    app.get('/search', validate({ method: 'GET', path: '/search', query: z.object({ q: z.string().min(2) }), responses: { 200: z.any() } }), (_req, res) => {
      res.json(res.locals.input.query);
    });
    expect((await request(app).get('/search?q=a')).status).toBe(400);
    expect((await request(app).get('/search?q=abc')).body).toEqual({ q: 'abc' });
  });
});

describe('apidock mount', () => {
  it('redirects to a trailing slash and serves the spec in JSON and YAML', async () => {
    const app = makeApp();
    const redirect = await request(app).get('/apidock?x=1');
    expect(redirect.status).toBe(301);
    expect(redirect.headers.location).toBe('/apidock/?x=1');
    expect((await request(app).get('/apidock/')).status).toBe(200);

    const spec = await request(app).get('/apidock/api/spec');
    expect(spec.body.info.title).toBe('Test API');
    const yaml = await request(app).get('/apidock/api/spec?format=yaml');
    expect(yaml.text).toContain('openapi: 3.1.0');

    const config = await request(app).get('/apidock/api/config');
    expect(config.body).toMatchObject({ mode: 'embedded', title: 'Test API', specError: null });
  });

  it('is disabled when enabled=false', async () => {
    const app = makeApp({ enabled: false });
    expect((await request(app).get('/apidock/api/spec')).status).toBe(404);
  });

  it('requires basic auth when configured', async () => {
    const app = makeApp({ auth: { username: 'admin', password: 's3cret' } });
    expect((await request(app).get('/apidock/api/spec')).status).toBe(401);
    expect((await request(app).get('/apidock/api/spec').auth('admin', 'wrong')).status).toBe(401);
    expect((await request(app).get('/apidock/api/spec').auth('admin', 's3cret')).status).toBe(200);
  });

  it('proxies relative requests to the app itself and records redacted history', async () => {
    const storage = new MemoryStorage();
    const app = makeApp({ storage });
    const res = await request(app)
      .post('/apidock/api/proxy')
      .send({ method: 'GET', url: '/api/users/u_1', headers: { authorization: 'Bearer secret' }, operationId: 'getUser' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(200);
    expect(JSON.parse(res.body.body)).toMatchObject({ name: 'Ada' });
    expect(res.body.durationMs).toBeGreaterThanOrEqual(0);

    const history = await request(app).get('/apidock/api/history');
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({ operationId: 'getUser', request: { headers: { authorization: '[redacted]' } } });
  });

  it('refuses hosts that are not allowed', async () => {
    const app = makeApp();
    const res = await request(app).post('/apidock/api/proxy').send({ method: 'GET', url: 'http://169.254.169.254/latest/meta-data' });
    expect(res.status).toBe(403);
    expect((await request(app).post('/apidock/api/proxy').send({ url: 1 })).status).toBe(400);
  });
});
