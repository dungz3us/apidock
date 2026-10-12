import { Check, Copy, Plus, Save, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, client, type Environment, type ProxyResponse } from '../lib/api';
import { bodyError, buildRequest, missingRequired, mockPath, toCurl, type Draft, type HeaderRow } from '../lib/request';
import {
  jsonBodyOf,
  resolveRef,
  sampleFromSchema,
  schemaLabel,
  type MediaType,
  type OpenAPIDoc,
  type Operation,
  type Parameter,
} from '../lib/spec';
import { CodeBlock } from './Code';
import { HttpResponseView } from './HttpMessage';

export interface RunState {
  response?: ProxyResponse;
  error?: string;
  at?: number;
}

/** Where a request goes when sent. */
export type SendSource = { kind: 'local' } | { kind: 'mock' } | { kind: 'env'; envId: string };

export const describeSource = (source: SendSource, envs: Environment[]): string =>
  source.kind === 'mock' ? 'mock' : source.kind === 'env' ? (envs.find((e) => e.id === source.envId)?.name ?? 'environment') : 'local';

interface Props {
  doc: OpenAPIDoc;
  op: Operation;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  run: RunState | undefined;
  onRun: (run: RunState) => void;
  serverIndex: number;
  curlBase: string;
  source: SendSource;
  envs: Environment[];
  onSource: (source: SendSource) => void;
  onSave: (name: string) => void;
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

function isDeclared(op: Operation, status: number): boolean {
  const keys = Object.keys(op.op.responses ?? {});
  return keys.includes(String(status)) || keys.includes(`${String(status)[0]}XX`) || keys.includes('default');
}

function SubHeading({ number, children }: { number: string; children: string }) {
  return (
    <h3 className="mt-10 mb-4 flex items-baseline gap-3 font-mono text-sm font-semibold text-ink">
      <span className="text-ink-3">{number}.</span>
      {children}
    </h3>
  );
}

function Requirement({ required }: { required?: boolean }) {
  return <span className={`keyword ${required ? 'text-ink' : 'text-ink-3'}`}>{required ? 'REQUIRED' : 'OPTIONAL'}</span>;
}

export function OperationView({ doc, op, draft, onDraft, run, onRun, serverIndex, curlBase, source, envs, onSource, onSave }: Props) {
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const pathInputs = useRef(new Map<string, HTMLInputElement>());
  const resultRef = useRef<HTMLElement>(null);

  const env = source.kind === 'env' ? envs.find((e) => e.id === source.envId) : undefined;
  const vars = Object.fromEntries((env?.variables ?? []).map((v) => [v.key, v.value]));

  const body = jsonBodyOf(op.op);
  const missing = missingRequired(op, draft);
  const invalidBody = bodyError(draft);
  const request = buildRequest(doc, op, draft, { serverIndex, vars, baseUrl: env?.baseUrl || undefined });
  const pathParams = op.parameters.filter((p) => p.in === 'path');
  const otherParams = op.parameters.filter((p) => p.in !== 'path' && p.in !== 'cookie');
  const declaredHeaders = new Set(op.parameters.filter((p) => p.in === 'header').map((p) => p.name.toLowerCase()));

  const send = async () => {
    setTouched(true);
    if (missing.length || sending) return;
    setSending(true);
    try {
      const response =
        source.kind === 'mock'
          ? await client.mock({ method: request.method, url: mockPath(op, draft, vars), body: request.body, operationId: op.id })
          : await client.proxy(request);
      onRun({ response, at: Date.now() });
    } catch (err) {
      onRun({ error: err instanceof ApiError ? err.message : String(err), at: Date.now() });
    } finally {
      setSending(false);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  };

  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void sendRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setTouched(false), [op.id]);

  const copyCurl = async () => {
    await navigator.clipboard.writeText(toCurl(request, curlBase));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const setHeader = (i: number, patch: Partial<HeaderRow>) =>
    onDraft({ ...draft, headers: draft.headers.map((h, j) => (j === i ? { ...h, ...patch } : h)) });

  const headerValue = (name: string) => draft.headers.find((h) => h.key.toLowerCase() === name.toLowerCase());
  const setNamedHeader = (name: string, value: string) => {
    const idx = draft.headers.findIndex((h) => h.key.toLowerCase() === name.toLowerCase());
    if (idx === -1) onDraft({ ...draft, headers: [...draft.headers, { key: name, value, enabled: true }] });
    else setHeader(idx, { value, enabled: value !== '' || draft.headers[idx]!.enabled });
  };

  const segments = op.path.split(/(\{[^}]+\})/g);
  const specBase = doc.servers?.[serverIndex]?.url.replace(/\/+$/, '') ?? '';
  const base = env ? env.baseUrl.replace(/\/+$/, '') : specBase;
  const previewUrl = source.kind === 'mock' ? mockPath(op, draft, vars) : request.url;
  const query = previewUrl.includes('?') ? previewUrl.slice(previewUrl.indexOf('?')) : '';

  return (
    <article aria-labelledby={`op-${op.id}`} className="pb-24">
      <header className="mt-10">
        <h2 id={`op-${op.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-lg font-semibold tracking-[-0.01em]">
          <span className="text-ink-3">{op.section}.</span>
          <span>{op.method}</span>
          <span className="break-all">{op.path}</span>
        </h2>
        <p className="mt-1 font-mono text-xs text-ink-3">
          operationId {op.id}
          {op.op.deprecated && <span className="keyword ml-3 text-warn">DEPRECATED</span>}
        </p>
        {op.op.summary && <p className="mt-4 text-lg text-ink">{op.op.summary}</p>}
        {op.op.description && <p className="mt-2 max-w-[70ch] whitespace-pre-line text-ink-2">{op.op.description}</p>}
      </header>

      <section aria-label="Request">
        <SubHeading number={`${op.section}.1`}>Request</SubHeading>

        <div className="rounded-[4px] border border-rule bg-sheet px-4 py-3">
          <p className="flex flex-wrap items-center gap-y-1 font-mono text-[0.875rem] leading-7">
            <span className="mr-2 font-semibold">{op.method}</span>
            {source.kind === 'mock' ? (
              <span className="mr-1 rounded-[3px] border border-rule bg-paper px-1.5 text-[0.6875rem] font-semibold tracking-wide text-ink-2">MOCK</span>
            ) : (
              <span className="text-ink-2">{base}</span>
            )}
            {segments.map((seg, i) => {
              const m = /^\{(.+)\}$/.exec(seg);
              if (!m) return <span key={i}>{seg}</span>;
              const name = m[1]!;
              const value = draft.path[name] ?? '';
              const invalid = touched && !value;
              return (
                <label key={i} className="inline-flex items-center">
                  <span className="sr-only">Path parameter {name}</span>
                  <input
                    ref={(el) => {
                      if (el) pathInputs.current.set(name, el);
                    }}
                    value={value}
                    placeholder={name}
                    aria-invalid={invalid}
                    size={Math.max(value.length, name.length, 2)}
                    onChange={(e) => onDraft({ ...draft, path: { ...draft.path, [name]: e.target.value } })}
                    className="field mx-0.5 px-1.5 py-0 text-[0.875rem] text-link"
                  />
                </label>
              );
            })}
            <span className="break-all text-ink-2">{query}</span>
          </p>
        </div>

        {(pathParams.length > 0 || otherParams.length > 0) && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <caption className="sr-only">Parameters</caption>
              <thead>
                <tr className="border-b border-rule-strong font-mono text-xs text-ink-3">
                  <th scope="col" className="py-2 pr-4 font-normal">Name</th>
                  <th scope="col" className="py-2 pr-4 font-normal">In</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Type</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Value</th>
                </tr>
              </thead>
              <tbody>
                {[...pathParams, ...otherParams].map((p) => (
                  <ParamRow
                    key={`${p.in}:${p.name}`}
                    doc={doc}
                    param={p}
                    touched={touched}
                    value={p.in === 'path' ? draft.path[p.name] ?? '' : p.in === 'query' ? draft.query[p.name] ?? '' : headerValue(p.name)?.value ?? ''}
                    onChange={(v) =>
                      p.in === 'query' ? onDraft({ ...draft, query: { ...draft.query, [p.name]: v } }) : setNamedHeader(p.name, v)
                    }
                    onFocusPath={() => pathInputs.current.get(p.name)?.focus()}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="rule-label">Headers</p>
            <button
              type="button"
              className="btn btn-quiet px-1.5 py-0.5 text-xs"
              onClick={() => onDraft({ ...draft, headers: [...draft.headers, { key: '', value: '', enabled: true }] })}
            >
              <Plus aria-hidden size={13} /> Add header
            </button>
          </div>
          {draft.headers.filter((h) => !declaredHeaders.has(h.key.toLowerCase())).length === 0 ? (
            <p className="text-sm text-ink-3">No extra headers. Authorization, API keys and cookies are stored as [redacted] in history.</p>
          ) : (
            <ul className="space-y-1.5">
              {draft.headers.map((h, i) =>
                declaredHeaders.has(h.key.toLowerCase()) ? null : (
                  <li key={i} className="grid grid-cols-[auto_minmax(8rem,14rem)_1fr_auto] items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`Send header ${h.key || i + 1}`}
                      checked={h.enabled}
                      onChange={(e) => setHeader(i, { enabled: e.target.checked })}
                      className="size-4 accent-link"
                    />
                    <input aria-label="Header name" className="field" placeholder="name" value={h.key} onChange={(e) => setHeader(i, { key: e.target.value })} />
                    <input aria-label="Header value" className="field" placeholder="value" value={h.value} onChange={(e) => setHeader(i, { value: e.target.value })} />
                    <button
                      type="button"
                      aria-label={`Remove header ${h.key}`}
                      className="btn btn-quiet p-1"
                      onClick={() => onDraft({ ...draft, headers: draft.headers.filter((_, j) => j !== i) })}
                    >
                      <X aria-hidden size={14} />
                    </button>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>

        {body && (
          <div className="mt-6">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor={`body-${op.id}`} className="rule-label">
                Body · {body.contentType} · {schemaLabel(doc, body.media.schema)}
              </label>
              <Requirement required={op.op.requestBody?.required} />
            </div>
            <textarea
              id={`body-${op.id}`}
              value={draft.body}
              spellCheck={false}
              aria-invalid={!!invalidBody}
              aria-describedby={invalidBody ? `body-err-${op.id}` : undefined}
              onChange={(e) => onDraft({ ...draft, body: e.target.value })}
              rows={Math.min(Math.max(draft.body.split('\n').length + 1, 4), 22)}
              className="field block w-full resize-y px-3 py-2 leading-[1.6]"
            />
            {invalidBody && (
              <p id={`body-err-${op.id}`} className="mt-1.5 font-mono text-xs text-err">
                Body is not valid JSON: {invalidBody}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={send} disabled={sending} aria-keyshortcuts="Control+Enter Meta+Enter">
            <Send aria-hidden size={14} />
            {sending ? 'Sending…' : 'Send request'}
            <kbd className="ml-1 font-mono text-[0.6875rem] opacity-80">{isMac ? '⌘↵' : 'Ctrl+↵'}</kbd>
          </button>
          <label className="flex items-center gap-2 font-mono text-xs text-ink-3">
            via
            <select
              className="field w-auto px-2 py-1 text-xs"
              aria-label="Send source"
              value={source.kind === 'env' ? `env:${source.envId}` : source.kind}
              onChange={(e) => {
                const v = e.target.value;
                onSource(v === 'mock' ? { kind: 'mock' } : v.startsWith('env:') ? { kind: 'env', envId: v.slice(4) } : { kind: 'local' });
              }}
            >
              <option value="local">target server</option>
              <option value="mock">mock (from spec)</option>
              {envs.map((e) => (
                <option key={e.id} value={`env:${e.id}`}>
                  env: {e.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={copyCurl}>
            {copied ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
            {copied ? 'Copied' : 'Copy as cURL'}
          </button>
          <span className="relative">
            <button type="button" className="btn" onClick={() => setSaving((v) => !v)} aria-expanded={saving}>
              <Save aria-hidden size={14} /> Save
            </button>
            {saving && (
              <form
                className="absolute left-0 top-[110%] z-10 flex w-64 flex-col gap-2 rounded-[4px] border border-rule bg-paper p-3 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (saveName.trim()) {
                    onSave(saveName.trim());
                    setSaveName('');
                    setSaving(false);
                  }
                }}
              >
                <label className="rule-label" htmlFor={`save-${op.id}`}>
                  Request name
                </label>
                <input
                  id={`save-${op.id}`}
                  autoFocus
                  className="field"
                  placeholder={`${op.method} ${op.path}`}
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
                <div className="flex gap-2">
                  <button type="submit" className="btn btn-primary text-xs" disabled={!saveName.trim()}>
                    Save to collection
                  </button>
                  <button type="button" className="btn text-xs" onClick={() => setSaving(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </span>
          {touched && missing.length > 0 && (
            <p role="alert" className="text-sm text-err">
              Fill the required {missing.length > 1 ? 'parameters' : 'parameter'} {missing.join(', ')} first.
            </p>
          )}
        </div>
      </section>

      <section aria-label="Responses">
        <SubHeading number={`${op.section}.2`}>Responses</SubHeading>
        <ResponsesTable doc={doc} op={op} />
      </section>

      <section ref={resultRef} aria-label="Result" aria-live="polite">
        <SubHeading number={`${op.section}.3`}>Result</SubHeading>
        {sending && !run?.response ? (
          <div className="space-y-2" aria-busy>
            <div className="h-5 w-40 animate-pulse rounded-[3px] bg-sheet" />
            <div className="h-24 animate-pulse rounded-[3px] bg-sheet" />
          </div>
        ) : run?.error ? (
          <p className="rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{run.error}</p>
        ) : run?.response ? (
          <div className={sending ? 'opacity-60 transition-opacity' : ''}>
            <HttpResponseView response={run.response} declared={isDeclared(op, run.response.status)} />
          </div>
        ) : (
          <p className="text-sm text-ink-3">
            Nothing sent yet. Fill the request above and press {isMac ? '⌘↵' : 'Ctrl+Enter'}; the response is checked against §{op.section}.2.
          </p>
        )}
      </section>
    </article>
  );
}

function ParamRow({
  doc,
  param,
  value,
  onChange,
  touched,
  onFocusPath,
}: {
  doc: OpenAPIDoc;
  param: Parameter;
  value: string;
  onChange: (v: string) => void;
  touched: boolean;
  onFocusPath: () => void;
}) {
  const schema = param.schema ? resolveRef(doc, param.schema) : undefined;
  const id = `param-${param.in}-${param.name}`;
  const invalid = touched && param.required && !value;
  return (
    <tr className="border-b border-rule align-top">
      <td className="py-2.5 pr-4">
        <label htmlFor={id} className={`font-mono text-[0.8125rem] font-semibold ${param.deprecated ? 'line-through' : ''}`}>
          {param.name}
        </label>
        <div className="mt-0.5">
          <Requirement required={param.required} />
        </div>
      </td>
      <td className="py-2.5 pr-4 font-mono text-xs text-ink-2">{param.in}</td>
      <td className="py-2.5 pr-4">
        <span className="font-mono text-xs text-ink-2">{schemaLabel(doc, param.schema)}</span>
        {(param.description ?? schema?.description) && (
          <p className="mt-1 max-w-[40ch] text-[0.8125rem] text-ink-3">{param.description ?? schema?.description}</p>
        )}
      </td>
      <td className="w-[38%] py-2 pr-1">
        {param.in === 'path' ? (
          <button type="button" className="rule-label text-left hover:text-link" onClick={onFocusPath}>
            {value ? <span className="text-ink">{value}</span> : 'Set in the request line'}
          </button>
        ) : schema?.enum ? (
          <select id={id} className="field w-full" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid}>
            <option value="">—</option>
            {schema.enum.map((v) => (
              <option key={String(v)} value={String(v)}>
                {String(v)}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            className="field w-full"
            value={value}
            aria-invalid={invalid}
            placeholder={schema?.example !== undefined ? String(schema.example) : schema?.default !== undefined ? String(schema.default) : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </td>
    </tr>
  );
}

function ResponsesTable({ doc, op }: { doc: OpenAPIDoc; op: Operation }) {
  const responses = Object.entries(op.op.responses ?? {});
  const [open, setOpen] = useState<string | null>(null);
  if (!responses.length) return <p className="text-sm text-ink-3">This operation declares no responses.</p>;
  return (
    <ul className="border-t border-rule">
      {responses.map(([status, raw]) => {
        const res = resolveRef(doc, raw);
        const media = res.content ? Object.entries(res.content)[0] : undefined;
        const code = Number(status);
        const tone = code >= 500 ? 'text-err' : code >= 400 ? 'text-warn' : 'text-ok';
        const example = media?.[1].schema ? JSON.stringify(sampleSafe(doc, media[1]), null, 2) : undefined;
        return (
          <li key={status} className="border-b border-rule">
            <div className="grid grid-cols-[4rem_1fr_auto] items-baseline gap-3 py-2.5">
              <span className={`font-mono text-sm font-semibold ${Number.isNaN(code) ? 'text-ink' : tone}`}>{status}</span>
              <p className="min-w-0 text-sm">
                <span className="text-ink">{res.description}</span>
                {media && (
                  <span className="ml-2 font-mono text-xs text-ink-3">
                    {media[0]} · {schemaLabel(doc, media[1].schema)}
                  </span>
                )}
              </p>
              {example ? (
                <button
                  type="button"
                  className="rule-label hover:text-link"
                  aria-expanded={open === status}
                  onClick={() => setOpen(open === status ? null : status)}
                >
                  {open === status ? 'Hide example' : 'Example'}
                </button>
              ) : (
                <span />
              )}
            </div>
            {open === status && example && (
              <div className="mb-3 rounded-[3px] bg-sheet px-4 py-3">
                <CodeBlock label={`Example ${status} body`} text={example} json className="max-h-80" />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const sampleSafe = (doc: OpenAPIDoc, media: MediaType) => media.example ?? sampleFromSchema(doc, media.schema);
