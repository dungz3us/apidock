/** `{{name}}` placeholders resolve against a variable map. */
export const interpolate = (text: string, vars: Record<string, string>): string =>
  text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, key: string) => (key in vars ? vars[key]! : m));
