import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineApi, type Api } from '../src/sdk/contract.js';
import { generateContract, schemaToZod } from '../src/server/codegen.js';
import type { OpenAPIDoc } from '../src/server/mock.js';
import { testApi } from './fixtures.js';

/** Evaluates generated TS by transpiling to CJS and stubbing imports for 'apidock' and 'zod'. */
function evalContract(code: string): Api {
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as { api?: Api } };
  const require = (id: string) => {
    if (id === 'zod') return { z };
    if (id === 'apidock') return { defineApi };
    throw new Error(`unexpected import ${id}`);
  };
  new Function('exports', 'require', 'module', js)(mod.exports, require, mod);
  if (!mod.exports.api) throw new Error('generated code did not export `api`');
  return mod.exports.api;
}

const ops = (doc: OpenAPIDoc) =>
  Object.entries(doc.paths ?? {}).flatMap(([p, item]) => Object.keys(item).map((m) => `${m.toUpperCase()} ${p}`)).sort();

describe('generateContract', () => {
  it('round-trips: generated contract produces the same paths and methods', () => {
    const original = testApi.toOpenAPI() as unknown as OpenAPIDoc;
    const code = generateContract(original);
    const regenerated = evalContract(code).toOpenAPI() as unknown as OpenAPIDoc;

    expect(ops(regenerated)).toEqual(ops(original));

    // Response status codes preserved per operation.
    for (const [p, item] of Object.entries(original.paths ?? {})) {
      for (const [m, op] of Object.entries(item)) {
        const regenOp = (regenerated.paths![p] as Record<string, { responses?: Record<string, unknown> }>)[m]!;
        expect(Object.keys(regenOp.responses ?? {}).sort()).toEqual(Object.keys((op as { responses: object }).responses).sort());
      }
    }
  });

  it('emits readable schema consts and coerced query params', () => {
    const code = generateContract(testApi.toOpenAPI() as unknown as OpenAPIDoc);
    expect(code).toContain("import { defineApi } from 'apidock'");
    expect(code).toMatch(/const User = z\.object/);
    expect(code).toContain('z.coerce.number()');
  });
});

describe('schemaToZod', () => {
  it('maps common JSON Schema shapes', () => {
    const doc = {} as OpenAPIDoc;
    expect(schemaToZod({ type: 'string', format: 'email' }, doc)).toBe('z.email()');
    expect(schemaToZod({ type: 'integer' }, doc)).toBe('z.number().int()');
    expect(schemaToZod({ enum: ['a', 'b'] }, doc)).toBe('z.union([z.literal("a"), z.literal("b")])');
    expect(schemaToZod({ type: 'array', items: { type: 'string' } }, doc)).toBe('z.array(z.string())');
    expect(schemaToZod({ type: ['string', 'null'] }, doc)).toBe('z.string().nullable()');
  });
});
