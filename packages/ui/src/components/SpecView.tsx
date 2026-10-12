import { Camera, Download, GitCompareArrows, Search, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, client, type ChangeLevel, type DiffReport, type SpecSnapshot } from '../lib/api';

const when = (iso: string) => new Date(iso).toLocaleString([], { hour12: false });

const levelStyle: Record<ChangeLevel, string> = {
  breaking: 'bg-err-wash text-err',
  warning: 'bg-warn-wash text-warn',
  addition: 'bg-sheet text-ok',
};

function SpecDocument() {
  const [format, setFormat] = useState<'json' | 'yaml'>('json');
  const [text, setText] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(null);
    fetch(`api/spec${format === 'yaml' ? '?format=yaml' : ''}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        const raw = await r.text();
        return format === 'json' ? JSON.stringify(JSON.parse(raw), null, 2) : raw;
      })
      .then(setText)
      .catch((e) => setError(String(e)));
  }, [format]);

  const lines = useMemo(() => (text ?? '').split('\n'), [text]);
  const matchSet = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    const hits = new Set<number>();
    lines.forEach((l, i) => {
      if (l.toLowerCase().includes(q)) for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j++) hits.add(j);
    });
    return hits;
  }, [lines, query]);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-[4px] border border-rule font-mono text-xs" role="group" aria-label="Spec format">
          {(['json', 'yaml'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={format === f}
              className={`px-2.5 py-1 ${format === f ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'}`}
              onClick={() => setFormat(f)}
            >
              .{f}
            </button>
          ))}
        </div>
        <label className="relative flex-1 sm:max-w-xs">
          <Search aria-hidden size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-3" />
          <input
            className="field w-full pl-7 font-mono text-xs"
            placeholder="Filter lines — e.g. operationId"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {matchSet && <span className="font-mono text-xs text-ink-3">{matchSet.size} lines</span>}
        <a className="btn btn-quiet ml-auto text-xs" href={format === 'yaml' ? 'api/spec?format=yaml' : 'api/spec'} download={`openapi.${format}`}>
          <Download aria-hidden size={13} /> Download .{format}
        </a>
      </div>
      {error && <p className="mt-4 rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{error}</p>}
      {text === null && !error ? (
        <div className="mt-4 h-48 animate-pulse rounded-[3px] bg-sheet" aria-busy />
      ) : (
        <pre
          className="mt-4 max-h-[30rem] overflow-auto rounded-[4px] border border-rule bg-sheet p-4 font-mono text-[0.75rem] leading-5"
          tabIndex={0}
        >
          {lines.map((line, i) => (
            <div key={i} className={matchSet && !matchSet.has(i) ? 'hidden' : undefined}>
              <span className="mr-3 inline-block w-8 text-right text-ink-3 select-none">{i + 1}</span>
              {line}
            </div>
          ))}
        </pre>
      )}
    </>
  );
}

function DiffReportView({ report }: { report: DiffReport }) {
  return (
    <div className="mt-4">
      <p role="status" className={`font-mono text-sm font-semibold ${report.ok ? 'text-ok' : 'text-err'}`}>
        {report.ok ? 'No breaking changes.' : `${report.breaking.length} breaking change${report.breaking.length === 1 ? '' : 's'}`}
        <span className="font-normal text-ink-3">
          {' '}
          · {report.changes.length} total · {report.warnings.length} warnings · {report.additions.length} additions
        </span>
      </p>
      {report.changes.length > 0 && (
        <ul className="mt-3 border-t border-rule font-mono text-[0.8125rem]">
          {[...report.breaking, ...report.warnings, ...report.additions].map((c, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-2 border-b border-rule py-2">
              <span className={`rounded-[3px] px-1.5 py-0.5 text-xs ${levelStyle[c.level]}`}>{c.level}</span>
              <span className="font-semibold">{c.at}</span>
              <span className="text-ink-2">{c.message}</span>
              <span className="ml-auto text-xs text-ink-3">{c.rule}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DiffSection() {
  const [snapshots, setSnapshots] = useState<SpecSnapshot[] | null>(null);
  const [against, setAgainst] = useState('');
  const [report, setReport] = useState<DiffReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    client
      .snapshots()
      .then((s) => {
        setSnapshots(s);
        setError(null);
      })
      .catch((err: ApiError) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  const snapshot = async () => {
    setBusy('snap');
    const auto = `spec @ ${new Date().toLocaleString([], { hour12: false })}`;
    await client.createSnapshot(auto).catch((err: ApiError) => setError(err.message));
    load();
    setBusy(null);
  };

  const runDiff = async (opts: { snapshot?: string; specText?: string }) => {
    setBusy('diff');
    try {
      setReport(await client.diff(opts));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void file.text().then((specText) => runDiff({ specText }));
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <>
      <div className="mt-10 mb-4">
        <h3 className="font-mono text-sm font-semibold">
          <span className="text-ink-3">P.2.</span> Diff &amp; snapshots
        </h3>
        <p className="mt-1 max-w-[70ch] text-sm text-ink-2">
          Compare the live spec against a stored snapshot or an uploaded file. Removed operations, newly required inputs and narrowed response
          schemas are flagged <span className="font-mono">breaking</span>. For CI, use <code className="font-mono">apidock diff old.yaml new.yaml</code>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn" disabled={busy === 'snap'} onClick={() => void snapshot()}>
          <Camera aria-hidden size={14} /> {busy === 'snap' ? 'Saving…' : 'Snapshot current spec'}
        </button>
        <button type="button" className="btn" disabled={busy === 'diff'} onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden size={14} /> Diff an uploaded spec
        </button>
        <input ref={fileRef} type="file" accept=".json,.yaml,.yml,text/*" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      {snapshots === null ? (
        <p className="mt-4 text-sm text-ink-3" aria-busy>
          Loading snapshots…
        </p>
      ) : snapshots.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">No snapshots yet. Save one before a change, then diff future versions against it.</p>
      ) : (
        <ul className="mt-4 border-t border-rule">
          {snapshots.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-3 border-b border-rule py-2.5 font-mono text-[0.8125rem]">
              <input
                type="radio"
                name="diff-against"
                aria-label={`Diff against ${s.name}`}
                className="size-4 accent-link"
                checked={against === s.id}
                onChange={() => setAgainst(s.id)}
              />
              <span className="font-semibold">{s.name}</span>
              <span className="text-ink-3">
                <time dateTime={s.at}>{when(s.at)}</time>
              </span>
              <button
                type="button"
                aria-label={`Delete snapshot ${s.name}`}
                className="btn btn-quiet ml-auto p-1 text-ink-3 hover:text-err"
                onClick={() => void client.deleteSnapshot(s.id).then(load)}
              >
                <Trash2 aria-hidden size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {against && (
        <button type="button" className="btn btn-primary mt-4" disabled={busy === 'diff'} onClick={() => void runDiff({ snapshot: against })}>
          <GitCompareArrows aria-hidden size={14} /> {busy === 'diff' ? 'Diffing…' : 'Diff snapshot → current spec'}
        </button>
      )}
      {error && <p className="mt-4 rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{error}</p>}
      {report && <DiffReportView report={report} />}
    </>
  );
}

export function SpecView() {
  return (
    <section aria-labelledby="spec-title" className="mt-10 pb-24">
      <h2 id="spec-title" className="font-mono text-lg font-semibold">
        Spec
      </h2>
      <p className="mt-2 max-w-[70ch] text-sm text-ink-2">The OpenAPI 3.1 document as served — searchable, downloadable, diffable.</p>
      <div className="mt-10 mb-4">
        <h3 className="font-mono text-sm font-semibold">
          <span className="text-ink-3">P.1.</span> Document
        </h3>
      </div>
      <SpecDocument />
      <DiffSection />
    </section>
  );
}
