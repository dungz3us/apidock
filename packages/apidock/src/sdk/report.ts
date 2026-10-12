import type { Storage } from '../storage/index.js';
import { newId } from '../storage/index.js';
import type { ValidationIssue } from './validate.js';

export type ViolationKind = 'request-schema' | 'response-schema' | 'undeclared-status' | 'contract-run';

export interface Violation {
  id: string;
  at: string;
  kind: ViolationKind;
  operationId?: string;
  method: string;
  /** Route template (`/users/{id}`) when known, else the concrete path. */
  path: string;
  status?: number;
  issues: ValidationIssue[];
}

export type ViolationInput = Omit<Violation, 'id' | 'at'>;

export interface Reporter {
  /** Non-blocking: violations must never delay the request path. */
  report(violation: ViolationInput): void;
  flush?(): Promise<void>;
}

/** Embedded mode: writes straight into the devtools' storage. */
export class StorageReporter implements Reporter {
  constructor(private storage: Storage) {}

  report(violation: ViolationInput): void {
    void this.storage
      .put('violations', { ...violation, id: newId(), at: new Date().toISOString() })
      .then(() => this.storage.trim('violations', 1000))
      .catch(() => undefined);
  }
}

export interface HttpReporterOptions {
  /** Base URL of an ApiDock server, e.g. `http://apidock:4000` — posts to `${baseUrl}/api/violations/batch`. */
  baseUrl: string;
  headers?: Record<string, string>;
  /** Fraction of violations to send (0–1). Default 1. */
  sampleRate?: number;
  /** Flush interval. Default 3000ms, unref'd so it never keeps a process alive. */
  intervalMs?: number;
  /** Max buffered violations; overflow drops oldest. Default 500. */
  maxBatch?: number;
}

/**
 * Standalone mode: buffers violations and POSTs them to the devtools server in batches.
 * Never throws, never blocks.
 */
export class HttpReporter implements Reporter {
  private buffer: Violation[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly url: string;
  private readonly sampleRate: number;
  private readonly maxBatch: number;

  constructor(private options: HttpReporterOptions) {
    this.url = `${options.baseUrl.replace(/\/+$/, '')}/api/violations/batch`;
    this.sampleRate = options.sampleRate ?? 1;
    this.maxBatch = options.maxBatch ?? 500;
  }

  report(violation: ViolationInput): void {
    if (Math.random() > this.sampleRate) return;
    this.buffer.push({ ...violation, id: newId(), at: new Date().toISOString() });
    if (this.buffer.length > this.maxBatch) this.buffer.splice(0, this.buffer.length - this.maxBatch);
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), this.options.intervalMs ?? 3000);
      this.timer.unref?.();
    }
  }

  async flush(): Promise<void> {
    const batch = this.buffer.splice(0, this.buffer.length);
    if (!batch.length) {
      clearInterval(this.timer);
      this.timer = undefined;
      return;
    }
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.options.headers },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) this.buffer.unshift(...batch.slice(0, this.maxBatch - this.buffer.length));
    } catch {
      this.buffer.unshift(...batch.slice(0, this.maxBatch - this.buffer.length));
    }
  }
}
