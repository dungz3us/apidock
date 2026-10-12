import { RotateCw } from 'lucide-react';
import type { Config } from '../lib/api';
import type { OpenAPIDoc } from '../lib/spec';

const time = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString([], { hour12: false }) : '—');

interface Props {
  config: Config;
  doc: OpenAPIDoc;
  serverIndex: number;
  onServerChange: (index: number) => void;
  onReload: () => void;
  reloading: boolean;
}

/** RFC-style front matter: who/where on the left, what/when on the right. */
export function FrontMatter({ config, doc, serverIndex, onServerChange, onReload, reloading }: Props) {
  const servers = doc.servers ?? [];
  return (
    <header className="border-b border-rule pb-6">
      <div className="grid grid-cols-1 gap-x-8 gap-y-1 font-mono text-xs leading-5 text-ink-2 sm:grid-cols-2">
        <dl className="contents sm:block">
          <Meta term="Mode" value={config.mode === 'embedded' ? 'Embedded in backend' : 'Standalone service'} />
          <Meta term="Target" value={config.target ?? 'absolute URLs only'} />
          <div className="flex gap-2">
            <dt className="text-ink-3">Server</dt>
            <dd className="min-w-0">
              {servers.length > 1 ? (
                <label>
                  <span className="sr-only">Server</span>
                  <select
                    className="field py-0 text-xs"
                    value={serverIndex}
                    onChange={(e) => onServerChange(Number(e.target.value))}
                  >
                    {servers.map((s, i) => (
                      <option key={s.url} value={i}>
                        {s.url}
                        {s.description ? ` (${s.description})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="truncate">{servers[0]?.url || '/'}</span>
              )}
            </dd>
          </div>
        </dl>
        <dl className="contents sm:block sm:text-right">
          <Meta term="OpenAPI" value={doc.openapi} align />
          <Meta term="Version" value={doc.info.version} align />
          <div className="flex items-center gap-2 sm:justify-end">
            <dt className="text-ink-3">Loaded</dt>
            <dd className="flex items-center gap-2">
              <time>{time(config.specLoadedAt)}</time>
              <button type="button" className="btn btn-quiet px-1.5 py-0.5 text-xs" onClick={onReload} disabled={reloading}>
                <RotateCw aria-hidden size={13} className={reloading ? 'animate-spin' : ''} />
                Reload
              </button>
            </dd>
          </div>
        </dl>
      </div>

      <h1 className="mt-8 text-center font-mono text-2xl font-semibold tracking-[-0.02em] text-balance text-ink">{doc.info.title}</h1>
      {doc.info.description && <p className="mx-auto mt-3 max-w-[68ch] text-center text-ink-2 text-pretty">{doc.info.description}</p>}

      {config.specError && (
        <p role="status" className="mt-5 rounded-[3px] bg-warn-wash px-3 py-2 font-mono text-xs text-warn">
          Spec refresh failed: {config.specError}. Serving the last version that loaded.
        </p>
      )}
    </header>
  );
}

function Meta({ term, value, align }: { term: string; value: string; align?: boolean }) {
  return (
    <div className={`flex gap-2 ${align ? 'sm:justify-end' : ''}`}>
      <dt className="text-ink-3">{term}</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  );
}
