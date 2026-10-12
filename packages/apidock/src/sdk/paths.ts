const PATH_PARAM = /:([A-Za-z_][A-Za-z0-9_]*)/g;

export function pathParamNames(path: string): string[] {
  return [...path.matchAll(PATH_PARAM)].map((m) => m[1]!);
}

/** `/users/:id` → `/users/{id}` */
export function toOpenApiPath(path: string): string {
  return path.replace(PATH_PARAM, '{$1}');
}
