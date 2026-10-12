import { Code2, FilePlus2, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, client, type DesignDraft, type DraftParam } from '../lib/api';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const PARAM_TYPES = ['string', 'number', 'integer', 'boolean'] as const;

const newDraft = (): DesignDraft => ({
  id: crypto.randomUUID(),
  name: '',
  method: 'GET',
  path: '/',
  params: [],
});

const parseSchema = (text: string): { schema?: Record<string, unknown>; error?: string } => {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'Schema must be a JSON object' };
    return { schema: v as Record<string, unknown> };
  } catch {
    return { error: 'Invalid JSON' };
  }
};

function ParamRow({ param, onChange, onDelete }: { param: DraftParam; onChange: (p: DraftParam) => void; onDelete: () => void }) {
  return (
    <div className="grid grid-cols-[minmax(6rem,10rem)_5.5rem_1fr_auto_auto] items-center gap-2">
      <input
        aria-label="Parameter location"
        className="field font-mono text-xs"
        value={param.in}
        list="param-ins"
        onChange={(e) => onChange({ ...param, in: e.target.value as DraftParam['in'] })}
      />
      <select
        aria-label="Parameter type"
        className="field font-mono text-xs"
        value={param.type ?? 'string'}
        onChange={(e) => onChange({ ...param, type: e.target.value as DraftParam['type'] })}
      >
        {PARAM_TYPES.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <input aria-label="Parameter name" className="field font-mono text-xs" placeholder="name" value={param.name} onChange={(e) => onChange({ ...param, name: e.target.value })} />
      <label className="flex items-center gap-1 font-mono text-xs text-ink-3">
        <input type="checkbox" className="size-4 accent-link" checked={param.required ?? param.in === 'path'} disabled={param.in === 'path'} onChange={(e) => onChange({ ...param, required: e.target.checked })} />
        req
      </label>
      <button type="button" className="btn btn-quiet p-1 text-ink-3 hover:text-err" aria-label="Remove parameter" onClick={onDelete}>
        <Trash2 aria-hidden size={13} />
      </button>
    </div>
  );
}

function DraftEditor({ draft, onChange }: { draft: DesignDraft; onChange: (d: DesignDraft) => void }) {
  const [bodyText, setBodyText] = useState(draft.requestBody ? JSON.stringify(draft.requestBody, null, 2) : '');
  const [respText, setRespText] = useState(draft.responseBody ? JSON.stringify(draft.responseBody, null, 2) : '');
  const [errors, setErrors] = useState<{ body?: string; resp?: string }>({});

  const applySchema = (key: 'requestBody' | 'responseBody', text: string) => {
    const { schema, error } = parseSchema(text);
    setErrors((e) => ({ ...e, [key === 'requestBody' ? 'body' : 'resp']: error }));
    if (!error) onChange({ ...draft, [key]: schema });
    if (key === 'requestBody') setBodyText(text);
    else setRespText(text);
  };

  return (
    <div className="mt-4 space-y-4 rounded-[4px] border border-rule bg-sheet p-4">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_minmax(8rem,14rem)]">
        <label className="block">
          <span className="rule-label">Method</span>
          <select className="field mt-1 w-full font-mono" value={draft.method} onChange={(e) => onChange({ ...draft, method: e.target.value })}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="rule-label">Path — /pets/{'{id}'} or /pets/:id</span>
          <input className="field mt-1 w-full font-mono" value={draft.path} onChange={(e) => onChange({ ...draft, path: e.target.value })} />
        </label>
        <label className="block">
          <span className="rule-label">Name</span>
          <input className="field mt-1 w-full" placeholder="List pets" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className="rule-label">Summary</span>
        <input className="field mt-1 w-full" value={draft.summary ?? ''} onChange={(e) => onChange({ ...draft, summary: e.target.value })} />
      </label>

      <div>
        <p className="rule-label mb-1.5">Parameters</p>
        <datalist id="param-ins">
          <option value="path" />
          <option value="query" />
          <option value="header" />
        </datalist>
        <div className="space-y-1.5">
          {(draft.params ?? []).map((p, i) => (
            <ParamRow
              key={i}
              param={p}
              onChange={(np) => onChange({ ...draft, params: draft.params!.map((x, j) => (j === i ? np : x)) })}
              onDelete={() => onChange({ ...draft, params: draft.params!.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
        <button
          type="button"
          className="btn btn-quiet mt-2 px-1.5 py-0.5 text-xs"
          onClick={() => onChange({ ...draft, params: [...(draft.params ?? []), { name: '', in: 'query', type: 'string' }] })}
        >
          <Plus aria-hidden size={13} /> Add parameter
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block">
          <span className="rule-label">Request body — JSON Schema</span>
          <textarea
            className="field mt-1 h-32 w-full font-mono text-[0.8125rem]"
            spellCheck={false}
            placeholder={'{ "type": "object", "required": ["name"], "properties": { "name": { "type": "string" } } }'}
            value={bodyText}
            onChange={(e) => applySchema('requestBody', e.target.value)}
          />
          {errors.body && <span className="mt-1 block font-mono text-xs text-err">{errors.body}</span>}
        </label>
        <label className="block">
          <span className="rule-label">
            Response body — JSON Schema, status{' '}
            <input
              className="field inline w-16 px-1 py-0 font-mono text-xs"
              value={draft.responseStatus ?? 200}
              onChange={(e) => onChange({ ...draft, responseStatus: Number(e.target.value) || 200 })}
            />
          </span>
          <textarea
            className="field mt-1 h-32 w-full font-mono text-[0.8125rem]"
            spellCheck={false}
            placeholder={'{ "type": "object", "properties": { "ok": { "type": "boolean" } } }'}
            value={respText}
            onChange={(e) => applySchema('responseBody', e.target.value)}
          />
          {errors.resp && <span className="mt-1 block font-mono text-xs text-err">{errors.resp}</span>}
        </label>
      </div>
    </div>
  );
}

export function DesignView() {
  const [drafts, setDrafts] = useState<DesignDraft[] | null>(null);
  const [editing, setEditing] = useState<DesignDraft | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    client
      .drafts()
      .then(setDrafts)
      .catch((err: ApiError) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  const saveDrafts = async (next: DesignDraft[]) => {
    setBusy(true);
    try {
      setDrafts(await client.saveDrafts(next));
      setEditing(null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const showCode = async () => {
    setBusy(true);
    try {
      setCode((await client.codegen()).code);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="design-title" className="mt-10 pb-24">
      <h2 id="design-title" className="font-mono text-lg font-semibold">
        Design
      </h2>
      <p className="mt-2 max-w-[70ch] text-sm text-ink-2">
        Sketch endpoints that don&apos;t exist yet. Drafts are served by the mock engine immediately — point the request client at{' '}
        <code className="font-mono">Mock</code> to try them — and the generated <code className="font-mono">defineApi</code> contract can be pasted
        straight into your code.
      </p>

      {error && <p className="mt-4 rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{error}</p>}

      <div className="mt-6 flex items-center justify-between">
        <h3 className="font-mono text-sm font-semibold">
          <span className="text-ink-3">D.1.</span> Drafts
        </h3>
        <div className="flex gap-2">
          <button type="button" className="btn" disabled={busy || !drafts?.length} onClick={() => void showCode()}>
            <Code2 aria-hidden size={14} /> Generate contract
          </button>
          <button type="button" className="btn" onClick={() => setEditing(newDraft())}>
            <FilePlus2 aria-hidden size={14} /> New draft
          </button>
        </div>
      </div>

      {drafts === null ? (
        <p className="mt-4 text-sm text-ink-3" aria-busy>
          Loading drafts…
        </p>
      ) : drafts.length === 0 && !editing ? (
        <p className="mt-4 text-sm text-ink-3">No drafts yet. Design an endpoint here and let the frontend build against its mock while the backend catches up.</p>
      ) : (
        <ul className="mt-4 border-t border-rule">
          {drafts.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-3 border-b border-rule py-2.5 font-mono text-[0.8125rem]">
              <span className="font-semibold">{d.method}</span>
              <span>{d.path}</span>
              <span className="text-ink-3">{d.name}</span>
              <span className="ml-auto flex gap-1">
                <button type="button" className="btn btn-quiet px-1.5 py-0.5 text-xs" onClick={() => setEditing({ ...d })}>
                  Edit
                </button>
                <button
                  type="button"
                  aria-label={`Delete draft ${d.name}`}
                  className="btn btn-quiet p-1 text-ink-3 hover:text-err"
                  onClick={() => void saveDrafts(drafts.filter((x) => x.id !== d.id))}
                >
                  <Trash2 aria-hidden size={13} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <>
          <h3 className="mt-8 font-mono text-sm font-semibold">
            <span className="text-ink-3">D.2.</span> {drafts?.some((d) => d.id === editing.id) ? 'Edit draft' : 'New draft'}
          </h3>
          <DraftEditor draft={editing} onChange={setEditing} />
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !editing.name.trim() || !editing.path.startsWith('/')}
              onClick={() => void saveDrafts([...(drafts ?? []).filter((d) => d.id !== editing.id), editing])}
            >
              <Save aria-hidden size={14} /> {busy ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </>
      )}

      {code && (
        <div className="mt-8">
          <div className="flex items-baseline justify-between">
            <h3 className="font-mono text-sm font-semibold">
              <span className="text-ink-3">D.3.</span> Generated contract
            </h3>
            <button
              type="button"
              className="btn btn-quiet text-xs"
              onClick={() => void navigator.clipboard.writeText(code).then(() => setCopied(true)).finally(() => setTimeout(() => setCopied(false), 1500))}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="mt-3 max-h-[28rem] overflow-auto rounded-[4px] border border-rule bg-sheet p-4 font-mono text-[0.75rem] leading-5" tabIndex={0}>
            {code}
          </pre>
        </div>
      )}
    </section>
  );
}
