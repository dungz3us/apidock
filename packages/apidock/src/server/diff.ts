import type { OpenAPIDoc } from './mock.js';

export type ChangeLevel = 'breaking' | 'warning' | 'addition';

export interface Change {
  level: ChangeLevel;
  /** Machine-readable rule id, e.g. `operation.removed`. */
  rule: string;
  /** Human location: `GET /users/{id}` or `POST /users → request.body.name`. */
  at: string;
  message: string;
}

export interface DiffReport {
  /** Old → new titles for context. */
  oldInfo: { title?: string; version?: string };
  newInfo: { title?: string; version?: string };
  changes: Change[];
  breaking: Change[];
  warnings: Change[];
  additions: Change[];
  /** true when no breaking changes. */
  ok: boolean;
}

type Schema = Record<string, unknown>;
type Operation = Record<string, unknown>;
interface Parameter {
  name?: string;
  in?: string;
  required?: boolean;
  schema?: Schema;
}
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'] as const;

const resolve = (doc: OpenAPIDoc, schema: Schema | undefined): Schema => {
  let s = schema ?? {};
  for (let i = 0; typeof s.$ref === 'string' && i < 8; i++) {
    const m = /^#\/components\/schemas\/(.+)$/.exec(s.$ref);
    if (!m) break;
    s = (doc.components?.schemas?.[decodeURIComponent(m[1]!)] as Schema | undefined) ?? {};
  }
  return s;
};

const types = (s: Schema): string[] => (Array.isArray(s.type) ? (s.type as string[]) : typeof s.type === 'string' ? [s.type] : []);

const sortedSet = (v: unknown[] | undefined) => [...(v ?? [])].map((x) => JSON.stringify(x)).sort();

/**
 * Compares two resolved schemas. `dir` decides which changes hurt clients:
 * - `request`: producers send this — new constraints are breaking (required+, narrower enum/type).
 * - `response`: consumers read this — removed properties/statuses and type changes are breaking.
 */
function diffSchema(oldDoc: OpenAPIDoc, newDoc: OpenAPIDoc, oldS: Schema, newS: Schema, at: string, dir: 'request' | 'response', out: Change[]) {
  const a = resolve(oldDoc, oldS);
  const b = resolve(newDoc, newS);
  const push = (level: ChangeLevel, rule: string, message: string) => out.push({ level, rule, at, message });

  const [ta, tb] = [new Set(types(a)), new Set(types(b))];
  if (ta.size && tb.size) {
    for (const t of tb) if (!ta.has(t)) push('breaking', 'schema.type-expanded', `type now allows "${t}"`);
    for (const t of ta) if (!tb.has(t)) push(dir === 'request' ? 'breaking' : 'breaking', 'schema.type-removed', `type "${t}" no longer allowed`);
  }
  if (a.format !== b.format && (a.format || b.format)) push('warning', 'schema.format', `format ${a.format ?? '—'} → ${b.format ?? '—'}`);

  // enum narrowing rejects values producers may send → breaking for requests;
  // enum expansion returns values consumers don't expect → breaking for responses.
  const [ea, eb] = [sortedSet(a.enum as unknown[]), sortedSet(b.enum as unknown[])];
  if (JSON.stringify(ea) !== JSON.stringify(eb)) {
    const removed = ea.filter((x) => !eb.includes(x));
    const added = eb.filter((x) => !ea.includes(x));
    if (eb.length && dir === 'request' && (removed.length || !ea.length))
      push('breaking', 'schema.enum-narrowed', `enum ${ea.length ? `no longer allows ${removed.join(', ')}` : `added: [${eb.join(', ')}]`}`);
    else if (added.length && dir === 'response') push('breaking', 'schema.enum-expanded', `enum now allows ${added.join(', ')}`);
    else push('warning', 'schema.enum', `enum ${ea.length ? `[${ea.join(', ')}]` : 'none'} → ${eb.length ? `[${eb.join(', ')}]` : 'none'}`);
  }
  if (a.const !== b.const && (a.const !== undefined || b.const !== undefined))
    push('breaking', 'schema.const', `const ${JSON.stringify(a.const)} → ${JSON.stringify(b.const)}`);

  // Numeric/string bounds: tightening is breaking for requests; loosening for responses.
  for (const [key, kind] of [
    ['minimum', 'min'],
    ['exclusiveMinimum', 'min'],
    ['minLength', 'min'],
    ['minItems', 'min'],
  ] as const) {
    if (typeof b[key] === 'number' && (typeof a[key] !== 'number' || (b[key] as number) > (a[key] as number)))
      push(dir === 'request' ? 'breaking' : 'warning', `schema.${kind}-raised`, `${key} ${a[key] ?? '—'} → ${b[key]}`);
    if (typeof a[key] === 'number' && typeof b[key] === 'number' && (b[key] as number) < (a[key] as number))
      push(dir === 'request' ? 'warning' : 'breaking', `schema.${kind}-lowered`, `${key} ${a[key]} → ${b[key]}`);
  }
  for (const key of ['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems'] as const) {
    if (typeof b[key] === 'number' && (typeof a[key] !== 'number' || (b[key] as number) < (a[key] as number)))
      push(dir === 'request' ? 'breaking' : 'warning', 'schema.max-lowered', `${key} ${a[key] ?? '—'} → ${b[key]}`);
    if (typeof a[key] === 'number' && typeof b[key] === 'number' && (b[key] as number) > (a[key] as number))
      push(dir === 'request' ? 'warning' : 'breaking', 'schema.max-raised', `${key} ${a[key]} → ${b[key]}`);
  }

  const [pa, pb] = [(a.properties ?? {}) as Record<string, Schema>, (b.properties ?? {}) as Record<string, Schema>];
  const [ra, rb] = [new Set(a.required as string[] ?? []), new Set(b.required as string[] ?? [])];
  for (const name of Object.keys(pa)) {
    if (!(name in pb)) push(dir === 'response' ? 'breaking' : 'warning', 'schema.property-removed', `property "${name}" was removed`);
    else diffSchema(oldDoc, newDoc, pa[name]!, pb[name]!, `${at}.${name}`, dir, out);
  }
  for (const name of Object.keys(pb)) {
    if (!(name in pa)) {
      if (dir === 'request' && rb.has(name)) push('breaking', 'schema.required-added', `new required property "${name}"`);
      else push('addition', 'schema.property-added', `new property "${name}"${rb.has(name) ? ' (required)' : ''}`);
    }
  }
  for (const name of ra) if (!rb.has(name) && name in pa) push(dir === 'request' ? 'warning' : 'warning', 'schema.required-removed', `"${name}" no longer required`);
  for (const name of rb) if (!ra.has(name) && name in pa) push('breaking', 'schema.required-added', `property "${name}" is now required`);

  if (a.items || b.items) diffSchema(oldDoc, newDoc, (a.items as Schema) ?? {}, (b.items as Schema) ?? {}, `${at}[]`, dir, out);
}

const paramsOf = (item: Record<string, unknown>, op: Operation): Parameter[] =>
  [...((item.parameters as Parameter[]) ?? []), ...((op.parameters as Parameter[]) ?? [])];

const jsonSchema = (container: { content?: Record<string, { schema?: Schema }> } | undefined): Schema | undefined => {
  const c = container?.content;
  if (!c) return undefined;
  const key = Object.keys(c).find((k) => /json/i.test(k)) ?? Object.keys(c)[0];
  return key ? c[key]?.schema : undefined;
};

function diffOperation(oldDoc: OpenAPIDoc, newDoc: OpenAPIDoc, template: string, item: Record<string, unknown>, method: string, at: string, out: Change[]) {
  const a = (item[method] ?? {}) as Operation;
  const b = ((newDoc.paths?.[template] as Record<string, unknown> | undefined)?.[method] ?? {}) as Operation;
  const push = (level: ChangeLevel, rule: string, message: string) => out.push({ level, rule, at, message });

  // Parameters: a newly required one breaks callers; a removed or retyped one changes the contract.
  const pa = new Map(paramsOf(item, a).map((p) => [`${p.in}:${p.name}`, p]));
  const pb = new Map(paramsOf((newDoc.paths?.[template] as Record<string, unknown>) ?? {}, b).map((p) => [`${p.in}:${p.name}`, p]));
  for (const [key, p] of pa) {
    if (!pb.has(key)) push('warning', 'param.removed', `${p.in} parameter "${p.name}" was removed`);
    else {
      const q = pb.get(key)!;
      if (!p.required && q.required) push('breaking', 'param.required-added', `${p.in} parameter "${p.name}" is now required`);
      diffSchema(oldDoc, newDoc, p.schema ?? {}, q.schema ?? {}, `${at}.${p.in}.${p.name}`, 'request', out);
    }
  }
  for (const [key, p] of pb) if (!pa.has(key)) push(p.required ? 'breaking' : 'addition', 'param.added', `new ${p.required ? 'required ' : ''}${p.in} parameter "${p.name}"`);

  // Request body: became required, or schema tightened.
  const rbA = a.requestBody as { required?: boolean; content?: Record<string, { schema?: Schema }> } | undefined;
  const rbB = b.requestBody as { required?: boolean; content?: Record<string, { schema?: Schema }> } | undefined;
  if (rbA && !rbB) push('warning', 'requestBody.removed', 'request body was removed');
  if (!rbA && rbB) push(rbB.required ? 'breaking' : 'addition', 'requestBody.added', `new ${rbB.required ? 'required ' : ''}request body`);
  if (rbA && rbB) {
    if (!rbA.required && rbB.required) push('breaking', 'requestBody.required', 'request body is now required');
    const [sa, sb] = [jsonSchema(rbA), jsonSchema(rbB)];
    if (sa || sb) diffSchema(oldDoc, newDoc, sa ?? {}, sb ?? {}, `${at}.body`, 'request', out);
  }

  // Responses: a removed status breaks clients waiting for it; response schema loosening breaks consumers.
  const respA = (a.responses ?? {}) as Record<string, { content?: Record<string, { schema?: Schema }> }>;
  const respB = (b.responses ?? {}) as Record<string, { content?: Record<string, { schema?: Schema }> }>;
  for (const code of Object.keys(respA)) {
    if (!(code in respB)) push('breaking', 'response.removed', `response ${code} was removed`);
    else {
      const [sa, sb] = [jsonSchema(respA[code]), jsonSchema(respB[code])];
      if (sa || sb) diffSchema(oldDoc, newDoc, sa ?? {}, sb ?? {}, `${at}.${code}`, 'response', out);
    }
  }
  for (const code of Object.keys(respB)) if (!(code in respA)) push('addition', 'response.added', `new response ${code}`);

  // Security: adding a requirement breaks anonymous callers.
  const secA = JSON.stringify(a.security ?? (oldDoc as { security?: unknown }).security ?? []);
  const secB = JSON.stringify(b.security ?? (newDoc as { security?: unknown }).security ?? []);
  if (secA !== secB) push('warning', 'security.changed', 'security requirement changed');
}

/** Diffs two OpenAPI documents and classifies every change as breaking / warning / addition. */
export function diffSpecs(oldDoc: OpenAPIDoc, newDoc: OpenAPIDoc): DiffReport {
  const changes: Change[] = [];
  const oldPaths = oldDoc.paths ?? {};
  const newPaths = newDoc.paths ?? {};

  for (const [template, item] of Object.entries(oldPaths)) {
    const newItem = newPaths[template];
    if (!newItem) {
      for (const m of METHODS) if (item[m]) changes.push({ level: 'breaking', rule: 'operation.removed', at: `${m.toUpperCase()} ${template}`, message: 'operation was removed' });
      if (!METHODS.some((m) => item[m])) changes.push({ level: 'warning', rule: 'path.removed', at: template, message: 'path was removed' });
      continue;
    }
    for (const m of METHODS) {
      const at = `${m.toUpperCase()} ${template}`;
      if (item[m] && !newItem[m]) changes.push({ level: 'breaking', rule: 'operation.removed', at, message: 'operation was removed' });
      else if (!item[m] && newItem[m]) changes.push({ level: 'addition', rule: 'operation.added', at, message: 'new operation' });
      else if (item[m] && newItem[m]) diffOperation(oldDoc, newDoc, template, item, m, at, changes);
    }
  }
  for (const [template, item] of Object.entries(newPaths)) {
    if (oldPaths[template]) continue;
    for (const m of METHODS) if (item[m]) changes.push({ level: 'addition', rule: 'operation.added', at: `${m.toUpperCase()} ${template}`, message: 'new operation' });
  }

  return {
    oldInfo: oldDoc.info as { title?: string; version?: string },
    newInfo: newDoc.info as { title?: string; version?: string },
    changes,
    breaking: changes.filter((c) => c.level === 'breaking'),
    warnings: changes.filter((c) => c.level === 'warning'),
    additions: changes.filter((c) => c.level === 'addition'),
    ok: !changes.some((c) => c.level === 'breaking'),
  };
}
