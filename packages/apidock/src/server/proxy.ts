import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';

export interface ProxyOptions {
  /**
   * Hosts (`host` or `host:port`) the proxy may call in addition to the target and environment base URLs.
   * Use `'*'` to allow any public host — private/loopback/link-local addresses stay blocked
   * unless `allowPrivateNetwork` is set.
   */
  allowedHosts?: string[];
  allowPrivateNetwork?: boolean;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface ProxyRequest {
  method: string;
  /** Absolute URL, or a path resolved against the target. */
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ProxyResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  encoding: 'utf8' | 'base64';
  size: number;
  durationMs: number;
  truncated: boolean;
}

export class ProxyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blocked.check(mapped[1]!, 'ipv4');
  const family = isIP(ip);
  if (family === 0) return true;
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/** DNS lookup that refuses private addresses — checked at connect time, so DNS rebinding can't bypass it. */
function publicOnlyLookup(
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const bad = addresses.find((a) => isPrivateAddress(a.address));
    if (bad) return callback(Object.assign(new Error(`blocked private address ${bad.address} for ${hostname}`), { code: 'EAPIDOCKBLOCKED' }), '');
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
]);

const TEXTUAL = /^(text\/|application\/([\w.+-]*\+)?(json|xml|javascript|x-www-form-urlencoded|yaml|graphql)\b)/i;

const normalizeHost = (u: URL): string => `${u.hostname.toLowerCase()}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;

/** Accepts `host`, `host:port` or a full URL; returns the canonical `host:port` set. */
export function hostKeys(entries: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const entry of entries) {
    if (entry === '*') {
      out.add('*');
      continue;
    }
    try {
      const url = new URL(/^[a-z]+:\/\//i.test(entry) ? entry : `http://${entry}`);
      if (/^[a-z]+:\/\//i.test(entry) || url.port) out.add(normalizeHost(url));
      else {
        out.add(`${url.hostname.toLowerCase()}:80`);
        out.add(`${url.hostname.toLowerCase()}:443`);
      }
    } catch {
      // ignore malformed entries
    }
  }
  return out;
}

export interface ProxyContext {
  /** Base URL for relative request URLs; always allowed. */
  target?: string;
  /** Extra allowed hosts/base URLs (e.g. environment base URLs). */
  allowed?: Iterable<string>;
  options?: ProxyOptions;
}

export function resolveProxyUrl(req: ProxyRequest, ctx: ProxyContext): { url: URL; checkPrivate: boolean } {
  let url: URL;
  try {
    url = ctx.target ? new URL(req.url, ctx.target) : new URL(req.url);
  } catch {
    throw new ProxyError(ctx.target ? `Invalid URL "${req.url}"` : `"${req.url}" must be an absolute URL (no target configured)`, 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ProxyError(`Unsupported protocol ${url.protocol}`, 400);
  if (url.username || url.password) throw new ProxyError('Credentials in URL are not allowed', 400);

  const allowed = hostKeys([...(ctx.target ? [ctx.target] : []), ...(ctx.allowed ?? []), ...(ctx.options?.allowedHosts ?? [])]);
  if (allowed.has(normalizeHost(url))) return { url, checkPrivate: false };
  if (allowed.has('*')) return { url, checkPrivate: !ctx.options?.allowPrivateNetwork };
  throw new ProxyError(`Host ${url.host} is not allowed. Add it to an environment or to proxy.allowedHosts.`, 403);
}

function decode(res: http.IncomingMessage): Readable {
  switch ((res.headers['content-encoding'] ?? '').toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return res.pipe(createGunzip());
    case 'deflate':
      return res.pipe(createInflate());
    case 'br':
      return res.pipe(createBrotliDecompress());
    default:
      return res;
  }
}

export function sendProxied(req: ProxyRequest, ctx: ProxyContext): Promise<ProxyResponse> {
  const { url, checkPrivate } = resolveProxyUrl(req, ctx);
  if (checkPrivate && isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new ProxyError(`Blocked private address ${url.hostname}`, 403);
  }
  const timeoutMs = ctx.options?.timeoutMs ?? 30_000;
  const maxBytes = ctx.options?.maxResponseBytes ?? 10 * 1024 * 1024;
  const method = req.method.toUpperCase();
  if (!/^[A-Z]+$/.test(method)) throw new ProxyError(`Invalid method ${req.method}`, 400);

  const headers: Record<string, string> = { 'accept-encoding': 'gzip, deflate, br' };
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    const key = k.toLowerCase();
    if (!HOP_BY_HOP.has(key) && typeof v === 'string') headers[key] = v;
  }
  const body = req.body !== undefined && method !== 'GET' && method !== 'HEAD' ? Buffer.from(req.body, 'utf8') : undefined;
  if (body) headers['content-length'] = String(body.length);

  const started = performance.now();
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const outgoing = transport.request(
      url,
      { method, headers, timeout: timeoutMs, ...(checkPrivate ? { lookup: publicOnlyLookup } : {}) },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const stream = decode(res);
        stream.on('data', (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
            size = maxBytes;
            res.destroy();
            finish();
          } else chunks.push(chunk);
        });
        stream.on('end', () => finish());
        stream.on('error', (err) => (truncated ? undefined : reject(new ProxyError(`Response error: ${err.message}`, 502))));

        let done = false;
        function finish() {
          if (done) return;
          done = true;
          const buf = Buffer.concat(chunks);
          const resHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) resHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
          const textual = TEXTUAL.test(resHeaders['content-type'] ?? 'text/plain');
          resolve({
            url: url.toString(),
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers: resHeaders,
            body: buf.toString(textual ? 'utf8' : 'base64'),
            encoding: textual ? 'utf8' : 'base64',
            size,
            durationMs: Math.round((performance.now() - started) * 10) / 10,
            truncated,
          });
        }
      },
    );
    outgoing.on('timeout', () => outgoing.destroy(new ProxyError(`Request timed out after ${timeoutMs}ms`, 504)));
    outgoing.on('error', (err: NodeJS.ErrnoException) => {
      if (err instanceof ProxyError) return reject(err);
      if (err.code === 'EAPIDOCKBLOCKED') return reject(new ProxyError(err.message, 403));
      reject(new ProxyError(`${err.code ?? 'Error'}: ${err.message}`, 502));
    });
    outgoing.end(body);
  });
}
