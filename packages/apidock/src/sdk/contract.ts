import { toOpenAPI } from './openapi.js';
import { pathParamNames, toOpenApiPath } from './paths.js';
import { HTTP_METHODS, type ApiDef, type OpenAPIDocument, type RoutesDef } from './types.js';

export interface Api<R extends RoutesDef = RoutesDef> {
  readonly def: ApiDef<R>;
  readonly routes: R;
  toOpenAPI(): OpenAPIDocument;
}

function assertValid(def: ApiDef): void {
  const seen = new Map<string, string>();
  for (const [id, route] of Object.entries(def.routes)) {
    const where = `apidock: route "${id}"`;
    if (!HTTP_METHODS.includes(route.method)) throw new Error(`${where} has unsupported method "${route.method}"`);
    if (!route.path.startsWith('/')) throw new Error(`${where} path must start with "/"`);
    if (/[*?(){}]/.test(route.path)) throw new Error(`${where} path may only use ":param" segments`);

    const key = `${route.method} ${toOpenApiPath(route.path).replace(/\{[^}]+\}/g, '{}')}`;
    const dup = seen.get(key);
    if (dup) throw new Error(`${where} duplicates "${dup}" (${key})`);
    seen.set(key, id);

    const declared = Object.keys(route.params?.shape ?? {});
    const inPath = pathParamNames(route.path);
    const missing = inPath.filter((p) => !declared.includes(p));
    const extra = declared.filter((p) => !inPath.includes(p));
    if (route.params && missing.length) throw new Error(`${where} params schema is missing: ${missing.join(', ')}`);
    if (extra.length) throw new Error(`${where} params schema declares keys not in path: ${extra.join(', ')}`);
    if (Object.keys(route.responses).length === 0) throw new Error(`${where} must declare at least one response`);
  }
}

export function defineApi<const R extends RoutesDef>(def: ApiDef<R>): Api<R> {
  assertValid(def);
  let cached: OpenAPIDocument | undefined;
  const api: Api<R> = {
    def,
    routes: def.routes,
    toOpenAPI: () => (cached ??= toOpenAPI(api)),
  };
  return api;
}
