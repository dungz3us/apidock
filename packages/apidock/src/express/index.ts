import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import type { Api } from '../sdk/contract.js';
import type { Reporter } from '../sdk/report.js';
import type { RequestInput, RouteDef, RouteResponse, RoutesDef } from '../sdk/types.js';
import { parseRequest, parseResponse, type ValidationIssue } from '../sdk/validate.js';
import { createServer, type ServerOptions } from '../server/index.js';
import type { SpecInput } from '../server/spec-source.js';
import { FileStorage } from '../storage/index.js';

export type HandlerContext<R extends RouteDef> = RequestInput<R> & { req: Request; res: Response };

export type Handlers<R extends RoutesDef> = {
  [K in keyof R]: (ctx: HandlerContext<R[K]>) => RouteResponse<R[K]> | Promise<RouteResponse<R[K]>>;
};

export interface RouterOptions {
  /**
   * Check handler results against the declared response schemas.
   * `warn` logs mismatches, `strict` replaces them with a 500. Default `off`.
   */
  validateResponses?: 'off' | 'warn' | 'strict';
  onInvalidRequest?: (issues: ValidationIssue[], req: Request, res: Response) => void;
  /** Receives every request/response contract violation (e.g. StorageReporter or HttpReporter). */
  report?: Reporter;
}

const defaultInvalid = (issues: ValidationIssue[], _req: Request, res: Response) => {
  res.status(400).json({ error: 'ValidationError', issues });
};

const rawInput = (req: Request) => ({ params: req.params, query: req.query, headers: req.headers, body: req.body });

/** Build an Express router that serves every route of the contract with request validation. */
export function createRouter<R extends RoutesDef>(api: Api<R>, handlers: Handlers<R>, options: RouterOptions = {}): Router {
  const router = express.Router();
  const mode = options.validateResponses ?? 'off';
  const onInvalid = options.onInvalidRequest ?? defaultInvalid;

  for (const [id, route] of Object.entries(api.routes)) {
    const handler = handlers[id as keyof R];
    if (typeof handler !== 'function') throw new Error(`apidock: missing handler for route "${id}"`);
    const method = route.method.toLowerCase() as 'get';
    const bodyParser: RequestHandler[] = route.body && !route.bodyContentType ? [express.json()] : [];

    router[method](route.path, ...bodyParser, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = parseRequest(route, rawInput(req));
        if (!parsed.success) {
          options.report?.report({
            kind: 'request-schema',
            operationId: id,
            method: route.method,
            path: route.path,
            issues: parsed.issues,
          });
          return onInvalid(parsed.issues, req, res);
        }

        const result = (await handler({ ...parsed.data, req, res } as never)) as { status: number; body?: unknown; headers?: Record<string, string> };
        if (res.headersSent) return;

        const check = mode !== 'off' || options.report ? parseResponse(route, result.status, result.body) : { success: true as const };
        if (!check.success) {
          const declared = !!route.responses[result.status];
          options.report?.report({
            kind: declared ? 'response-schema' : 'undeclared-status',
            operationId: id,
            method: route.method,
            path: route.path,
            status: result.status,
            issues: check.issues,
          });
          if (mode === 'warn') console.warn(`apidock: response of ${route.method} ${route.path} (${result.status}) violates its contract`, check.issues);
          if (mode === 'strict') return res.status(500).json({ error: 'ContractViolation', issues: check.issues });
        }

        if (result.headers) res.set(result.headers);
        res.status(result.status);
        if (result.body === undefined) res.end();
        else if (typeof result.body === 'string' && !res.get('content-type')) res.type('text/plain').send(result.body);
        else res.json(result.body);
      } catch (err) {
        next(err);
      }
    });
  }
  return router;
}

/**
 * Validation middleware for routes you already have: documents nothing by itself, but rejects invalid
 * requests and exposes the parsed input as `res.locals.input`.
 */
export function validate<R extends RouteDef>(route: R, options: Pick<RouterOptions, 'onInvalidRequest'> = {}): RequestHandler {
  const onInvalid = options.onInvalidRequest ?? defaultInvalid;
  return (req, res, next) => {
    const parsed = parseRequest(route, rawInput(req));
    if (!parsed.success) return onInvalid(parsed.issues, req, res);
    res.locals.input = parsed.data;
    next();
  };
}

/** `app.get('/openapi.json', serveSpec(api))` */
export function serveSpec(api: Api): RequestHandler {
  return (_req, res) => {
    res.json(api.toOpenAPI());
  };
}

export type AuthOption = { username: string; password: string } | RequestHandler;

export interface ApidockOptions extends Omit<ServerOptions, 'spec' | 'mode'> {
  /** Contract defined with `defineApi` (code-first). */
  api?: Api;
  /** Or any OpenAPI source: document, function, URL or file path. */
  spec?: SpecInput;
  /** Defaults to `process.env.NODE_ENV !== 'production'`. */
  enabled?: boolean;
  auth?: AuthOption;
  /** Directory for FileStorage when `storage` is not given. Default `<cwd>/.apidock`. */
  dataDir?: string;
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function basicAuth(username: string, password: string, realm = 'ApiDock'): RequestHandler {
  return (req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() === 'basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep !== -1) {
        const userOk = safeEqual(decoded.slice(0, sep), username);
        const passOk = safeEqual(decoded.slice(sep + 1), password);
        if (userOk && passOk) return next();
      }
    }
    res.setHeader('www-authenticate', `Basic realm="${realm}", charset="UTF-8"`);
    res.status(401).send('Authentication required');
  };
}

/** Address the request arrived on, so the proxy can call this very server without trusting the Host header. */
export function selfTarget(req: Request): string {
  const raw = req.socket.localAddress ?? '127.0.0.1';
  const addr = raw.replace(/^::ffff:/, '');
  const host = addr.includes(':') ? `[${addr}]` : addr;
  const tls = (req.socket as { encrypted?: boolean }).encrypted;
  return `${tls ? 'https' : 'http'}://${host}:${req.socket.localPort}`;
}

/** Mount the ApiDock devtools: `app.use('/apidock', apidock({ api }))`. */
export function apidock(options: ApidockOptions): Router {
  const enabled = options.enabled ?? process.env.NODE_ENV !== 'production';
  const router = express.Router();
  if (!enabled) return router;

  const source = options.api ? () => options.api!.toOpenAPI() : options.spec;
  if (!source) throw new Error('apidock: pass either `api` or `spec`');

  if (options.auth) router.use(typeof options.auth === 'function' ? options.auth : basicAuth(options.auth.username, options.auth.password));

  router.use(
    createServer({
      ...options,
      spec: source,
      mode: 'embedded',
      storage: options.storage ?? new FileStorage(options.dataDir ?? join(process.cwd(), '.apidock')),
      target: options.target ?? selfTarget,
    }),
  );
  return router;
}
