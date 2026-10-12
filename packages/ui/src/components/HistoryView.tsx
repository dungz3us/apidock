import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, client, type HistoryEntry } from '../lib/api';
import type { Operation } from '../lib/spec';
import { HttpRequestView, HttpResponseView, statusTone } from './HttpMessage';

const when = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });

export function HistoryView({ operations, selectedId }: { operations: Map<string, Operation>; selectedId?: string }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    client
      .history()
      .then((e) => {
        setEntries(e);
        setError(null);
      })
      .catch((err: ApiError) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  const clear = async () => {
    if (!window.confirm('Delete every history entry? This cannot be undone.')) return;
    await client.clearHistory().catch((err: ApiError) => setError(err.message));
    load();
  };

  const selected = entries?.find((e) => e.id === selectedId);

  return (
    <section aria-labelledby="history-title" className="mt-10 pb-24">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="history-title" className="font-mono text-lg font-semibold">
          History
        </h2>
        {!!entries?.length && (
          <button type="button" className="btn btn-quiet text-err hover:text-err" onClick={clear}>
            <Trash2 aria-hidden size={14} /> Clear history
          </button>
        )}
      </div>
      <p className="mt-2 max-w-[70ch] text-sm text-ink-2">
        The last 200 requests sent from ApiDock, newest first. Authorization, cookies and API keys are stored as [redacted].
      </p>

      {error && <p className="mt-6 rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{error}</p>}

      {entries === null && !error ? (
        <div className="mt-6 space-y-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-[3px] bg-sheet" />
          ))}
        </div>
      ) : entries?.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No requests yet. Send one from any section and it is recorded here.</p>
      ) : (
        entries && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
              <caption className="sr-only">Request history</caption>
              <thead>
                <tr className="border-b border-rule-strong font-mono text-xs text-ink-3">
                  <th scope="col" className="py-2 pr-4 font-normal">Time</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Section</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Request</th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">Status</th>
                  <th scope="col" className="py-2 text-right font-normal">Time taken</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[0.8125rem]">
                {entries.map((e) => {
                  const op = e.operationId ? operations.get(e.operationId) : undefined;
                  const current = e.id === selectedId;
                  return (
                    <tr key={e.id} className={`border-b border-rule ${current ? 'bg-link-wash' : 'hover:bg-sheet'}`}>
                      <td className="py-2 pr-4 text-ink-3">
                        <time dateTime={e.at}>{when(e.at)}</time>
                      </td>
                      <td className="py-2 pr-4 text-ink-3">{op ? <a href={`#/op/${encodeURIComponent(op.id)}`}>§{op.section}</a> : '—'}</td>
                      <td className="max-w-0 py-2 pr-4">
                        <a
                          href={`#/history/${encodeURIComponent(e.id)}`}
                          aria-current={current ? 'true' : undefined}
                          className="block truncate text-ink no-underline hover:underline"
                        >
                          <span className="font-semibold">{e.request.method}</span> {e.request.url}
                        </a>
                      </td>
                      <td className={`py-2 pr-4 text-right font-semibold ${e.response ? statusTone(e.response.status) : 'text-err'}`}>
                        {e.response?.status ?? 'failed'}
                      </td>
                      <td className="py-2 text-right text-ink-3">{e.response ? `${e.response.durationMs} ms` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {selected && (
        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <section aria-label="Recorded request">
            <h3 className="mb-3 font-mono text-sm font-semibold">Request</h3>
            <HttpRequestView request={selected.request} />
          </section>
          <section aria-label="Recorded response">
            <h3 className="mb-3 font-mono text-sm font-semibold">Response</h3>
            {selected.response ? (
              <HttpResponseView response={selected.response} />
            ) : (
              <p className="rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{selected.error}</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
