import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DesignView } from './components/DesignView';
import { FrontMatter } from './components/FrontMatter';
import { HistoryView } from './components/HistoryView';
import { OperationView, type RunState, type SendSource } from './components/OperationView';
import { SavedView } from './components/SavedView';
import { SetupView } from './components/SetupView';
import { SpecView } from './components/SpecView';
import { TestsView } from './components/TestsView';
import { Toc } from './components/Toc';
import { ApiError, client, type Collection, type Config, type Environment } from './lib/api';
import { buildRequest, initialDraft, type Draft } from './lib/request';
import { buildSections, type OpenAPIDoc, type Operation } from './lib/spec';

const ReferenceView = lazy(() => import('./components/ReferenceView'));

type Route =
  | { view: 'op'; id?: string }
  | { view: 'reference' }
  | { view: 'history'; id?: string }
  | { view: 'tests' }
  | { view: 'spec' }
  | { view: 'design' }
  | { view: 'setup' }
  | { view: 'saved'; collectionId: string; requestId: string };

function parseHash(hash: string): Route {
  const [, view, a, b] = hash.replace(/^#\/?/, '/').split('/');
  const decoded = a ? decodeURIComponent(a) : undefined;
  if (view === 'reference') return { view: 'reference' };
  if (view === 'history') return { view: 'history', id: decoded };
  if (view === 'tests') return { view: 'tests' };
  if (view === 'spec') return { view: 'spec' };
  if (view === 'design') return { view: 'design' };
  if (view === 'setup') return { view: 'setup' };
  if (view === 'saved' && a && b) return { view: 'saved', collectionId: decoded!, requestId: decodeURIComponent(b) };
  return { view: 'op', id: decoded };
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const [config, setConfig] = useState<Config | null>(null);
  const [doc, setDoc] = useState<OpenAPIDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [serverIndex, setServerIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [tocOpen, setTocOpen] = useState(false);
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [source, setSource] = useState<SendSource>(() => {
    try {
      return JSON.parse(localStorage.getItem('apidock.source') ?? 'null') ?? { kind: 'local' };
    } catch {
      return { kind: 'local' };
    }
  });
  const main = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    try {
      const [c, d, e, cols] = await Promise.all([client.config(), client.spec(), client.environments(), client.collections()]);
      setConfig(c);
      setDoc(d);
      setEnvs(e);
      setCollections(cols);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const changeSource = (s: SendSource) => {
    setSource(s);
    localStorage.setItem('apidock.source', JSON.stringify(s));
  };

  const reload = async () => {
    setReloading(true);
    await client.reload().catch(() => undefined);
    await load();
    setReloading(false);
  };

  const sections = useMemo(() => (doc ? buildSections(doc) : []), [doc]);
  const operations = useMemo(() => new Map(sections.flatMap((s) => s.operations.map((o) => [o.id, o] as const))), [sections]);
  const current: Operation | undefined =
    route.view === 'op' ? (route.id ? operations.get(route.id) : sections[0]?.operations[0]) : undefined;

  useEffect(() => {
    if (doc) document.title = `${current ? `${current.method} ${current.path} · ` : ''}${doc.info.title} · ApiDock`;
  }, [doc, current]);

  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
    setTocOpen(false);
  }, [route]);

  if (error && !doc) {
    return (
      <main className="mx-auto mt-[18vh] max-w-xl px-6">
        <h1 className="font-mono text-lg font-semibold">ApiDock could not load the spec</h1>
        <p className="mt-3 rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{error}</p>
        <p className="mt-4 text-sm text-ink-2">Check that the backend is running and that its OpenAPI document is valid, then try again.</p>
        <button type="button" className="btn mt-6" onClick={() => void load()}>
          Try again
        </button>
      </main>
    );
  }

  if (!doc || !config) {
    return (
      <div className="grid h-dvh place-items-center" aria-busy>
        <p className="font-mono text-sm text-ink-3">Loading spec…</p>
      </div>
    );
  }

  const draft = current ? (drafts[current.id] ?? initialDraft(doc, current)) : undefined;
  const curlBase = config.mode === 'embedded' || !config.target ? window.location.origin : config.target;
  // A saved env might have been deleted since the source was persisted.
  const effectiveSource: SendSource = source.kind === 'env' && !envs.some((e) => e.id === source.envId) ? { kind: 'local' } : source;

  const saveToCollection = (op: Operation, name: string) => {
    const d = drafts[op.id] ?? initialDraft(doc, op);
    const req = buildRequest(doc, op, d, { serverIndex });
    const saved = { id: crypto.randomUUID(), name, method: req.method, url: req.url, headers: req.headers, body: req.body, createdAt: new Date().toISOString() };
    const cols = collections.length
      ? collections.map((c, i) => (i === 0 ? { ...c, requests: [...c.requests, saved] } : c))
      : [{ id: crypto.randomUUID(), name: 'Default', requests: [saved] }];
    void client.saveCollections(cols).then(setCollections);
  };

  const savedRoute = route.view === 'saved' ? route : undefined;
  const savedItem = savedRoute
    ? (() => {
        const col = collections.find((c) => c.id === savedRoute.collectionId);
        const req = col?.requests.find((r) => r.id === savedRoute.requestId);
        return col && req ? { col, req } : undefined;
      })()
    : undefined;

  const tabs = [
    { href: '#/', label: 'Sections', active: route.view === 'op' || route.view === 'saved' },
    { href: '#/reference', label: 'Reference', active: route.view === 'reference' },
    { href: '#/history', label: 'History', active: route.view === 'history' },
    { href: '#/tests', label: 'Tests', active: route.view === 'tests' },
    { href: '#/spec', label: 'Spec', active: route.view === 'spec' },
    { href: '#/design', label: 'Design', active: route.view === 'design' },
    { href: '#/setup', label: 'Setup', active: route.view === 'setup' },
  ];

  const toc = <Toc sections={sections} currentId={current?.id} onNavigate={() => setTocOpen(false)} collections={collections} />;

  return (
    <div className="lg:grid lg:h-dvh lg:grid-cols-[19rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:bg-paper focus:px-3 focus:py-2">
        Skip to content
      </a>

      <aside className="hidden min-h-0 flex-col border-r border-rule bg-sheet pt-5 lg:flex">
        <p className="mb-4 px-6 font-mono text-sm">
          <span className="font-semibold">ApiDock</span> <span className="text-ink-3">{config.version}</span>
        </p>
        <p className="mb-2 px-6 font-mono text-xs text-ink-3">Table of Contents</p>
        {toc}
      </aside>

      <main id="main" ref={main} className="min-w-0 lg:overflow-y-auto">
        <div className="mx-auto max-w-[60rem] px-4 pt-6 sm:px-8">
          <div className="mb-6 flex items-center justify-between lg:hidden">
            <p className="font-mono text-sm">
              <span className="font-semibold">ApiDock</span> <span className="text-ink-3">{config.version}</span>
            </p>
            <button type="button" className="btn" aria-expanded={tocOpen} aria-controls="mobile-toc" onClick={() => setTocOpen((v) => !v)}>
              Contents
            </button>
          </div>
          {tocOpen && (
            <div id="mobile-toc" className="mb-6 max-h-[60vh] overflow-y-auto rounded-[4px] border border-rule bg-sheet pt-3 lg:hidden">
              {toc}
            </div>
          )}

          <FrontMatter
            config={config}
            doc={doc}
            serverIndex={serverIndex}
            onServerChange={setServerIndex}
            onReload={reload}
            reloading={reloading}
          />

          <nav aria-label="Views" className="flex items-center gap-6 border-b border-rule">
            {tabs.map((t) => (
              <a
                key={t.href}
                href={t.href}
                aria-current={t.active ? 'page' : undefined}
                className={`-mb-px border-b-2 py-3 text-sm font-medium no-underline transition-colors duration-150 ${
                  t.active ? 'border-link text-link' : 'border-transparent text-ink-2 hover:text-ink'
                }`}
              >
                {t.label}
              </a>
            ))}
            <span className="ml-auto flex gap-3 font-mono text-xs">
              <a href="api/spec" target="_blank" rel="noreferrer">
                openapi.json
              </a>
              <a href="api/spec?format=yaml" target="_blank" rel="noreferrer">
                .yaml
              </a>
            </span>
          </nav>

          {route.view === 'reference' ? (
            <Suspense fallback={<p className="mt-10 font-mono text-sm text-ink-3">Loading reference…</p>}>
              <ReferenceView doc={doc} />
            </Suspense>
          ) : route.view === 'history' ? (
            <HistoryView operations={operations} selectedId={route.id} />
          ) : route.view === 'tests' ? (
            <TestsView />
          ) : route.view === 'spec' ? (
            <SpecView />
          ) : route.view === 'design' ? (
            <DesignView />
          ) : route.view === 'setup' ? (
            <SetupView envs={envs} onEnvs={setEnvs} collections={collections} onCollections={setCollections} />
          ) : savedItem ? (
            <SavedView request={savedItem.req} collectionName={savedItem.col.name} envs={envs} />
          ) : current && draft ? (
            <OperationView
              key={current.id}
              doc={doc}
              op={current}
              draft={draft}
              onDraft={(d) => setDrafts((all) => ({ ...all, [current.id]: d }))}
              run={runs[current.id]}
              onRun={(r) => setRuns((all) => ({ ...all, [current.id]: r }))}
              serverIndex={serverIndex}
              curlBase={curlBase}
              source={effectiveSource}
              envs={envs}
              onSource={changeSource}
              onSave={(name) => saveToCollection(current, name)}
            />
          ) : (
            <div className="mt-10 pb-24">
              <h2 className="font-mono text-lg font-semibold">{sections.length ? 'No such section' : 'This spec has no operations'}</h2>
              <p className="mt-2 max-w-[70ch] text-ink-2">
                {sections.length
                  ? `There is no operation “${route.view === 'op' ? route.id : ''}” in this spec. It may have been renamed; pick one from the table of contents.`
                  : 'Add routes to your contract with defineApi() and reload. Every operation becomes a numbered section here.'}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
