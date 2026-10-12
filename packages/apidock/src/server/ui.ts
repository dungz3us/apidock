import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Locate the prebuilt UI (`ui-dist/`) by walking up from this module — works from `src/` and bundled `dist/` chunks. */
export function findUiDir(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'ui-dist');
    if (existsSync(join(candidate, 'index.html'))) return candidate;
    dir = dirname(dir);
  }
  return undefined;
}

export const FALLBACK_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ApiDock</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 24px;color:#1c1917}code{background:#f5f5f4;padding:2px 6px;border-radius:4px}</style>
</head><body><h1>ApiDock</h1><p>The UI bundle was not found. Build it with <code>pnpm build</code>.</p>
<p>The API is available: <a href="api/spec">api/spec</a></p></body></html>`;
