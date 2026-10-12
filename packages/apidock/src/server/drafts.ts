import type { OpenAPIDoc } from './mock.js';
import { ProxyError } from './proxy.js';

export type Schema = Record<string, unknown>;

export interface DraftParam {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  type?: 'string' | 'number' | 'integer' | 'boolean';
}

/** A UI-designed endpoint that isn't in the code yet. */
export interface DesignDraft {
  id: string;
  name: string;
  method: string;
  /** `/pets/{id}` or `/pets/:id` — both are accepted, stored as-is. */
  path: string;
  summary?: string;
  params?: DraftParam[];
  requestBody?: Schema;
  responseStatus?: number;
  responseBody?: Schema;
}

const METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options']);

export function validateDrafts(body: unknown): DesignDraft[] {
  if (!Array.isArray(body)) throw new ProxyError('Body must be an array of drafts', 400);
  return body.map((raw, i) => {
    const d = raw as DesignDraft;
    if (!d || typeof d.id !== 'string' || typeof d.name !== 'string')
      throw new ProxyError(`Draft ${i}: "id" and "name" are required`, 400);
    if (typeof d.method !== 'string' || !METHODS.has(d.method.toLowerCase()))
      throw new ProxyError(`Draft ${i} "${d.name}": method must be one of ${[...METHODS].join(', ')}`, 400);
    if (typeof d.path !== 'string' || !d.path.startsWith('/')) throw new ProxyError(`Draft ${i} "${d.name}": path must start with /`, 400);
    if (d.params !== undefined && !Array.isArray(d.params)) throw new ProxyError(`Draft ${i}: "params" must be an array`, 400);
    for (const p of d.params ?? []) {
      if (!p || typeof p.name !== 'string' || !['path', 'query', 'header'].includes(p.in))
        throw new ProxyError(`Draft ${i}: each param needs "name" and in: path|query|header`, 400);
    }
    return {
      id: d.id,
      name: d.name,
      method: d.method.toUpperCase(),
      path: d.path,
      ...(d.summary ? { summary: d.summary } : {}),
      ...(d.params ? { params: d.params } : {}),
      ...(d.requestBody ? { requestBody: d.requestBody } : {}),
      ...(d.responseStatus ? { responseStatus: d.responseStatus } : {}),
      ...(d.responseBody ? { responseBody: d.responseBody } : {}),
    };
  });
}

const paramType = (t: DraftParam['type']): Schema => {
  switch (t) {
    case 'number': return { type: 'number' };
    case 'integer': return { type: 'integer' };
    case 'boolean': return { type: 'boolean' };
    default: return { type: 'string' };
  }
};

/** Turns one draft into an OpenAPI path item. `:id` params are normalized to `{id}`. */
export function draftToPathItem(draft: DesignDraft): { template: string; item: Record<string, unknown> } {
  const template = draft.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
  const parameters = (draft.params ?? []).map((p) => ({
    name: p.name,
    in: p.in,
    required: p.in === 'path' ? true : (p.required ?? false),
    schema: paramType(p.type),
  }));
  const status = String(draft.responseStatus ?? 200);
  const item = {
    [draft.method.toLowerCase()]: {
      operationId: draft.id,
      summary: draft.summary ?? draft.name,
      'x-apidock-draft': true,
      ...(parameters.length ? { parameters } : {}),
      ...(draft.requestBody ? { requestBody: { required: true, content: { 'application/json': { schema: draft.requestBody } } } } : {}),
      responses: {
        [status]: {
          description: 'Designed response',
          ...(draft.responseBody ? { content: { 'application/json': { schema: draft.responseBody } } } : {}),
        },
      },
    },
  };
  return { template, item };
}

/** A spec containing only the draft operations — used for codegen and mock merging. */
export function draftsToDoc(drafts: DesignDraft[], title = 'Design drafts'): OpenAPIDoc {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const d of drafts) {
    const { template, item } = draftToPathItem(d);
    paths[template] = { ...paths[template], ...item };
  }
  return { openapi: '3.1.0', info: { title, version: '0.0.0' }, paths };
}

/** Overlay draft paths onto a real doc so `/mock/*` can answer for unimplemented endpoints. */
export function mergeDrafts(doc: OpenAPIDoc, drafts: DesignDraft[]): OpenAPIDoc {
  if (!drafts.length) return doc;
  const draftDoc = draftsToDoc(drafts);
  return { ...doc, paths: { ...draftDoc.paths, ...doc.paths } }; // real spec wins on collisions
}
