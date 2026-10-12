import { Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { client, type Collection, type Environment, type EnvVar } from '../lib/api';

const newId = () => crypto.randomUUID();

interface Props {
  envs: Environment[];
  onEnvs: (envs: Environment[]) => void;
  collections: Collection[];
  onCollections: (cols: Collection[]) => void;
}

function Section({ number, title, hint }: { number: string; title: string; hint: string }) {
  return (
    <div className="mt-10 mb-4">
      <h3 className="font-mono text-sm font-semibold">
        <span className="text-ink-3">{number}.</span> {title}
      </h3>
      <p className="mt-1 max-w-[70ch] text-sm text-ink-2">{hint}</p>
    </div>
  );
}

export function SetupView({ envs, onEnvs, collections, onCollections }: Props) {
  const [saving, setSaving] = useState<'envs' | 'cols' | null>(null);
  const [savedMsg, setSavedMsg] = useState('');

  const persist = async (kind: 'envs' | 'cols', data: Environment[] | Collection[]) => {
    setSaving(kind);
    try {
      if (kind === 'envs') onEnvs(await client.saveEnvironments(data as Environment[]));
      else onCollections(await client.saveCollections(data as Collection[]));
      setSavedMsg('Saved.');
      setTimeout(() => setSavedMsg(''), 2000);
    } catch {
      setSavedMsg('Save failed — check the server.');
    } finally {
      setSaving(null);
    }
  };

  const setEnv = (i: number, patch: Partial<Environment>) => onEnvs(envs.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const setVar = (ei: number, vi: number, patch: Partial<EnvVar>) =>
    setEnv(ei, { variables: envs[ei]!.variables.map((v, j) => (j === vi ? { ...v, ...patch } : v)) });

  return (
    <div className="pb-24">
      <Section number="S.1" title="Environments" hint="Named base URLs with {{variables}}. Write {{key}} anywhere in a request — URL, headers or body — and pick the environment in the source switcher. Secret values are masked here and scrubbed from history." />
      <div className="space-y-4">
        {envs.map((env, ei) => (
          <fieldset key={env.id} className="rounded-[4px] border border-rule bg-sheet p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(8rem,14rem)_1fr_auto]">
              <label className="block">
                <span className="rule-label">Name</span>
                <input className="field mt-1 w-full" value={env.name} onChange={(e) => setEnv(ei, { name: e.target.value })} />
              </label>
              <label className="block">
                <span className="rule-label">Base URL</span>
                <input className="field mt-1 w-full font-mono" placeholder="https://staging.example.com" value={env.baseUrl} onChange={(e) => setEnv(ei, { baseUrl: e.target.value })} />
              </label>
              <div className="flex items-end">
                <button type="button" className="btn btn-quiet p-1.5 text-err" aria-label={`Delete environment ${env.name}`} onClick={() => onEnvs(envs.filter((_, j) => j !== ei))}>
                  <Trash2 aria-hidden size={14} />
                </button>
              </div>
            </div>
            <div className="mt-3">
              <p className="rule-label mb-1.5">Variables</p>
              {env.variables.length === 0 && <p className="text-sm text-ink-3">No variables.</p>}
              <ul className="space-y-1.5">
                {env.variables.map((v, vi) => (
                  <li key={vi} className="grid grid-cols-[minmax(7rem,12rem)_1fr_auto_auto] items-center gap-2">
                    <input aria-label="Variable name" className="field font-mono" placeholder="key" value={v.key} onChange={(e) => setVar(ei, vi, { key: e.target.value })} />
                    <input
                      aria-label={`Value of ${v.key || 'variable'}`}
                      className="field font-mono"
                      placeholder="value"
                      type={v.secret ? 'password' : 'text'}
                      value={v.value}
                      onChange={(e) => setVar(ei, vi, { value: e.target.value })}
                    />
                    <label className="flex items-center gap-1.5 font-mono text-xs text-ink-3">
                      <input type="checkbox" className="size-4 accent-link" checked={!!v.secret} onChange={(e) => setVar(ei, vi, { secret: e.target.checked })} />
                      secret
                    </label>
                    <button
                      type="button"
                      className="btn btn-quiet p-1"
                      aria-label="Remove variable"
                      onClick={() => setEnv(ei, { variables: env.variables.filter((_, j) => j !== vi) })}
                    >
                      <Trash2 aria-hidden size={13} />
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn-quiet mt-2 px-1.5 py-0.5 text-xs"
                onClick={() => setEnv(ei, { variables: [...env.variables, { key: '', value: '' }] })}
              >
                <Plus aria-hidden size={13} /> Add variable
              </button>
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" className="btn" onClick={() => onEnvs([...envs, { id: newId(), name: `env-${envs.length + 1}`, baseUrl: '', variables: [] }])}>
          <Plus aria-hidden size={14} /> Add environment
        </button>
        <button type="button" className="btn btn-primary" disabled={saving === 'envs'} onClick={() => void persist('envs', envs)}>
          <Save aria-hidden size={14} /> {saving === 'envs' ? 'Saving…' : 'Save environments'}
        </button>
      </div>

      <Section number="S.2" title="Collections" hint="Saved request drafts, grouped. Save the current request from any operation page, or replay entries from the table of contents." />
      {collections.length === 0 ? (
        <p className="text-sm text-ink-3">No collections yet. Open an operation, fill the request and press “Save to collection”.</p>
      ) : (
        <ul className="border-t border-rule">
          {collections.map((col) => (
            <li key={col.id} className="border-b border-rule py-3">
              <div className="flex items-baseline justify-between">
                <h4 className="font-mono text-sm font-semibold">
                  {col.name} <span className="font-normal text-ink-3">· {col.requests.length} request{col.requests.length === 1 ? '' : 's'}</span>
                </h4>
                <button
                  type="button"
                  className="btn btn-quiet px-1.5 py-0.5 text-xs text-err"
                  onClick={() => void persist('cols', collections.filter((c) => c.id !== col.id))}
                >
                  Delete collection
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {col.requests.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 font-mono text-xs">
                    <a className="inline-flex min-w-0 items-baseline gap-2 text-link" href={`#/saved/${col.id}/${r.id}`}>
                      <span className="font-semibold">{r.method}</span> <span className="truncate">{r.url}</span> <span className="text-ink-3">{r.name}</span>
                    </a>
                    <button
                      type="button"
                      aria-label={`Delete ${r.name}`}
                      className="btn btn-quiet ml-auto p-1 text-ink-3 hover:text-err"
                      onClick={() =>
                        void persist(
                          'cols',
                          collections.map((c) => (c.id === col.id ? { ...c, requests: c.requests.filter((x) => x.id !== r.id) } : c)),
                        )
                      }
                    >
                      <Trash2 aria-hidden size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {savedMsg && (
        <p role="status" className="mt-4 font-mono text-xs text-ok">
          {savedMsg}
        </p>
      )}
    </div>
  );
}
