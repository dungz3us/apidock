import { Faker, en } from '@faker-js/faker';
import type { Request, Response } from 'express';

type Schema = Record<string, unknown>;
export type OpenAPIDoc = { paths?: Record<string, Record<string, unknown>>; components?: { schemas?: Record<string, Schema> } } & Record<string, unknown>;

const MAX_DEPTH = 6;

/** Property-name heuristics: first match wins. Checked only when the schema gives no better signal. */
const FIELD_HINTS: [RegExp, (f: Faker) => unknown][] = [
  [/^id$|_id$|^uuid$/i, (f) => f.string.uuid()],
  [/^e?mail/i, (f) => f.internet.email()],
  [/^(first|given)[_-]?name/i, (f) => f.person.firstName()],
  [/^(last|family|sur)[_-]?name/i, (f) => f.person.lastName()],
  [/(^|_)name$|username|full[_-]?name|^name$/i, (f) => f.person.fullName()],
  [/avatar|image|photo|picture|thumbnail/i, (f) => f.image.url()],
  [/^url$|website|homepage|link$/i, (f) => f.internet.url()],
  [/phone|mobile/i, (f) => f.phone.number()],
  [/^(city|country|address|street|zip|postal)/i, (f) => f.location.city()],
  [/^title$|^subject$/i, (f) => f.lorem.sentence({ min: 3, max: 6 })],
  [/description|summary|bio|about/i, (f) => f.lorem.paragraph()],
  [/price|amount|cost|total|balance/i, (f) => Number(f.commerce.price({ min: 1, max: 500 }))],
  [/company|organization/i, (f) => f.company.name()],
  [/ip(addr|address)?$/i, (f) => f.internet.ip()],
  [/user[_-]?agent/i, (f) => f.internet.userAgent()],
  [/(created|updated|deleted|modified|birth)?_?(at|date|on|time)$|^date/i, (f) => f.date.recent().toISOString()],
];

export interface MockOptions {
  /** Deterministic output for a given seed + schema. */
  seed?: number;
  /** Override depth cap for recursive schemas. */
  maxDepth?: number;
}

function resolveRef(doc: OpenAPIDoc, ref: string): Schema | undefined {
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref);
  return m ? doc.components?.schemas?.[decodeURIComponent(m[1]!)] : undefined;
}

function deref(doc: OpenAPIDoc, schema: Schema): Schema {
  let s = schema;
  for (let i = 0; typeof s.$ref === 'string' && i < MAX_DEPTH; i++) s = resolveRef(doc, s.$ref) ?? s;
  return s;
}

function nonNullType(schema: Schema): string {
  const t = schema.type;
  const list = Array.isArray(t) ? t : [t];
  return (list.find((x) => x !== 'null') as string) ?? 'object';
}

function mockString(faker: Faker, schema: Schema, hint?: string): string {
  if (typeof schema.pattern === 'string') {
    try {
      return faker.helpers.fromRegExp(schema.pattern);
    } catch {
      /* fall through */
    }
  }
  switch (schema.format) {
    case 'email':
    case 'idn-email':
      return faker.internet.email();
    case 'uuid':
      return faker.string.uuid();
    case 'date-time':
      return faker.date.recent().toISOString();
    case 'date':
      return faker.date.recent().toISOString().slice(0, 10)!;
    case 'time':
      return faker.date.recent().toISOString().slice(11, 19)!;
    case 'uri':
    case 'url':
      return faker.internet.url();
    case 'hostname':
      return faker.internet.domainName();
    case 'ipv4':
      return faker.internet.ipv4();
    case 'ipv6':
      return faker.internet.ipv6();
    case 'password':
      return faker.internet.password();
    case 'byte':
      return Buffer.from(faker.lorem.word()).toString('base64');
  }
  if (hint) {
    for (const [re, gen] of FIELD_HINTS) if (re.test(hint)) return String(gen(faker));
  }
  const min = typeof schema.minLength === 'number' ? schema.minLength : 0;
  const max = typeof schema.maxLength === 'number' ? schema.maxLength : undefined;
  let word = faker.lorem.words({ min: 1, max: 3 });
  while (word.length < min) word += ` ${faker.lorem.word()}`;
  return max !== undefined && word.length > max ? word.slice(0, max) : word;
}

function mockNumber(faker: Faker, schema: Schema, integer: boolean): number {
  const exclMin = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : undefined;
  const exclMax = typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : undefined;
  const min = exclMin !== undefined ? exclMin + (integer ? 1 : 0.01) : typeof schema.minimum === 'number' ? schema.minimum : 0;
  const max =
    exclMax !== undefined ? exclMax - (integer ? 1 : 0.01) : typeof schema.maximum === 'number' ? schema.maximum : Math.max(min + (integer ? 100 : 1), 100);
  const n = integer ? faker.number.int({ min: Math.ceil(min), max: Math.floor(max) }) : faker.number.float({ min, max, fractionDigits: 2 });
  const mult = typeof schema.multipleOf === 'number' && schema.multipleOf > 0 ? schema.multipleOf : 0;
  return mult ? Math.round(n / mult) * mult : n;
}

export function mockFromSchema(doc: OpenAPIDoc, schema: Schema, options: MockOptions = {}, hint?: string, depth = 0): unknown {
  const faker = options.seed !== undefined ? new Faker({ locale: en, seed: options.seed }) : new Faker({ locale: en });
  return generate(doc, schema, faker, options.maxDepth ?? MAX_DEPTH, hint, depth);
}

function generate(doc: OpenAPIDoc, raw: Schema, faker: Faker, maxDepth: number, hint: string | undefined, depth: number): unknown {
  if (depth > maxDepth) return null;
  const schema = deref(doc, raw);

  if (schema.const !== undefined) return schema.const;
  if (schema.example !== undefined) return schema.example;
  const examples = schema.examples;
  if (Array.isArray(examples) && examples.length) return examples[0];
  if (examples && typeof examples === 'object') {
    const first = Object.values(examples as Record<string, { value?: unknown }>)[0];
    if (first && typeof first === 'object' && 'value' in first) return first.value;
  }
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  for (const key of ['oneOf', 'anyOf'] as const) {
    const subs = schema[key];
    if (Array.isArray(subs) && subs.length) {
      const sub = faker.helpers.arrayElement(subs as Schema[]);
      const { oneOf: _o, anyOf: _a, ...rest } = schema;
      return generate(doc, { ...rest, ...deref(doc, sub) }, faker, maxDepth, hint, depth + 1);
    }
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    const merged: Record<string, unknown> = {};
    const req = new Set<string>();
    for (const sub of schema.allOf as Schema[]) {
      const g = generate(doc, sub, faker, maxDepth, hint, depth + 1);
      if (g && typeof g === 'object' && !Array.isArray(g)) Object.assign(merged, g);
      const s = deref(doc, sub);
      if (Array.isArray(s.required)) for (const k of s.required) req.add(k as string);
    }
    return merged;
  }

  switch (nonNullType(schema)) {
    case 'string':
      return mockString(faker, schema, hint);
    case 'integer':
      return mockNumber(faker, schema, true);
    case 'number':
      return mockNumber(faker, schema, false);
    case 'boolean':
      return faker.datatype.boolean();
    case 'array': {
      const items = (schema.items ?? {}) as Schema;
      const min = typeof schema.minItems === 'number' ? schema.minItems : 1;
      const max = typeof schema.maxItems === 'number' ? schema.maxItems : 3;
      const n = Math.min(Math.max(min, 1), Math.max(min, max));
      const set = new Set<unknown>();
      let guard = n * 10;
      while (set.size < n && guard-- > 0) set.add(generate(doc, items, faker, maxDepth, hint, depth + 1));
      return [...set];
    }
    default: {
      const props = (schema.properties ?? {}) as Record<string, Schema>;
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(props)) out[key] = generate(doc, sub, faker, maxDepth, key, depth + 1);
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        out[faker.lorem.word()] = generate(doc, schema.additionalProperties as Schema, faker, maxDepth, undefined, depth + 1);
      }
      return out;
    }
  }
}

// ── Route matching + handler ────────────────────────────────────────────────

interface MatchedOperation {
  pathTemplate: string;
  operation: Record<string, unknown>;
  params: Record<string, string>;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function templateToRegex(template: string): { re: RegExp; names: string[] } {
  const names: string[] = [];
  const re = new RegExp(`^${escapeRe(template).replace(/\\\{([^}]+)\\\}/g, (_m, name: string) => (names.push(name), '([^/]+)'))}/?$`);
  return { re, names };
}

export function matchOperation(doc: OpenAPIDoc, method: string, path: string): MatchedOperation | undefined {
  for (const [template, item] of Object.entries(doc.paths ?? {})) {
    const { re, names } = templateToRegex(template);
    const m = re.exec(path);
    if (!m) continue;
    const op = item[method.toLowerCase()];
    if (!op || typeof op !== 'object') continue;
    const params: Record<string, string> = {};
    names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1]!)));
    return { pathTemplate: template, operation: op as Record<string, unknown>, params };
  }
}

/** `Prefer: code=404, example=notFound`, mirrored by `?__code=` / `?__example=` / `?__delay=`. */
export function parsePrefer(header: string | undefined): { code?: number; example?: string } {
  const out: { code?: number; example?: string } = {};
  for (const part of (header ?? '').split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (k === 'code' && v && /^\d{3}$/.test(v)) out.code = Number(v);
    if (k === 'example' && v) out.example = v;
  }
  return out;
}

function responseContent(res: Record<string, unknown>): { mediaType: string; schema?: Schema; examples?: Record<string, { value?: unknown }> } {
  const content = (res.content ?? {}) as Record<string, { schema?: Schema; examples?: Record<string, { value?: unknown }>; example?: unknown }>;
  const mediaType = Object.keys(content)[0];
  return mediaType ? { mediaType, ...content[mediaType] } : { mediaType: 'application/json' };
}

export function pickResponse(
  operation: Record<string, unknown>,
  opts: { code?: number; example?: string },
): { status: number; response: Record<string, unknown> } | undefined {
  const responses = (operation.responses ?? {}) as Record<string, Record<string, unknown>>;
  const codes = Object.keys(responses);
  if (!codes.length) return undefined;
  const wanted = opts.code ? String(opts.code) : undefined;
  const pick =
    (wanted && responses[wanted] ? wanted : undefined) ??
    codes.find((c) => c === 'default' ? false : c.startsWith('2')) ??
    (responses.default ? 'default' : codes[0]);
  if (!pick) return undefined;
  return { status: pick === 'default' ? 200 : Number(pick), response: responses[pick]! };
}

export interface MockRequest {
  method: string;
  path: string;
  preferCode?: number;
  preferExample?: string;
  delayMs?: number;
}

export interface MockResult {
  status: number;
  mediaType: string;
  body: unknown;
  headers: Record<string, string>;
  matched?: { path: string; operationId?: string };
  error?: string;
}

export function buildMockResponse(doc: OpenAPIDoc, req: MockRequest): MockResult {
  const matched = matchOperation(doc, req.method, req.path);
  if (!matched) return { status: 404, mediaType: 'application/json', body: { error: `No mock for ${req.method} ${req.path}` }, headers: {}, error: 'no-match' };

  const { operation } = matched;
  const prefer = { code: req.preferCode, example: req.preferExample };
  const picked = pickResponse(operation, prefer);
  if (!picked) return { status: 501, mediaType: 'application/json', body: { error: 'Operation declares no responses' }, headers: {}, error: 'no-responses' };

  const { mediaType, schema, examples } = responseContent(picked.response);
  const headers: Record<string, string> = {};
  for (const [name, h] of Object.entries((picked.response.headers ?? {}) as Record<string, { example?: unknown }>)) {
    if (h?.example !== undefined) headers[name] = String(h.example);
  }

  let body: unknown;
  if (req.preferExample && examples?.[req.preferExample]) body = examples[req.preferExample]!.value;
  else if (schema) body = mockFromSchema(doc, schema, { seed: seedFor(req.method, req.path, picked.status) });

  return {
    status: picked.status,
    mediaType,
    body: body ?? null,
    headers,
    matched: { path: matched.pathTemplate, operationId: operation.operationId as string | undefined },
  };
}

const seedFor = (...parts: (string | number)[]): number => {
  let h = 2166136261;
  for (const c of parts.join('|')) h = (h ^ c.charCodeAt(0)) * 16777619;
  return h >>> 0;
};

export function mockHandler(getDoc: () => Promise<OpenAPIDoc>) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const path = `/${(Array.isArray(req.params.splat) ? req.params.splat : [req.params.splat]).filter(Boolean).join('/')}`;
      const prefer = parsePrefer(req.get('prefer'));
      const code = req.query.__code ? Number(req.query.__code) : prefer.code;
      const example = typeof req.query.__example === 'string' ? req.query.__example : prefer.example;
      const delay = Math.min(Number(req.query.__delay ?? 0) || 0, 10_000);

      const result = buildMockResponse(await getDoc(), { method: req.method, path, preferCode: code, preferExample: example });
      if (delay) await new Promise((r) => setTimeout(r, delay));
      for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
      res.setHeader('x-apidock-mock', result.matched ? result.matched.path : 'no-match');
      res.status(result.status).type(result.mediaType).send(typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  };
}
