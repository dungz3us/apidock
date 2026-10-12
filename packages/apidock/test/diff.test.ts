import { describe, expect, it } from 'vitest';
import { diffSpecs } from '../src/server/diff.js';
import type { OpenAPIDoc } from '../src/server/mock.js';

const base: OpenAPIDoc = {
  openapi: '3.1.0',
  info: { title: 't', version: '1' },
  paths: {
    '/users': {
      get: {
        operationId: 'list',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: { 200: { content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } },
      },
      post: {
        operationId: 'create',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, nick: { type: 'string' } } } } },
        },
        responses: { 201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } }, 409: {} },
      },
    },
    '/users/{id}': { delete: { operationId: 'del', responses: { 204: {} } } },
  },
  components: {
    schemas: {
      User: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string', format: 'email' } } },
    },
  },
};

const clone = () => JSON.parse(JSON.stringify(base)) as OpenAPIDoc;

/* eslint-disable @typescript-eslint/no-explicit-any */
const op = (doc: OpenAPIDoc, p: string, m: string) => (doc.paths![p] as any)[m] as any;
const userSchema = (doc: OpenAPIDoc) => doc.components!.schemas!.User as any;
const createBody = (doc: OpenAPIDoc) => op(doc, '/users', 'post').requestBody.content['application/json'].schema as any;

describe('diffSpecs', () => {
  it('reports no changes for identical docs', () => {
    const r = diffSpecs(base, clone());
    expect(r.ok).toBe(true);
    expect(r.changes).toHaveLength(0);
  });

  it('breaking: operation removed, response removed, required request property added', () => {
    const next = clone();
    delete (next.paths!['/users/{id}'] as Record<string, unknown>).delete;
    delete op(next, '/users', 'post').responses['409'];
    const body = createBody(next);
    body.properties.age = { type: 'integer' };
    body.required.push('age');

    const r = diffSpecs(base, next);
    expect(r.ok).toBe(false);
    expect(r.breaking.map((c) => c.rule)).toEqual(
      expect.arrayContaining(['operation.removed', 'response.removed', 'schema.required-added']),
    );
  });

  it('breaking: response property removed and enum narrowed in request', () => {
    const next = clone();
    delete userSchema(next).properties.email;
    op(next, '/users', 'get').parameters[0].schema = { type: 'integer', enum: [10, 20] };

    const r = diffSpecs(base, next);
    expect(r.breaking.map((c) => c.rule)).toEqual(expect.arrayContaining(['schema.property-removed', 'schema.enum-narrowed']));
    expect(r.breaking.find((c) => c.rule === 'schema.property-removed')!.at).toContain('GET /users.200[]');
  });

  it('breaking: param becomes required; addition: new optional param and new operation', () => {
    const next = clone();
    op(next, '/users', 'get').parameters[0].required = true;
    op(next, '/users', 'get').parameters.push({ name: 'q', in: 'query', schema: { type: 'string' } });
    next.paths!['/ping'] = { get: { operationId: 'ping', responses: { 200: {} } } };

    const r = diffSpecs(base, next);
    expect(r.breaking.map((c) => c.rule)).toContain('param.required-added');
    expect(r.additions.map((c) => c.rule)).toEqual(expect.arrayContaining(['param.added', 'operation.added']));
  });

  it('warning: optional request property removed, security changed', () => {
    const next = clone();
    delete createBody(next).properties.nick;
    op(next, '/users', 'post').security = [{ bearerAuth: [] }];

    const r = diffSpecs(base, next);
    expect(r.ok).toBe(true); // warnings only
    expect(r.warnings.map((c) => c.rule)).toEqual(expect.arrayContaining(['schema.property-removed', 'security.changed']));
  });

  it('breaking: response enum expanded (consumers see new values)', () => {
    const next = clone();
    userSchema(next).properties.name.enum = ['a', 'b'];
    const before = clone();
    userSchema(before).properties.name.enum = ['a'];

    const r = diffSpecs(before, next);
    expect(r.breaking.map((c) => c.rule)).toContain('schema.enum-expanded');
  });
});
