import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import type { OpenAPIDocument } from '../sdk/types.js';

/** An OpenAPI document, a function producing one, or a URL / file path (JSON or YAML). */
export type SpecInput = OpenAPIDocument | (() => OpenAPIDocument | Promise<OpenAPIDocument>) | string;

export interface SpecSource {
  get(): Promise<OpenAPIDocument>;
  reload(): Promise<OpenAPIDocument>;
  /** Last load error, if the most recent refresh failed (the previous document keeps being served). */
  readonly lastError: string | undefined;
  readonly loadedAt: number | undefined;
}

export interface SpecSourceOptions {
  /** Re-fetch URL/file specs when older than this (ms). Default 10s; 0 disables auto refresh. */
  refreshMs?: number;
  fetchTimeoutMs?: number;
}

function assertOpenApi(doc: unknown, origin: string): OpenAPIDocument {
  const d = doc as Partial<OpenAPIDocument> & { swagger?: string };
  if (d && typeof d === 'object' && typeof d.openapi === 'string' && d.openapi.startsWith('3.')) return d as OpenAPIDocument;
  if (d?.swagger) throw new Error(`${origin}: Swagger 2.0 is not supported, convert it to OpenAPI 3.x first`);
  throw new Error(`${origin}: not an OpenAPI 3.x document`);
}

async function loadFromString(input: string, timeoutMs: number): Promise<OpenAPIDocument> {
  let text: string;
  if (/^https?:\/\//i.test(input)) {
    const res = await fetch(input, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json, application/yaml, */*' } });
    if (!res.ok) throw new Error(`${input}: HTTP ${res.status}`);
    text = await res.text();
  } else {
    text = await readFile(input, 'utf8');
  }
  return assertOpenApi(parseYaml(text), input);
}

export function isSpecSource(value: unknown): value is SpecSource {
  return !!value && typeof value === 'object' && typeof (value as SpecSource).get === 'function' && typeof (value as SpecSource).reload === 'function';
}

export function createSpecSource(input: SpecInput, options: SpecSourceOptions = {}): SpecSource {
  const refreshMs = options.refreshMs ?? 10_000;
  const timeoutMs = options.fetchTimeoutMs ?? 5_000;
  const remote = typeof input === 'string';
  let doc: OpenAPIDocument | undefined;
  let loadedAt: number | undefined;
  let lastError: string | undefined;
  let inflight: Promise<OpenAPIDocument> | undefined;

  const load = async (): Promise<OpenAPIDocument> => {
    if (typeof input === 'string') return loadFromString(input, timeoutMs);
    if (typeof input === 'function') return assertOpenApi(await input(), 'spec()');
    return assertOpenApi(input, 'spec');
  };

  const reload = (): Promise<OpenAPIDocument> =>
    (inflight ??= load()
      .then((next) => {
        doc = next;
        loadedAt = Date.now();
        lastError = undefined;
        return next;
      })
      .catch((err: Error) => {
        lastError = err.message;
        if (doc) return doc;
        throw err;
      })
      .finally(() => {
        inflight = undefined;
      }));

  return {
    get lastError() {
      return lastError;
    },
    get loadedAt() {
      return loadedAt;
    },
    async get() {
      // Functions are re-evaluated on every call (cheap & always fresh); remote specs are cached.
      if (!doc || typeof input === 'function') return reload();
      if (remote && refreshMs > 0 && Date.now() - loadedAt! > refreshMs) return reload();
      return doc;
    },
    reload,
  };
}
