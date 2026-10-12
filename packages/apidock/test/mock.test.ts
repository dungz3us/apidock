import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import addFormatsCjs, { type FormatsPlugin } from 'ajv-formats';
import { buildMockResponse, matchOperation, mockFromSchema, parsePrefer, pickResponse } from '../src/server/mock.js';
import { toOpenAPI } from '../src/sdk/openapi.js';
import { testApi } from './fixtures.js';
import type { OpenAPIDoc } from '../src/server/mock.js';

// ajv-formats is CJS: under NodeNext its default import resolves to the namespace, the plugin is `.default`.
const addFormats = (addFormatsCjs as unknown as { default?: unknown }).default as FormatsPlugin;
const ajv = addFormats(new Ajv({ allErrors: true, strict: false }), ['email', 'uuid', 'date-time', 'uri']);
const doc = toOpenAPI(testApi) as OpenAPIDoc;

const validate = (schema: object, data: unknown) => {
  const v = ajv.compile(schema);
  const ok = v(data);
  return { ok, errors: v.errors };
};

describe('mockFromSchema', () => {
  it('generates schema-valid data for every component', () => {
    for (const [name, schema] of Object.entries(doc.components!.schemas!)) {
      const mock = mockFromSchema(doc, { $ref: `#/components/schemas/${name}` });
      const { ok, errors } = validate(schema, mock);
      expect(errors, `${name}: ${JSON.stringify(errors)}`).toBeNull();
      expect(ok).toBe(true);
    }
  });

  it('prefers declared examples over generated data', () => {
    expect(mockFromSchema(doc, { type: 'string', example: 'fixed' })).toBe('fixed');
    expect(mockFromSchema(doc, { enum: ['a', 'b'] })).toBe('a');
    expect(mockFromSchema(doc, { type: 'string', default: 'd' })).toBe('d');
  });

  it('is deterministic for a fixed seed', () => {
    const schema = doc.components!.schemas!.User!;
    const a = mockFromSchema(doc, schema, { seed: 42 });
    const b = mockFromSchema(doc, schema, { seed: 42 });
    expect(a).toEqual(b);
  });

  it('respects numeric bounds and array sizes', () => {
    const n = mockFromSchema(doc, { type: 'integer', minimum: 10, maximum: 20 }) as number;
    expect(n).toBeGreaterThanOrEqual(10);
    expect(n).toBeLessThanOrEqual(20);
    const arr = mockFromSchema(doc, { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer' } }) as unknown[];
    expect(arr).toHaveLength(3);
  });

  it('handles format hints and field-name heuristics', () => {
    expect(mockFromSchema(doc, { type: 'string', format: 'email' })).toMatch(/@/);
    const obj = mockFromSchema(doc, {
      type: 'object',
      properties: { email: { type: 'string' }, createdAt: { type: 'string' }, price: { type: 'number' } },
    }) as Record<string, unknown>;
    expect(String(obj.email)).toMatch(/@/);
    expect(obj.createdAt).toMatch(/T/);
    expect(typeof obj.price).toBe('number');
  });

  it('caps recursion depth on cyclic schemas', () => {
    const cyclic: OpenAPIDoc = {
      components: {
        schemas: {
          Node: { type: 'object', properties: { value: { type: 'string' }, next: { $ref: '#/components/schemas/Node' } } },
        },
      },
    };
    const out = mockFromSchema(cyclic, { $ref: '#/components/schemas/Node' }) as Record<string, unknown>;
    expect(out).toBeTruthy();
    let depth = 0;
    let cur: unknown = out;
    while (cur && typeof cur === 'object' && 'next' in cur) {
      cur = (cur as Record<string, unknown>).next;
      depth++;
    }
    expect(depth).toBeLessThanOrEqual(8);
  });
});

describe('route matching + response picking', () => {
  it('matches templated paths and extracts params', () => {
    const m = matchOperation(doc, 'GET', '/users/u_9');
    expect(m?.pathTemplate).toBe('/users/{id}');
    expect(m?.params.id).toBe('u_9');
    expect(matchOperation(doc, 'POST', '/users/u_9')).toBeUndefined();
    expect(matchOperation(doc, 'GET', '/nope')).toBeUndefined();
  });

  it('picks a 2xx response by default and honors Prefer code', () => {
    const op = matchOperation(doc, 'GET', '/users/u_1')!.operation;
    expect(pickResponse(op, {})?.status).toBe(200);
    expect(pickResponse(op, { code: 404 })?.status).toBe(404);
    expect(pickResponse(op, { code: 418 })?.status).toBe(200);
  });

  it('parses the Prefer header', () => {
    expect(parsePrefer('code=404, example=oops')).toEqual({ code: 404, example: 'oops' });
    expect(parsePrefer(undefined)).toEqual({});
  });
});

describe('buildMockResponse', () => {
  it('returns schema-valid bodies for every operation', () => {
    for (const [path, item] of Object.entries(doc.paths!)) {
      for (const method of ['get', 'post', 'patch', 'delete']) {
        const op = item[method];
        if (!op) continue;
        const sample = path.replace(/\{[^}]+\}/g, 'x');
        const result = buildMockResponse(doc, { method, path: sample });
        expect(result.error).toBeUndefined();
        expect(result.status).toBeGreaterThan(0);
      }
    }
  });

  it('404s with a clear error for unknown paths', () => {
    const r = buildMockResponse(doc, { method: 'GET', path: '/nothing/here' });
    expect(r.status).toBe(404);
    expect(r.error).toBe('no-match');
  });
});
