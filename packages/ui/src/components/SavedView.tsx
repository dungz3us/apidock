import { Send } from 'lucide-react';
import { useState } from 'react';
import { ApiError, client, type ProxyResponse, type SavedRequest } from '../lib/api';
import type { Environment } from '../lib/api';
import { interpolate } from '../lib/request';
import { HttpResponseView } from './HttpMessage';

interface Props {
  request: SavedRequest;
  collectionName: string;
  envs: Environment[];
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export function SavedView({ request, collectionName, envs }: Props) {
  const [envId, setEnvId] = useState('');
  const [sending, setSending] = useState(false);
  const [run, setRun] = useState<{ response?: ProxyResponse; error?: string }>({});

  const env = envs.find((e) => e.id === envId);
  const vars = Object.fromEntries((env?.variables ?? []).map((v) => [v.key, v.value]));
  const url = env ? `${env.baseUrl.replace(/\/+$/, '')}${interpolate(request.url, vars)}` : interpolate(request.url, vars);

  const send = async () => {
    setSending(true);
    try {
      const headers = request.headers
        ? Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, interpolate(v, vars)]))
        : undefined;
      const response = await client.proxy({
        method: request.method,
        url,
        headers,
        ...(request.body ? { body: interpolate(request.body, vars) } : {}),
      });
      setRun({ response });
    } catch (err) {
      setRun({ error: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="pb-24">
      <header className="mt-10">
        <h2 className="flex flex-wrap items-baseline gap-x-3 font-mono text-lg font-semibold">
          <span className="text-ink-3">Saved.</span> {request.name}
        </h2>
        <p className="mt-1 font-mono text-xs text-ink-3">collection {collectionName} · saved {new Date(request.createdAt).toLocaleString()}</p>
      </header>

      <div className="mt-8 rounded-[4px] border border-rule bg-sheet px-4 py-3 font-mono text-[0.875rem]">
        <span className="mr-2 font-semibold">{request.method}</span>
        <span className="break-all">{env ? `${env.baseUrl.replace(/\/+$/, '')}` : ''}{request.url}</span>
      </div>

      {envs.length > 0 && (
        <p className="mt-4 flex items-center gap-2 font-mono text-xs text-ink-3">
          Run against
          <select className="field w-auto px-2 py-1 text-xs" value={envId} onChange={(e) => setEnvId(e.target.value)} aria-label="Environment">
            <option value="">default target</option>
            {envs.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.baseUrl}
              </option>
            ))}
          </select>
        </p>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={sending} aria-keyshortcuts="Control+Enter Meta+Enter">
          <Send aria-hidden size={14} />
          {sending ? 'Sending…' : 'Send request'}
          <kbd className="ml-1 font-mono text-[0.6875rem] opacity-80">{isMac ? '⌘↵' : 'Ctrl+↵'}</kbd>
        </button>
      </div>

      <section aria-label="Result" aria-live="polite" className="mt-8">
        {run.error ? (
          <p className="rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{run.error}</p>
        ) : run.response ? (
          <HttpResponseView response={run.response} declared={true} />
        ) : (
          <p className="text-sm text-ink-3">Not sent yet.</p>
        )}
      </section>
    </div>
  );
}
