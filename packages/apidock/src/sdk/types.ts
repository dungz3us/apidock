import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export type AnyZodObject = z.ZodObject<z.ZodRawShape>;

export interface ResponseConfig {
  schema?: z.ZodType;
  description?: string;
  contentType?: string;
  headers?: AnyZodObject;
}

export type ResponseDef = z.ZodType | ResponseConfig;

export interface RouteDef {
  method: HttpMethod;
  /** Express-style path, e.g. `/users/:id` */
  path: string;
  summary?: string;
  description?: string;
  tags?: readonly string[];
  deprecated?: boolean;
  operationId?: string;
  params?: AnyZodObject;
  query?: AnyZodObject;
  /** Header names must be lowercase. */
  headers?: AnyZodObject;
  body?: z.ZodType;
  bodyContentType?: string;
  responses: { readonly [status: number]: ResponseDef };
  security?: readonly Record<string, readonly string[]>[];
}

export type RoutesDef = Record<string, RouteDef>;

export interface ApiInfo {
  title: string;
  version: string;
  description?: string;
}

export interface ApiServer {
  url: string;
  description?: string;
}

export interface ApiDef<R extends RoutesDef = RoutesDef> {
  info: ApiInfo;
  servers?: readonly ApiServer[];
  tags?: readonly { name: string; description?: string }[];
  securitySchemes?: Record<string, Record<string, unknown>>;
  /** Security requirement applied to every route unless the route overrides it. */
  security?: readonly Record<string, readonly string[]>[];
  routes: R;
}

export interface OpenAPIDocument {
  openapi: string;
  info: ApiInfo & Record<string, unknown>;
  servers?: ApiServer[];
  paths?: Record<string, Record<string, any>>;
  components?: Record<string, Record<string, any>>;
  tags?: { name: string; description?: string }[];
  security?: Record<string, string[]>[];
  [key: string]: unknown;
}

type InferOr<S, Fallback> = S extends z.ZodType ? z.output<S> : Fallback;

type ParamName<S extends string> = S extends `${infer Name}/${string}` ? Name : S;

/** `/users/:id/posts/:postId` → `{ id: string; postId: string }` */
export type PathParams<P extends string> = string extends P
  ? Record<string, string>
  : P extends `${string}:${infer Rest}`
    ? { [K in ParamName<Rest>]: string } & (Rest extends `${string}/${infer Tail}` ? PathParams<`/${Tail}`> : {})
    : {};

export type ResponseSchemaOf<D> = D extends z.ZodType
  ? D
  : D extends { schema: infer S extends z.ZodType }
    ? S
    : undefined;

export interface RequestInput<R extends RouteDef> {
  params: InferOr<R['params'], PathParams<R['path']>>;
  query: InferOr<R['query'], Record<string, unknown>>;
  headers: InferOr<R['headers'], Record<string, string | string[] | undefined>>;
  body: InferOr<R['body'], unknown>;
}

type ResponseFor<Status, D> =
  ResponseSchemaOf<D> extends z.ZodType
    ? { status: Status; body: z.input<ResponseSchemaOf<D>>; headers?: Record<string, string> }
    : { status: Status; body?: undefined; headers?: Record<string, string> };

export type RouteResponse<R extends RouteDef> = {
  [K in keyof R['responses'] & number]: ResponseFor<K, R['responses'][K]>;
}[keyof R['responses'] & number];
