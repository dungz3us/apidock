import { STATUS_CODES } from 'node:http';
import { OpenAPIRegistry, OpenApiGeneratorV31, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import type { Api } from './contract.js';
import { pathParamNames, toOpenApiPath } from './paths.js';
import type { OpenAPIDocument, ResponseConfig, ResponseDef, RouteDef } from './types.js';

export function normalizeResponse(def: ResponseDef): ResponseConfig {
  return def instanceof z.ZodType ? { schema: def } : def;
}

function paramsSchema(route: RouteDef) {
  if (route.params) return route.params;
  const names = pathParamNames(route.path);
  return names.length ? z.object(Object.fromEntries(names.map((n) => [n, z.string()]))) : undefined;
}

function toRouteConfig(id: string, route: RouteDef, defaultSecurity: RouteDef['security']): RouteConfig {
  const request: RouteConfig['request'] = {};
  const params = paramsSchema(route);
  if (params) request.params = params;
  if (route.query) request.query = route.query;
  if (route.headers) request.headers = route.headers;
  if (route.body) {
    request.body = {
      required: !route.body.safeParse(undefined).success,
      content: { [route.bodyContentType ?? 'application/json']: { schema: route.body } },
    };
  }

  const responses: RouteConfig['responses'] = {};
  for (const [status, def] of Object.entries(route.responses)) {
    const res = normalizeResponse(def);
    responses[status] = {
      description: res.description ?? STATUS_CODES[Number(status)] ?? 'Response',
      ...(res.headers ? { headers: res.headers } : {}),
      ...(res.schema ? { content: { [res.contentType ?? 'application/json']: { schema: res.schema } } } : {}),
    };
  }

  const security = route.security ?? defaultSecurity;
  return {
    method: route.method.toLowerCase() as RouteConfig['method'],
    path: toOpenApiPath(route.path),
    operationId: route.operationId ?? id,
    ...(route.summary ? { summary: route.summary } : {}),
    ...(route.description ? { description: route.description } : {}),
    ...(route.tags ? { tags: [...route.tags] } : {}),
    ...(route.deprecated ? { deprecated: true } : {}),
    ...(security ? { security: security.map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, [...v]]))) } : {}),
    request,
    responses,
  };
}

export function toOpenAPI(api: Api): OpenAPIDocument {
  const { def } = api;
  const registry = new OpenAPIRegistry();
  for (const [name, scheme] of Object.entries(def.securitySchemes ?? {})) {
    registry.registerComponent('securitySchemes', name, scheme as never);
  }
  for (const [id, route] of Object.entries(def.routes)) registry.registerPath(toRouteConfig(id, route, def.security));

  const doc = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { ...def.info },
    ...(def.servers ? { servers: def.servers.map((s) => ({ ...s })) } : {}),
    ...(def.tags ? { tags: def.tags.map((t) => ({ ...t })) } : {}),
  });
  return doc as unknown as OpenAPIDocument;
}
