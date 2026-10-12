import { JSONPath } from 'jsonpath-plus';
import { interpolate } from './vars.js';
import { parseBody, validateResponseBody } from './jsschema.js';
import type { OpenAPIDoc } from './mock.js';
import { matchOperation } from './mock.js';
import { ProxyError, sendProxied, type ProxyResponse } from './proxy.js';

export interface ScenarioStep {
  /** Step name; also the namespace for extracting vars (step output). */
  id: string;
  request: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  };
  /** `extract: { varName: '$.body.id' }` pulls values out for later `{{varName}}` use. */
  extract?: Record<string, string>;
  expect?: {
    status?: number;
    maxMs?: number;
    /** `body: { '$.items[0].id': 'u_1' }` asserts JSONPath lookups equal expected values. */
    body?: Record<string, unknown>;
    /** Validate the body against the declared response schema of the matched operation. */
    matchSpec?: boolean;
  };
}

export interface Scenario {
  name: string;
  baseUrl?: string;
  /** Shared variables available as `{{name}}` in every step. */
  vars?: Record<string, string>;
  steps: ScenarioStep[];
}

export interface StepResult {
  id: string;
  ok: boolean;
  status?: number;
  durationMs?: number;
  extracted?: Record<string, unknown>;
  issues: { path: string; message: string }[];
  error?: string;
}

export interface ScenarioReport {
  name: string;
  at: string;
  ok: boolean;
  durationMs: number;
  steps: StepResult[];
}

const render = (text: string, vars: Record<string, unknown>) =>
  interpolate(text, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])));

export async function runScenario(scenario: Scenario, baseUrl: string, doc?: OpenAPIDoc): Promise<ScenarioReport> {
  const vars: Record<string, unknown> = { ...(scenario.vars ?? {}) };
  const base = (scenario.baseUrl ?? baseUrl).replace(/\/+$/, '');
  const steps: StepResult[] = [];
  const started = performance.now();

  for (const step of scenario.steps) {
    const result: StepResult = { id: step.id, ok: false, issues: [] };
    steps.push(result);

    const req = {
      method: step.request.method.toUpperCase(),
      url: render(step.request.url, vars),
      headers: Object.fromEntries(Object.entries(step.request.headers ?? {}).map(([k, v]) => [k, render(v, vars)])),
      body: step.request.body ? render(step.request.body, vars) : undefined,
    };
    const url = /^https?:\/\//i.test(req.url) ? req.url : `${base}${req.url.startsWith('/') ? '' : '/'}${req.url}`;

    let res: ProxyResponse;
    try {
      res = await sendProxied({ ...req, url }, { allowed: [base], options: { timeoutMs: 15_000 } });
      result.status = res.status;
      result.durationMs = res.durationMs;
    } catch (err) {
      result.error = err instanceof ProxyError ? err.message : String(err);
      continue;
    }

    const json = parseBody(res.body, res.headers['content-type']);
    const expect = step.expect ?? {};
    if (expect.status !== undefined && res.status !== expect.status)
      result.issues.push({ path: 'status', message: `expected ${expect.status}, got ${res.status}` });
    if (expect.maxMs !== undefined && res.durationMs > expect.maxMs)
      result.issues.push({ path: 'durationMs', message: `took ${res.durationMs}ms > ${expect.maxMs}ms` });
    for (const [pointer, rawExpected] of Object.entries(expect.body ?? {})) {
      const expected = typeof rawExpected === 'string' ? render(rawExpected, vars) : rawExpected;
      const found = JSONPath({ path: pointer, json, wrap: false });
      if (JSON.stringify(found) !== JSON.stringify(expected))
        result.issues.push({ path: pointer, message: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(found)}` });
    }
    if (expect.matchSpec && doc) {
      const serverUrl = (doc.servers as { url?: string }[] | undefined)?.[0]?.url;
      const serverPrefix = serverUrl?.startsWith('/') ? serverUrl.replace(/\/+$/, '') : '';
      const urlPath = url.replace(base, '').split('?')[0]!;
      const specPath = serverPrefix && urlPath.startsWith(serverPrefix) ? urlPath.slice(serverPrefix.length) || '/' : urlPath;
      const matched = matchOperation(doc, req.method, specPath);
      if (!matched) result.issues.push({ path: '', message: 'no matching operation in spec' });
      else {
        const report = validateResponseBody(doc, matched.pathTemplate, req.method, res.status, json);
        if (!report.declared) result.issues.push({ path: '', message: `status ${res.status} not declared` });
        result.issues.push(...report.issues.map((i) => ({ path: `body.${i.path}`, message: i.message })));
      }
    }

    const extracted: Record<string, unknown> = {};
    for (const [key, pointer] of Object.entries(step.extract ?? {})) {
      const found = JSONPath({ path: pointer, json, wrap: false });
      if (found === undefined) result.issues.push({ path: pointer, message: `extract ${key}: no value at ${pointer}` });
      else extracted[key] = vars[key] = found;
    }
    result.extracted = Object.keys(extracted).length ? extracted : undefined;
    result.ok = !result.error && result.issues.length === 0;
    if (!result.ok) break; // a failed step usually voids the rest of the scenario
  }

  return {
    name: scenario.name,
    at: new Date().toISOString(),
    ok: steps.every((s) => s.ok),
    durationMs: Math.round((performance.now() - started) * 10) / 10,
    steps,
  };
}
