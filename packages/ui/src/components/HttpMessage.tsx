import { useState } from 'react';
import type { ProxyRequest, ProxyResponse } from '../lib/api';
import { CodeBlock, prettyBody } from './Code';

export const statusTone = (status: number) =>
  status >= 500 ? 'text-err' : status >= 400 ? 'text-warn' : status >= 200 && status < 400 ? 'text-ok' : 'text-ink';

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function HeaderLines({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (!entries.length) return null;
  return (
    <dl className="font-mono text-[0.8125rem] leading-[1.6]">
      {entries.map(([k, v]) => (
        <div key={k} className="flex min-w-0 gap-1">
          <dt className="shrink-0 text-ink-3">{k}:</dt>
          <dd className="min-w-0 break-all text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function HttpRequestView({ request }: { request: ProxyRequest }) {
  const body = request.body ? prettyBody(request.body, request.headers?.['content-type']) : undefined;
  return (
    <div className="space-y-2">
      <p className="font-mono text-[0.8125rem] break-all">
        <span className="font-semibold">{request.method}</span> {request.url}
      </p>
      <HeaderLines headers={request.headers ?? {}} />
      {body && <CodeBlock label="Request body" text={body.text} json={body.json} className="max-h-72 border-t border-rule pt-2" />}
    </div>
  );
}

export function HttpResponseView({ response, declared }: { response: ProxyResponse; declared?: boolean }) {
  const [showHeaders, setShowHeaders] = useState(false);
  const type = response.headers['content-type'] ?? '';
  const body = response.encoding === 'utf8' ? prettyBody(response.body, type) : undefined;
  const headerCount = Object.keys(response.headers).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className={`font-mono text-base font-semibold ${statusTone(response.status)}`}>
          {response.status} {response.statusText}
        </p>
        <p className="font-mono text-xs text-ink-3">
          {response.durationMs} ms · {formatBytes(response.size)}
          {response.truncated && ' · truncated'}
        </p>
        {declared !== undefined && (
          <p className={`keyword ${declared ? 'text-ok' : 'text-warn'}`}>{declared ? 'DECLARED STATUS' : 'UNDECLARED STATUS'}</p>
        )}
      </div>

      {headerCount > 0 && (
        <div>
          <button
            type="button"
            className="rule-label hover:text-ink"
            aria-expanded={showHeaders}
            onClick={() => setShowHeaders((v) => !v)}
          >
            {showHeaders ? 'Hide' : 'Show'} {headerCount} headers
          </button>
          {showHeaders && (
            <div className="mt-2">
              <HeaderLines headers={response.headers} />
            </div>
          )}
        </div>
      )}

      {body ? (
        body.text ? (
          <CodeBlock label="Response body" text={body.text} json={body.json} className="max-h-[32rem] border-t border-rule pt-3" />
        ) : (
          <p className="border-t border-rule pt-3 text-sm text-ink-3">Empty body.</p>
        )
      ) : (
        <p className="border-t border-rule pt-3 text-sm text-ink-2">
          Binary body ({type || 'unknown type'}, {formatBytes(response.size)}), not shown.
        </p>
      )}
    </div>
  );
}
