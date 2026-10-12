import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineApi, parseRequest, parseResponse, toOpenApiPath } from '../src/index.js';
import { testApi } from './fixtures.js';

describe('defineApi', () => {
  it('rejects duplicate method + path', () => {
    expect(() =>
      defineApi({
        info: { title: 't', version: '1' },
        routes: {
          a: { method: 'GET', path: '/x/:id', responses: { 200: z.string() } },
          b: { method: 'GET', path: '/x/:key', responses: { 200: z.string() } },
        },
      }),
    ).toThrow(/duplicates "a"/);
  });

  it('rejects params schema that does not match the path', () => {
    expect(() =>
      defineApi({
        info: { title: 't', version: '1' },
        routes: { a: { method: 'GET', path: '/x/:id', params: z.object({ nope: z.string() }), responses: { 200: z.string() } } },
      }),
    ).toThrow(/missing: id/);
  });
});

describe('toOpenAPI', () => {
  const doc = testApi.toOpenAPI();

  it('converts express paths and methods', () => {
    expect(toOpenApiPath('/a/:b/c/:d')).toBe('/a/{b}/c/{d}');
    expect(Object.keys(doc.paths!)).toEqual(['/users', '/users/{id}']);
    expect(Object.keys(doc.paths!['/users/{id}']!)).toEqual(['get', 'delete']);
  });

  it('registers named schemas as components and references them', () => {
    expect(doc.components?.schemas?.User).toMatchObject({ type: 'object', required: ['id', 'name', 'email'] });
    const ok = doc.paths!['/users/{id}']!.get.responses['200'];
    expect(ok.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/User' });
    expect(doc.paths!['/users/{id}']!.get.responses['404'].description).toBe('User not found');
  });

  it('adds implicit path params and default descriptions', () => {
    const del = doc.paths!['/users/{id}']!.delete;
    expect(del.parameters).toEqual([expect.objectContaining({ name: 'id', in: 'path', required: true })]);
    expect(del.responses['204']).toEqual({ description: 'Deleted' });
    expect(doc.paths!['/users']!.post.responses['400'].description).toBe('Bad Request');
  });

  it('uses route ids as operationId and keeps servers', () => {
    expect(doc.paths!['/users']!.post.operationId).toBe('createUser');
    expect(doc.paths!['/users']!.post.requestBody.required).toBe(true);
    expect(doc.servers).toEqual([{ url: '/api' }]);
    expect(doc.openapi).toBe('3.1.0');
  });
});

describe('validation', () => {
  it('coerces valid input and reports issues by location', () => {
    const ok = parseRequest(testApi.routes.listUsers, { params: {}, query: { limit: '5' }, headers: {}, body: undefined });
    expect(ok).toEqual({ success: true, data: expect.objectContaining({ query: { limit: 5 } }) });

    const bad = parseRequest(testApi.routes.createUser, { params: {}, query: {}, headers: {}, body: { name: '', email: 'x' } });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.issues.map((i) => `${i.location}:${i.path}`)).toEqual(['body:name', 'body:email']);
  });

  it('validates responses against the declared status', () => {
    expect(parseResponse(testApi.routes.getUser, 200, { id: '1', name: 'a', email: 'a@b.co' }).success).toBe(true);
    expect(parseResponse(testApi.routes.getUser, 200, { id: 1 }).success).toBe(false);
    expect(parseResponse(testApi.routes.getUser, 500, {}).success).toBe(false);
    expect(parseResponse(testApi.routes.deleteUser, 204, undefined).success).toBe(true);
  });
});
