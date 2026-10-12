/* Minimal OpenAPI 3.x model: just what the UI reads. */

export type Schema = {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  example?: unknown;
  examples?: unknown[];
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  nullable?: boolean;
  additionalProperties?: boolean | Schema;
};

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  deprecated?: boolean;
  schema?: Schema;
  example?: unknown;
  $ref?: string;
}

export interface MediaType {
  schema?: Schema;
  example?: unknown;
  examples?: Record<string, { value?: unknown; summary?: string }>;
}

export interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; description?: string; content?: Record<string, MediaType>; $ref?: string };
  responses?: Record<string, { description?: string; content?: Record<string, MediaType>; $ref?: string }>;
}

export interface OpenAPIDoc {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, Schema>; parameters?: Record<string, Parameter>; [k: string]: unknown };
}

export interface Operation {
  id: string;
  method: string;
  path: string;
  section: string;
  op: OperationObject;
  parameters: Parameter[];
}

export interface Section {
  number: string;
  tag: string;
  description?: string;
  operations: Operation[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

export function resolveRef<T>(doc: OpenAPIDoc, value: T & { $ref?: string }): T {
  let current: unknown = value;
  for (let depth = 0; depth < 16; depth++) {
    const ref = (current as { $ref?: string } | undefined)?.$ref;
    if (!ref?.startsWith('#/')) break;
    current = ref
      .slice(2)
      .split('/')
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], doc);
  }
  return (current ?? value) as T;
}

/** Group operations by tag (spec order) and number them like RFC sections: 1.1, 1.2, 2.1 … */
export function buildSections(doc: OpenAPIDoc): Section[] {
  const order = (doc.tags ?? []).map((t) => t.name);
  const byTag = new Map<string, Operation[]>();
  const used = new Set<string>();

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    const shared = ((item.parameters as Parameter[] | undefined) ?? []).map((p) => resolveRef(doc, p));
    for (const method of METHODS) {
      const op = item[method] as OperationObject | undefined;
      if (!op) continue;
      const own = (op.parameters ?? []).map((p) => resolveRef(doc, p));
      const parameters = [...shared.filter((s) => !own.some((o) => o.name === s.name && o.in === s.in)), ...own];
      let id = op.operationId ?? `${method}_${path}`.replace(/[^\w]+/g, '_');
      while (used.has(id)) id += '_';
      used.add(id);
      const tag = op.tags?.[0] ?? 'default';
      if (!order.includes(tag)) order.push(tag);
      const list = byTag.get(tag) ?? [];
      list.push({ id, method: method.toUpperCase(), path, op, parameters, section: '' });
      byTag.set(tag, list);
    }
  }

  return order
    .filter((tag) => byTag.has(tag))
    .map((tag, i) => {
      const number = String(i + 1);
      const operations = byTag.get(tag)!.map((o, j) => ({ ...o, section: `${number}.${j + 1}` }));
      return { number, tag, description: doc.tags?.find((t) => t.name === tag)?.description, operations };
    });
}

const typeOf = (s: Schema): string | undefined => (Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type);

/** Compact type label: `integer, 1..100`, `string (email)`, `"a" | "b"`. */
export function schemaLabel(doc: OpenAPIDoc, input: Schema | undefined): string {
  if (!input) return 'any';
  const s = resolveRef(doc, input);
  if (input.$ref) return input.$ref.split('/').pop()!;
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (s.const !== undefined) return JSON.stringify(s.const);
  const variants = s.oneOf ?? s.anyOf;
  if (variants) return variants.map((v) => schemaLabel(doc, v)).join(' | ');
  const type = typeOf(s) ?? (s.properties ? 'object' : 'any');
  if (type === 'array') return `${schemaLabel(doc, s.items)}[]`;
  const extras: string[] = [];
  if (s.format) extras.push(s.format);
  const min = s.minimum ?? s.exclusiveMinimum;
  const max = s.maximum ?? s.exclusiveMaximum;
  if (min !== undefined || max !== undefined) extras.push(`${min ?? ''}..${max ?? ''}`);
  if (s.minLength !== undefined || s.maxLength !== undefined) extras.push(`len ${s.minLength ?? 0}..${s.maxLength ?? ''}`);
  const nullable = Array.isArray(s.type) && s.type.includes('null');
  return `${type}${extras.length ? `, ${extras.join(', ')}` : ''}${nullable ? ' | null' : ''}`;
}

const FORMAT_SAMPLES: Record<string, unknown> = {
  email: 'user@example.com',
  uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  uri: 'https://example.com',
  url: 'https://example.com',
  'date-time': '2026-01-01T00:00:00Z',
  date: '2026-01-01',
  time: '12:00:00',
  ipv4: '192.0.2.1',
  ipv6: '2001:db8::1',
  hostname: 'example.com',
};

/** Example value for a schema: explicit examples first, then a type-shaped placeholder. */
export function sampleFromSchema(doc: OpenAPIDoc, input: Schema | undefined, depth = 0): unknown {
  if (!input || depth > 6) return undefined;
  const s = resolveRef(doc, input);
  if (s.example !== undefined) return s.example;
  if (s.examples?.length) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (s.enum?.length) return s.enum[0];
  if (s.allOf) return Object.assign({}, ...s.allOf.map((p) => sampleFromSchema(doc, p, depth + 1) ?? {}));
  const variant = s.oneOf?.[0] ?? s.anyOf?.[0];
  if (variant) return sampleFromSchema(doc, variant, depth + 1);

  switch (typeOf(s) ?? (s.properties ? 'object' : undefined)) {
    case 'object':
      return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, sampleFromSchema(doc, v, depth + 1)]));
    case 'array':
      return [sampleFromSchema(doc, s.items, depth + 1)].filter((v) => v !== undefined);
    case 'string':
      return FORMAT_SAMPLES[s.format ?? ''] ?? 'string';
    case 'integer':
    case 'number':
      return s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 0);
    case 'boolean':
      return false;
    default:
      return undefined;
  }
}

export function jsonBodyOf(op: OperationObject): { contentType: string; media: MediaType } | undefined {
  const content = op.requestBody?.content;
  if (!content) return undefined;
  const contentType = Object.keys(content).find((c) => /json/i.test(c)) ?? Object.keys(content)[0];
  return contentType ? { contentType, media: content[contentType]! } : undefined;
}

export function serverBase(doc: OpenAPIDoc, index = 0): string {
  const url = doc.servers?.[index]?.url ?? '';
  return url.replace(/\/+$/, '');
}
