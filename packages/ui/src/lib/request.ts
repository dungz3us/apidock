import type { ProxyRequest } from './api';
import { jsonBodyOf, sampleFromSchema, serverBase, type OpenAPIDoc, type Operation } from './spec';

export interface HeaderRow {
  key: string;
  value: string;
  enabled: boolean;
}

export interface Draft {
  path: Record<string, string>;
  query: Record<string, string>;
  headers: HeaderRow[];
  body: string;
}

const asText = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

/** `{{name}}` placeholders resolve against the active environment's variables. */
export const interpolate = (text: string, vars: Record<string, string>): string =>
  text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, key) => (key in vars ? vars[key]! : m));

const applyVars = (draft: Draft, vars: Record<string, string>): Draft =>
  Object.keys(vars).length === 0
    ? draft
    : {
        path: Object.fromEntries(Object.entries(draft.path).map(([k, v]) => [k, interpolate(v, vars)])),
        query: Object.fromEntries(Object.entries(draft.query).map(([k, v]) => [k, interpolate(v, vars)])),
        headers: draft.headers.map((h) => ({ ...h, key: interpolate(h.key, vars), value: interpolate(h.value, vars) })),
        body: interpolate(draft.body, vars),
      };

export function initialDraft(doc: OpenAPIDoc, op: Operation): Draft {
  const path: Record<string, string> = {};
  const query: Record<string, string> = {};
  const headers: HeaderRow[] = [];
  for (const p of op.parameters) {
    const sample = p.example ?? sampleFromSchema(doc, p.schema);
    if (p.in === 'path') path[p.name] = asText(p.schema?.example ?? p.example ?? '');
    else if (p.in === 'query') query[p.name] = p.required ? asText(sample) : '';
    else if (p.in === 'header') headers.push({ key: p.name, value: p.required ? asText(sample) : '', enabled: !!p.required });
  }
  const body = jsonBodyOf(op.op);
  let text = '';
  if (body) {
    headers.unshift({ key: 'content-type', value: body.contentType, enabled: true });
    const example = body.media.example ?? Object.values(body.media.examples ?? {})[0]?.value ?? sampleFromSchema(doc, body.media.schema);
    text = example === undefined ? '' : typeof example === 'string' ? example : JSON.stringify(example, null, 2);
  }
  return { path, query, headers, body: text };
}

export function missingRequired(op: Operation, draft: Draft): string[] {
  return op.parameters
    .filter((p) => p.required)
    .filter((p) => {
      if (p.in === 'path') return !draft.path[p.name];
      if (p.in === 'query') return !draft.query[p.name];
      if (p.in === 'header') return !draft.headers.some((h) => h.enabled && h.key.toLowerCase() === p.name.toLowerCase() && h.value);
      return false;
    })
    .map((p) => p.name);
}

export function requestPath(doc: OpenAPIDoc, op: Operation, draft: Draft, serverIndex = 0): string {
  const path = op.path.replace(/\{([^}]+)\}/g, (_, name: string) => (draft.path[name] ? encodeURIComponent(draft.path[name]) : `{${name}}`));
  const qs = new URLSearchParams(Object.entries(draft.query).filter(([, v]) => v !== '')).toString();
  return `${serverBase(doc, serverIndex)}${path}${qs ? `?${qs}` : ''}`;
}

export interface BuildOptions {
  serverIndex?: number;
  vars?: Record<string, string>;
  /** Absolute base URL replacing the spec server (e.g. an environment's baseUrl). */
  baseUrl?: string;
}

export function buildRequest(doc: OpenAPIDoc, op: Operation, draft: Draft, opts: BuildOptions = {}): ProxyRequest {
  const d = opts.vars ? applyVars(draft, opts.vars) : draft;
  const headers: Record<string, string> = {};
  for (const h of d.headers) if (h.enabled && h.key.trim()) headers[h.key.trim().toLowerCase()] = h.value;
  const sendsBody = !['GET', 'HEAD'].includes(op.method) && d.body.trim() !== '';
  if (!sendsBody) delete headers['content-type'];
  const url = requestPath(doc, op, d, opts.serverIndex ?? 0);
  return {
    method: op.method,
    url: opts.baseUrl ? `${opts.baseUrl.replace(/\/+$/, '')}${url.startsWith('/') ? url : `/${url}`}` : url,
    headers,
    ...(sendsBody ? { body: d.body } : {}),
    operationId: op.id,
  };
}

/** Path + query without the spec server prefix — what the mock engine matches. */
export function mockPath(op: Operation, draft: Draft, vars?: Record<string, string>): string {
  const d = vars ? applyVars(draft, vars) : draft;
  const path = op.path.replace(/\{([^}]+)\}/g, (_, name: string) => (d.path[name] ? encodeURIComponent(d.path[name]) : `{${name}}`));
  const qs = new URLSearchParams(Object.entries(d.query).filter(([, v]) => v !== '')).toString();
  return `${path}${qs ? `?${qs}` : ''}`;
}

/** Body is JSON-ish but doesn't parse: worth flagging before the server does. */
export function bodyError(draft: Draft): string | undefined {
  const type = draft.headers.find((h) => h.enabled && h.key.toLowerCase() === 'content-type')?.value ?? '';
  if (!/json/i.test(type) || !draft.body.trim()) return undefined;
  try {
    JSON.parse(draft.body);
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function toCurl(req: ProxyRequest, base: string): string {
  const url = new URL(req.url, base).toString();
  const parts = [`curl -X ${req.method} ${shellQuote(url)}`];
  for (const [k, v] of Object.entries(req.headers ?? {})) parts.push(`  -H ${shellQuote(`${k}: ${v}`)}`);
  if (req.body) parts.push(`  --data-raw ${shellQuote(req.body)}`);
  return parts.join(' \\\n');
}
