import type { OpenAPIDoc } from './mock.js';

type Schema = Record<string, unknown>;

/** Names of component schemas, so `$ref`s become top-level `const`s. */
function refName(ref: string): string | undefined {
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref);
  return m ? decodeURIComponent(m[1]!).replace(/[^A-Za-z0-9_$]/g, '_') : undefined;
}

/** Converts a JSON Schema fragment to a Zod expression. Unknown shapes degrade to z.unknown(). */
export function schemaToZod(schema: Schema | undefined, doc: OpenAPIDoc, seen = new Set<string>()): string {
  if (!schema) return 'z.unknown()';
  if (typeof schema.$ref === 'string') {
    const name = refName(schema.$ref);
    if (!name) return 'z.unknown()';
    if (seen.has(name)) return `z.lazy(() => ${name})`;
    return name;
  }
  if (schema.const !== undefined) return `z.literal(${JSON.stringify(schema.const)})`;
  if (Array.isArray(schema.enum)) {
    const parts = (schema.enum as unknown[]).map((v) => `z.literal(${JSON.stringify(v)})`);
    return parts.length === 1 ? parts[0]! : `z.union([${parts.join(', ')}])`;
  }
  for (const combiner of ['oneOf', 'anyOf'] as const) {
    const subs = schema[combiner] as Schema[] | undefined;
    if (Array.isArray(subs) && subs.length) return `z.union([${subs.map((s) => schemaToZod(s, doc, seen)).join(', ')}])`;
  }
  const all = schema.allOf as Schema[] | undefined;
  if (Array.isArray(all) && all.length) {
    // Merge object schemas; fall back to the first branch when merging isn't possible.
    const merged = all.reduce<Schema>((acc, s) => ({ ...acc, ...resolve(doc, s) }), {});
    return schemaToZod(merged, doc, seen);
  }
  if (schema.nullable === true) return `${schemaToZod({ ...schema, nullable: undefined }, doc, seen)}.nullable()`;

  const t = Array.isArray(schema.type) ? (schema.type as string[]).filter((x) => x !== 'null') : [schema.type as string | undefined];
  const nullable = Array.isArray(schema.type) && (schema.type as string[]).includes('null');
  const expr = baseType(t[0], schema, doc, seen);
  return nullable ? `${expr}.nullable()` : expr;
}

const resolve = (doc: OpenAPIDoc, s: Schema): Schema => {
  if (typeof s.$ref === 'string') {
    const name = refName(s.$ref);
    return (doc.components?.schemas?.[name!] as Schema | undefined) ?? s;
  }
  return s;
};

function baseType(t: string | undefined, schema: Schema, doc: OpenAPIDoc, seen: Set<string>): string {
  switch (t) {
    case 'string': {
      switch (schema.format) {
        case 'email': return 'z.email()';
        case 'uuid': return 'z.uuid()';
        case 'uri':
        case 'url': return 'z.url()';
        case 'date-time': return 'z.iso.datetime()';
        case 'date': return 'z.iso.date()';
        default: return 'z.string()';
      }
    }
    case 'integer':
      return 'z.number().int()';
    case 'number':
      return 'z.number()';
    case 'boolean':
      return 'z.boolean()';
    case 'array':
      return `z.array(${schemaToZod(schema.items as Schema | undefined, doc, seen)})`;
    case 'object':
    case undefined: {
      const props = (schema.properties ?? {}) as Record<string, Schema>;
      const names = Object.keys(props);
      const additional = schema.additionalProperties;
      if (!names.length) {
        if (additional && typeof additional === 'object') return `z.record(z.string(), ${schemaToZod(additional as Schema, doc, seen)})`;
        return 'z.record(z.string(), z.unknown())';
      }
      const required = new Set(schema.required as string[] ?? []);
      const fields = names
        .map((n) => `    ${JSON.stringify(n)}: ${schemaToZod(props[n], doc, seen)}${required.has(n) ? '' : '.optional()'},`)
        .join('\n');
      return `z.object({\n${fields}\n  })`;
    }
    default:
      return 'z.unknown()';
  }
}

const camel = (s: string) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : '')).replace(/^[A-Z]/, (c) => c.toLowerCase());
const routeId = (method: string, template: string, opId: unknown) =>
  typeof opId === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(opId) ? opId : camel(`${method}_${template.replace(/[{}]/g, ':')}`) || 'root';

interface Param {
  name?: string;
  in?: string;
  required?: boolean;
  schema?: Schema;
}

/** Query/path params arrive as strings — coerce numeric/boolean schemas. */
function paramZod(p: Param, doc: OpenAPIDoc): string {
  const s = resolve(doc, p.schema ?? {});
  const t = s.type;
  const expr =
    t === 'integer' ? 'z.coerce.number().int()' :
    t === 'number' ? 'z.coerce.number()' :
    t === 'boolean' ? 'z.coerce.boolean()' :
    schemaToZod(s.type ? s : { ...s, type: 'string' }, doc);
  return p.required === false ? `${expr}.optional()` : expr;
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

/**
 * Generates TypeScript source for a `defineApi` contract matching the given spec.
 * Body params assume JSON; complex content types degrade to `z.unknown()`.
 */
export function generateContract(doc: OpenAPIDoc): string {
  const schemas = doc.components?.schemas ?? {};
  const schemaConsts = Object.entries(schemas)
    .map(([name, s]) => {
      const safe = name.replace(/[^A-Za-z0-9_$]/g, '_');
      return `const ${safe} = ${schemaToZod(s, doc, new Set([safe]))}.meta({ id: ${JSON.stringify(name)} });`;
    })
    .join('\n');

  const routes: string[] = [];
  for (const [template, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method] as Record<string, unknown> | undefined;
      if (!op) continue;
      const params = ((item.parameters as Param[]) ?? []).concat((op.parameters as Param[]) ?? []);
      const byIn = (place: string) => params.filter((p) => p.in === place);
      const fields: string[] = [`    method: ${JSON.stringify(method.toUpperCase())},`, `    path: ${JSON.stringify(template.replace(/\{([^}]+)\}/g, ':$1'))},`];
      if (typeof op.summary === 'string') fields.push(`    summary: ${JSON.stringify(op.summary)},`);
      for (const place of ['path', 'query', 'header'] as const) {
        const list = byIn(place === 'path' ? 'path' : place);
        if (!list.length) continue;
        const key = place === 'path' ? 'params' : place === 'query' ? 'query' : 'headers';
        const body = list.map((p) => `      ${JSON.stringify(p.name)}: ${paramZod(p, doc)},`).join('\n');
        fields.push(`    ${key}: z.object({\n${body}\n    }),`);
      }
      const rb = op.requestBody as { content?: Record<string, { schema?: Schema }> } | undefined;
      const bodySchema = rb ? jsonSchemaOf(rb) : undefined;
      if (bodySchema) fields.push(`    body: ${schemaToZod(bodySchema, doc)},`);

      const responses = (op.responses ?? {}) as Record<string, { content?: Record<string, { schema?: Schema }> }>;
      const entries = Object.entries(responses)
        .filter(([code]) => /^\d+$/.test(code))
        .map(([code, r]) => {
          const s = r ? jsonSchemaOf(r) : undefined;
          return `      ${code}: ${s ? schemaToZod(s, doc) : 'z.unknown()'},`;
        });
      fields.push(`    responses: {\n${entries.join('\n')}\n    },`);
      routes.push(`    ${routeId(method, template, op.operationId)}: {\n${fields.join('\n').replace(/^    /gm, '      ')}\n    },`);
    }
  }

  const info = doc.info as { title?: string; version?: string; description?: string } | undefined;
  const infoSrc = `  info: { title: ${JSON.stringify(info?.title ?? 'API')}, version: ${JSON.stringify(info?.version ?? '0.0.0')}${info?.description ? `, description: ${JSON.stringify(info.description)}` : ''} },`;

  return `import { defineApi } from 'apidock';
import { z } from 'zod';

${schemaConsts ? `${schemaConsts}\n\n` : ''}export const api = defineApi({
${infoSrc}
  routes: {
${routes.join('\n')}
  },
});
`;
}

const jsonSchemaOf = (container: { content?: Record<string, { schema?: Schema }> }): Schema | undefined => {
  const c = container.content;
  if (!c) return undefined;
  const key = Object.keys(c).find((k) => /json/i.test(k)) ?? Object.keys(c)[0];
  return key ? c[key]?.schema : undefined;
};
