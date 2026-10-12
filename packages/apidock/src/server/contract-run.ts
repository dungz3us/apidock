import type { OpenAPIDoc } from './mock.js';
import { mockFromSchema } from './mock.js';
import { parseBody, validateResponseBody, type SchemaIssue } from './jsschema.js';
import { ProxyError, sendProxied } from './proxy.js';

export interface ContractCaseResult {
  operationId?: string;
  method: string;
  path: string;
  /** Concrete request URL path that was sent. */
  url: string;
  status?: number;
  durationMs?: number;
  ok: boolean;
  issues: { location: string; path: string; message: string }[];
  error?: string;
}

export interface ContractRunReport {
  baseUrl: string;
  at: string;
  total: number;
  passed: number;
  failed: number;
  results: ContractCaseResult[];
}

interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  example?: unknown;
  examples?: Record<string, { value?: unknown }>;
  schema?: Record<string, unknown>;
}

function paramValue(doc: OpenAPIDoc, p: Parameter): string | undefined {
  const raw = p.example ?? Object.values(p.examples ?? {})[0]?.value ?? p.schema?.example ?? (p.schema ? mockFromSchema(doc, p.schema) : undefined);
  if (raw === undefined) return p.required ? 'apidock' : undefined;
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

export interface ContractRunOptions {
  baseUrl: string;
  /** Run only this operationId. */
  operationId?: string;
  timeoutMs?: number;
  /** Extra headers sent with every request (e.g. auth). */
  headers?: Record<string, string>;
}

/** Sends a generated request per operation and checks status + body against the spec. */
export async function runContractTest(doc: OpenAPIDoc, options: ContractRunOptions): Promise<ContractRunReport> {
  const base = options.baseUrl.replace(/\/+$/, '');
  // spec server "/api" (relative) prefixes every path; an absolute server URL is honored only when no baseUrl was given
  const server = (doc.servers as { url?: string }[] | undefined)?.[0]?.url ?? '';
  const prefix = server.startsWith('/') ? server.replace(/\/+$/, '') : '';
  const results: ContractCaseResult[] = [];

  for (const [template, item] of Object.entries(doc.paths ?? {})) {
    for (const method of ['get', 'put', 'post', 'delete', 'patch'] as const) {
      const op = (item as Record<string, unknown>)[method] as Record<string, unknown> | undefined;
      if (!op) continue;
      const operationId = op.operationId as string | undefined;
      if (options.operationId && operationId !== options.operationId) continue;

      const params = ((item as { parameters?: Parameter[] }).parameters ?? []).concat((op.parameters as Parameter[]) ?? []);
      const path = template.replace(/\{([^}]+)\}/g, (m, name: string) => {
        const p = params.find((x) => x.in === 'path' && x.name === name);
        const v = p ? paramValue(doc, p) : 'apidock';
        return encodeURIComponent(v ?? 'apidock');
      });
      const query = new URLSearchParams();
      const headers: Record<string, string> = { ...options.headers };
      for (const p of params.filter((x) => x.required || x.example !== undefined || x.schema?.example !== undefined)) {
        if (p.in === 'query') query.set(p.name, paramValue(doc, p)!);
        if (p.in === 'header') headers[p.name.toLowerCase()] = paramValue(doc, p)!;
      }

      const bodyMedia = (op.requestBody as { content?: Record<string, { schema?: Record<string, unknown>; example?: unknown; examples?: Record<string, { value?: unknown }> }> })?.content;
      let body: string | undefined;
      if (bodyMedia) {
        const jsonKey = Object.keys(bodyMedia).find((k) => /json/i.test(k)) ?? Object.keys(bodyMedia)[0];
        const media = jsonKey ? bodyMedia[jsonKey]! : undefined;
        if (media) {
          const sample = media.example ?? Object.values(media.examples ?? {})[0]?.value ?? (media.schema ? mockFromSchema(doc, media.schema) : undefined);
          if (sample !== undefined) {
            body = typeof sample === 'string' ? sample : JSON.stringify(sample);
            headers['content-type'] = jsonKey ?? 'application/json';
          }
        }
      }

      const url = `${base}${prefix}${path}${query.size ? `?${query}` : ''}`;
      const entry: ContractCaseResult = { operationId, method: method.toUpperCase(), path: template, url, ok: false, issues: [] };
      try {
        const res = await sendProxied(
          { method: method.toUpperCase(), url, headers, body },
          { allowed: [base], options: { timeoutMs: options.timeoutMs ?? 15_000 } },
        );
        entry.status = res.status;
        entry.durationMs = res.durationMs;
        const report = validateResponseBody(doc, template, method, res.status, parseBody(res.body, res.headers['content-type']));
        if (!report.declared) entry.issues.push(...report.issues.map((i: SchemaIssue) => ({ ...i, location: 'response' })));
        else entry.issues.push(...report.issues);
        entry.ok = report.declared && report.issues.length === 0;
      } catch (err) {
        entry.error = err instanceof ProxyError ? err.message : String(err);
      }
      results.push(entry);
    }
  }

  return {
    baseUrl: options.baseUrl,
    at: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
