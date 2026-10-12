import type { OpenAPIDoc } from './spec';

export interface Config {
  version: string;
  mode: 'embedded' | 'standalone';
  title: string;
  target: string | null;
  /** Mount-relative mock base, e.g. '../mock'. */
  mock: string;
  specError: string | null;
  specLoadedAt: number | null;
}

export interface EnvVar {
  key: string;
  value: string;
  secret?: boolean;
}

export interface Environment {
  id: string;
  name: string;
  baseUrl: string;
  variables: EnvVar[];
}

export interface SavedRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  createdAt: string;
}

export interface Collection {
  id: string;
  name: string;
  requests: SavedRequest[];
}

export interface ProxyRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  operationId?: string;
}

export interface ProxyResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  encoding: 'utf8' | 'base64';
  size: number;
  durationMs: number;
  truncated: boolean;
}

export interface HistoryEntry {
  id: string;
  at: string;
  operationId?: string;
  request: ProxyRequest;
  response?: ProxyResponse;
  error?: string;
}

export interface Violation {
  id: string;
  at: string;
  kind: 'request-schema' | 'response-schema' | 'undeclared-status' | 'contract-run';
  operationId?: string;
  method: string;
  path: string;
  status?: number;
  issues: { location: string; path: string; message: string }[];
}

export interface ContractCaseResult {
  operationId?: string;
  method: string;
  path: string;
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

export interface ScenarioStep {
  id: string;
  request: { method: string; url: string; headers?: Record<string, string>; body?: string };
  extract?: Record<string, string>;
  expect?: { status?: number; maxMs?: number; body?: Record<string, unknown>; matchSpec?: boolean };
}

export interface Scenario {
  id?: string;
  name: string;
  baseUrl?: string;
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

export interface DraftParam {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  type?: 'string' | 'number' | 'integer' | 'boolean';
}

export interface DesignDraft {
  id: string;
  name: string;
  method: string;
  path: string;
  summary?: string;
  params?: DraftParam[];
  requestBody?: Record<string, unknown>;
  responseStatus?: number;
  responseBody?: Record<string, unknown>;
}

export interface SpecSnapshot {
  id: string;
  name: string;
  at: string;
}

export type ChangeLevel = 'breaking' | 'warning' | 'addition';

export interface Change {
  level: ChangeLevel;
  rule: string;
  at: string;
  message: string;
}

export interface DiffReport {
  changes: Change[];
  breaking: Change[];
  warnings: Change[];
  additions: Change[];
  ok: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Relative paths: the UI lives under the mount point (e.g. /apidock/), so `api/...` resolves beneath it.
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError('ApiDock server is unreachable. Is the backend running?', 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const client = {
  config: () => call<Config>('api/config'),
  spec: () => call<OpenAPIDoc>('api/spec'),
  reload: () => call<{ ok: boolean; error: string | null }>('api/spec/reload', { method: 'POST' }),
  proxy: (req: ProxyRequest) => call<ProxyResponse>('api/proxy', { method: 'POST', body: JSON.stringify(req) }),
  /** Sends through the spec-driven mock engine; same response shape as the proxy. */
  mock: (req: { method: string; url: string; body?: string; operationId?: string; code?: number; example?: string; delay?: number }) =>
    call<ProxyResponse>('api/mock', { method: 'POST', body: JSON.stringify(req) }),
  history: () => call<HistoryEntry[]>('api/history'),
  clearHistory: () => call<void>('api/history', { method: 'DELETE' }),
  deleteHistory: (id: string) => call<void>(`api/history/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  environments: () => call<Environment[]>('api/environments'),
  saveEnvironments: (envs: Environment[]) => call<Environment[]>('api/environments', { method: 'PUT', body: JSON.stringify(envs) }),
  collections: () => call<Collection[]>('api/collections'),
  saveCollections: (cols: Collection[]) => call<Collection[]>('api/collections', { method: 'PUT', body: JSON.stringify(cols) }),
  violations: () => call<Violation[]>('api/violations'),
  clearViolations: () => call<void>('api/violations', { method: 'DELETE' }),
  contractRun: (opts: { baseUrl?: string; operationId?: string } = {}) =>
    call<ContractRunReport>('api/contract-run', { method: 'POST', body: JSON.stringify(opts) }),
  scenarios: () => call<(Scenario & { id: string })[]>('api/scenarios'),
  saveScenarios: (scenarios: (Scenario & { id: string })[]) =>
    call<(Scenario & { id: string })[]>('api/scenarios', { method: 'PUT', body: JSON.stringify(scenarios) }),
  runScenario: (scenario: Scenario, baseUrl?: string) =>
    call<ScenarioReport>('api/scenario-run', { method: 'POST', body: JSON.stringify({ scenario, baseUrl }) }),
  drafts: () => call<DesignDraft[]>('api/drafts'),
  saveDrafts: (drafts: DesignDraft[]) => call<DesignDraft[]>('api/drafts', { method: 'PUT', body: JSON.stringify(drafts) }),
  codegen: (drafts?: DesignDraft[]) =>
    call<{ code: string }>('api/design/codegen', { method: 'POST', body: JSON.stringify(drafts ? { drafts } : {}) }),
  snapshots: () => call<SpecSnapshot[]>('api/snapshots'),
  createSnapshot: (name: string) => call<SpecSnapshot>('api/snapshots', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteSnapshot: (id: string) => call<void>(`api/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  diff: (opts: { snapshot?: string; spec?: OpenAPIDoc; specText?: string }) =>
    call<DiffReport>('api/diff', { method: 'POST', body: JSON.stringify(opts) }),
};
