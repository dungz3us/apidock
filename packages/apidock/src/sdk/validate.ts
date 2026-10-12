import type { z } from 'zod';
import { normalizeResponse } from './openapi.js';
import type { RequestInput, RouteDef } from './types.js';

export type IssueLocation = 'params' | 'query' | 'headers' | 'body' | 'response';

export interface ValidationIssue {
  location: IssueLocation;
  path: string;
  message: string;
  code?: string;
}

export type ValidationResult<T> = { success: true; data: T } | { success: false; issues: ValidationIssue[] };

export interface RawRequest {
  params: unknown;
  query: unknown;
  headers: unknown;
  body: unknown;
}

function toIssues(location: IssueLocation, error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({
    location,
    path: i.path.map(String).join('.'),
    message: i.message,
    code: i.code,
  }));
}

export function parseRequest<R extends RouteDef>(route: R, raw: RawRequest): ValidationResult<RequestInput<R>> {
  const issues: ValidationIssue[] = [];
  const data = { ...raw } as Record<keyof RawRequest, unknown>;
  for (const location of ['params', 'query', 'headers', 'body'] as const) {
    const schema = route[location];
    if (!schema) continue;
    const parsed = schema.safeParse(raw[location]);
    if (parsed.success) data[location] = parsed.data;
    else issues.push(...toIssues(location, parsed.error));
  }
  return issues.length ? { success: false, issues } : { success: true, data: data as unknown as RequestInput<R> };
}

export function parseResponse(route: RouteDef, status: number, body: unknown): ValidationResult<unknown> {
  const def = route.responses[status];
  if (!def) {
    return {
      success: false,
      issues: [{ location: 'response', path: '', message: `Status ${status} is not declared for ${route.method} ${route.path}` }],
    };
  }
  const { schema } = normalizeResponse(def);
  if (!schema) return { success: true, data: body };
  const parsed = schema.safeParse(body);
  return parsed.success ? { success: true, data: parsed.data } : { success: false, issues: toIssues('response', parsed.error) };
}
