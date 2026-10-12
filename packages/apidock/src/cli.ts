#!/usr/bin/env node
import { createServer, FileStorage, type ServerOptions } from './server/index.js';
import { createSpecSource } from './server/spec-source.js';
import { runContractTest, type ContractRunReport } from './server/contract-run.js';
import { diffSpecs, type DiffReport } from './server/diff.js';
import type { OpenAPIDoc } from './server/mock.js';
import { basicAuth } from './express/index.js';

const USAGE = `apidock — self-hosted API devtools

Usage:
  apidock serve [options]    Serve the devtools UI + mock + proxy
  apidock test  [options]    Run contract tests (every operation vs a live base URL)
  apidock diff  <old> <new> [--reporter text|json]   Diff two specs; exits 1 on breaking changes

Options:
  --spec <url|file>        OpenAPI 3.x document to serve (URL, .json, .yaml/.yml). Required.
  --port <n>               Port to listen on (env PORT, default 4000)
  --data <dir>             Directory for history/environments/collections (env APIDOCK_DATA_DIR, default .apidock)
  --target <url>           Base URL for relative try-it requests (default: first server in the spec, else --spec origin)
  --auth <user:pass>       Require HTTP basic auth (env APIDOCK_AUTH). Recommended for shared deployments.
  --no-auth                Explicitly run without auth (allowed on localhost binds)
  --allow-host <h[:port]>  Extra host the request proxy may call (repeatable, or env APIDOCK_ALLOW_HOSTS=a,b)
  --refresh <s>            Reload URL/file specs every N seconds (env APIDOCK_REFRESH, default 30)

Test options:
  --base <url>             Base URL of the API under test (default: spec origin or --target)
  --operation <id>         Run only this operationId
  --reporter <text|json|junit>  Output format (default text)
  --header <k:v>           Extra request header, repeatable (e.g. auth)
  -h, --help               Show this help
`;

interface CliArgs {
  spec: string;
  port: number;
  data: string;
  target?: string;
  auth?: string;
  noAuth: boolean;
  allowHosts: string[];
  refreshMs?: number;
  base?: string;
  operation?: string;
  reporter: 'text' | 'json' | 'junit';
  headers: Record<string, string>;
}

function parseDuration(s: string): number {
  const m = /^(\d+)(ms|s|m)?$/.exec(s.trim());
  if (!m) throw new Error(`Invalid duration "${s}" (use e.g. 500ms, 10s, 5m)`);
  const n = Number(m[1]);
  return m[2] === 'm' ? n * 60_000 : m[2] === 'ms' ? n : n * 1000;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { spec: '', port: 4000, data: '.apidock', noAuth: false, allowHosts: [], reporter: 'text', headers: {} };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--spec':
        args.spec = next();
        break;
      case '--port':
        args.port = Number(next());
        break;
      case '--data':
        args.data = next();
        break;
      case '--target':
        args.target = next();
        break;
      case '--auth':
        args.auth = next();
        break;
      case '--no-auth':
        args.noAuth = true;
        break;
      case '--allow-host':
        args.allowHosts.push(next());
        break;
      case '--refresh':
        args.refreshMs = parseDuration(next());
        break;
      case '--base':
        args.base = next();
        break;
      case '--operation':
        args.operation = next();
        break;
      case '--reporter': {
        const r = next();
        if (r !== 'text' && r !== 'json' && r !== 'junit') throw new Error('--reporter must be text|json|junit');
        args.reporter = r;
        break;
      }
      case '--header': {
        const h = next();
        const sep = h.indexOf(':');
        if (sep === -1) throw new Error('--header must be name:value');
        args.headers[h.slice(0, sep).trim().toLowerCase()] = h.slice(sep + 1).trim();
        break;
      }
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
      default:
        throw new Error(`Unknown flag ${flag}`);
    }
  }
  if (process.env.APIDOCK_AUTH && !args.auth) args.auth = process.env.APIDOCK_AUTH;
  if (process.env.APIDOCK_DATA_DIR && args.data === '.apidock') args.data = process.env.APIDOCK_DATA_DIR;
  if (process.env.APIDOCK_ALLOW_HOSTS) args.allowHosts.push(...process.env.APIDOCK_ALLOW_HOSTS.split(',').map((s) => s.trim()));
  if (process.env.APIDOCK_REFRESH && args.refreshMs === undefined) args.refreshMs = parseDuration(process.env.APIDOCK_REFRESH);
  if (process.env.PORT) args.port = Number(process.env.PORT);
  if (!Number.isInteger(args.port) || args.port <= 0) throw new Error(`Invalid --port`);
  if (!args.spec) throw new Error('--spec is required');
  return { ...args, spec: args.spec };
}

export async function serve(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (!args.auth && !args.noAuth) {
    throw new Error(
      'Refusing to start without auth. Pass --auth user:pass (or APIDOCK_AUTH), or --no-auth for local-only use.',
    );
  }

  const { default: express } = await import('express');
  // When the spec is fetched over HTTP the same origin is almost always the API under test.
  const target = args.target ?? (/^https?:\/\//i.test(args.spec) ? new URL(args.spec).origin : undefined);
  const options: ServerOptions = {
    spec: args.spec,
    storage: new FileStorage(args.data),
    target,
    proxy: { allowedHosts: args.allowHosts },
    refreshMs: args.refreshMs,
    mode: 'standalone',
  };
  const app = express();
  app.disable('x-powered-by');
  if (args.auth) {
    const [user, pass] = args.auth.split(':');
    if (!user || !pass) throw new Error('--auth must be user:password');
    app.use(basicAuth(user, pass));
  }
  app.use(createServer(options));

  await new Promise<void>((resolve) => {
    app.listen(args.port, () => {
      console.log(`ApiDock serving ${args.spec}`);
      console.log(`  UI       http://localhost:${args.port}/`);
      console.log(`  Mock     http://localhost:${args.port}/mock/<spec-path>`);
      console.log(`  Data     ${args.data}`);
      console.log(`  Target   ${target ?? '(none — set --target or --allow-host to enable the request client)'}`);
      console.log(`  Auth     ${args.auth ? 'basic auth' : 'none (local only)'}`);
      resolve();
    });
  });
}

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

function toJUnit(report: ContractRunReport): string {
  const cases = report.results
    .map((r) => {
      const name = `${r.method} ${r.path}${r.operationId ? ` (${r.operationId})` : ''}`;
      const fail = r.ok
        ? ''
        : `\n    <failure message="${esc(r.error ?? r.issues.map((i) => i.message).join('; '))}">${r.issues
            .map((i) => `  [${i.location}] ${i.path}: ${i.message}`)
            .join('\n')}\n    </failure>`;
      return `  <testcase name="${esc(name)}" classname="apidock.contract" time="${((r.durationMs ?? 0) / 1000).toFixed(3)}">${fail}\n  </testcase>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="apidock.contract" tests="${report.total}" failures="${report.failed}" timestamp="${report.at}">\n${cases}\n</testsuite>`;
}

function printTextReport(report: ContractRunReport): void {
  for (const r of report.results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    console.log(`  ${mark} ${r.method} ${r.path} → ${r.status ?? r.error} (${r.durationMs ?? 0}ms)`);
    for (const i of r.issues) console.log(`       [${i.location}] ${i.path}: ${i.message}`);
  }
  console.log(`\n${report.total} operations · ${report.passed} passed · ${report.failed} failed`);
}

export async function test(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const doc = await createSpecSource(args.spec).get();
  const base = args.base ?? args.target ?? (/^https?:\/\//i.test(args.spec) ? new URL(args.spec).origin : undefined);
  if (!base) throw new Error('Cannot determine a base URL — pass --base <url>');
  const report = await runContractTest(doc, { baseUrl: base, operationId: args.operation, headers: args.headers });

  if (args.reporter === 'json') console.log(JSON.stringify(report, null, 2));
  else if (args.reporter === 'junit') console.log(toJUnit(report));
  else printTextReport(report);

  if (report.failed > 0 || report.total === 0) process.exitCode = 1;
}

function printDiff(report: DiffReport): void {
  const groups: [string, DiffReport['changes']][] = [
    ['BREAKING', report.breaking],
    ['WARNING', report.warnings],
    ['ADDITION', report.additions],
  ];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    console.log(`\n${label}`);
    for (const c of list) console.log(`  ${c.at} — ${c.message} (${c.rule})`);
  }
  console.log(`\n${report.changes.length} changes · ${report.breaking.length} breaking · ${report.warnings.length} warnings · ${report.additions.length} additions`);
}

export async function diff(argv: string[]): Promise<void> {
  const positional: string[] = [];
  let reporter: 'text' | 'json' = 'text';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--reporter') {
      const r = argv[++i];
      if (r !== 'text' && r !== 'json') throw new Error('--reporter must be text|json');
      reporter = r;
    } else if (a === '-h' || a === '--help') {
      console.log(USAGE);
      return;
    } else if (a.startsWith('--')) {
      throw new Error(`Unknown flag ${a}`);
    } else positional.push(a);
  }
  const [oldSpec, newSpec] = positional;
  if (!oldSpec || !newSpec) throw new Error('Usage: apidock diff <old-spec> <new-spec> [--reporter text|json]');

  const [base, head] = await Promise.all([createSpecSource(oldSpec).get(), createSpecSource(newSpec).get()]);
  const report = diffSpecs(base as OpenAPIDoc, head as OpenAPIDoc);
  if (reporter === 'json') console.log(JSON.stringify(report, null, 2));
  else printDiff(report);
  if (!report.ok) process.exitCode = 1;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'serve':
        return await serve(rest);
      case 'test':
        return await test(rest);
      case 'diff':
        return await diff(rest);
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        console.log(USAGE);
        return;
      default:
        throw new Error(`Unknown command "${command}"`);
    }
  } catch (err) {
    console.error(`apidock: ${(err as Error).message}`);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) void main();
