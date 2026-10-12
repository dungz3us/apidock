import { FilePlus2, Play, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  client,
  type ContractRunReport,
  type Scenario,
  type ScenarioReport,
  type Violation,
} from '../lib/api';

const when = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });

const EXAMPLE_SCENARIO = `{
  "name": "create then read",
  "vars": { "mail": "editor@example.com" },
  "steps": [
    {
      "id": "create",
      "request": { "method": "POST", "url": "/api/users", "body": "{ \\"name\\": \\"Doc\\", \\"email\\": \\"{{mail}}\\" }" },
      "extract": { "newId": "$.id" },
      "expect": { "status": 201 }
    },
    {
      "id": "read",
      "request": { "method": "GET", "url": "/api/users/{{newId}}" },
      "expect": { "status": 200, "matchSpec": true }
    }
  ]
}`;

function Section({ number, title, hint, children }: { number: string; title: string; hint: string; children?: React.ReactNode }) {
  return (
    <div className="mt-10 mb-4">
      <h3 className="font-mono text-sm font-semibold">
        <span className="text-ink-3">{number}.</span> {title}
      </h3>
      <p className="mt-1 max-w-[70ch] text-sm text-ink-2">{hint}</p>
      {children}
    </div>
  );
}

const kindLabel: Record<Violation['kind'], string> = {
  'request-schema': 'request schema',
  'response-schema': 'response schema',
  'undeclared-status': 'undeclared status',
  'contract-run': 'contract run',
};

function ContractRunSection() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ContractRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      setReport(await client.contractRun());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Section
        number="T.1"
        title="Contract run"
        hint="Sends a generated request for every operation in the spec (examples or mock data) and checks the live status and body against the declared responses. Same as `apidock test` from the CLI."
      />
      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={running} onClick={() => void run()}>
          <Play aria-hidden size={14} /> {running ? 'Running…' : report ? 'Run again' : 'Run all operations'}
        </button>
        {report && (
          <p role="status" className="font-mono text-xs text-ink-3">
            {report.total} operations · <span className="text-ok">{report.passed} passed</span>
            {report.failed > 0 && <span className="text-err"> · {report.failed} failed</span>}
          </p>
        )}
      </div>
      {error && <p className="mt-4 rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{error}</p>}
      {report && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <caption className="sr-only">Contract run results</caption>
            <thead>
              <tr className="border-b border-rule-strong font-mono text-xs text-ink-3">
                <th scope="col" className="py-2 pr-4 font-normal">Result</th>
                <th scope="col" className="py-2 pr-4 font-normal">Operation</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Status</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Time</th>
                <th scope="col" className="py-2 font-normal">Findings</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[0.8125rem]">
              {report.results.map((r, i) => (
                <tr key={i} className="border-b border-rule align-top">
                  <td className={`py-2 pr-4 font-semibold ${r.ok ? 'text-ok' : 'text-err'}`}>{r.ok ? 'PASS' : 'FAIL'}</td>
                  <td className="py-2 pr-4">
                    <span className="font-semibold">{r.method}</span> {r.path}
                    {r.operationId && <span className="text-ink-3"> · {r.operationId}</span>}
                  </td>
                  <td className="py-2 pr-4 text-right">{r.status ?? '—'}</td>
                  <td className="py-2 pr-4 text-right text-ink-3">{r.durationMs !== undefined ? `${r.durationMs} ms` : '—'}</td>
                  <td className="py-2 text-ink-2">
                    {r.error && <p className="text-err">{r.error}</p>}
                    {r.issues.map((iss, j) => (
                      <p key={j}>
                        <span className="text-ink-3">[{iss.location}]</span> {iss.path} {iss.message}
                      </p>
                    ))}
                    {r.ok && <span className="text-ink-3">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ScenarioRow({ scenario, onDeleted }: { scenario: Scenario & { id: string }; onDeleted: (id: string) => void }) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ScenarioReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      setReport(await client.runScenario(scenario, scenario.baseUrl));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <li className="border-b border-rule py-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h4 className="font-mono text-sm font-semibold">
          {scenario.name} <span className="font-normal text-ink-3">· {scenario.steps.length} step{scenario.steps.length === 1 ? '' : 's'}</span>
        </h4>
        <span className="ml-auto flex gap-2">
          <button type="button" className="btn btn-quiet px-1.5 py-0.5 text-xs" disabled={running} onClick={() => void run()}>
            <Play aria-hidden size={12} /> {running ? 'Running…' : 'Run'}
          </button>
          <button type="button" className="btn btn-quiet px-1.5 py-0.5 text-xs text-err" onClick={() => onDeleted(scenario.id)}>
            <Trash2 aria-hidden size={12} /> Delete
          </button>
        </span>
      </div>
      {error && <p className="mt-2 rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{error}</p>}
      {report && (
        <ol className="mt-2 space-y-1 font-mono text-[0.8125rem]">
          <li className={`font-semibold ${report.ok ? 'text-ok' : 'text-err'}`}>
            {report.ok ? 'PASSED' : 'FAILED'} in {report.durationMs} ms
          </li>
          {report.steps.map((s) => (
            <li key={s.id} className={s.ok ? 'text-ink-2' : 'text-err'}>
              {s.ok ? '✓' : '✗'} {s.id}
              {s.status !== undefined && <span className="text-ink-3"> → {s.status}</span>}
              {s.extracted && <span className="text-ink-3"> · extracted {Object.keys(s.extracted).join(', ')}</span>}
              {s.error && <span> · {s.error}</span>}
              {s.issues.map((iss, j) => (
                <span key={j} className="block pl-5 text-err">
                  {iss.path} {iss.message}
                </span>
              ))}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function ScenariosSection() {
  const [scenarios, setScenarios] = useState<(Scenario & { id: string })[] | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .scenarios()
      .then(setScenarios)
      .catch((err: ApiError) => setError(err.message));
  }, []);

  const saveDraft = async () => {
    if (draft === null) return;
    try {
      const parsed = JSON.parse(draft) as Scenario;
      if (!parsed.name || !Array.isArray(parsed.steps)) throw new Error('A scenario needs "name" and "steps"');
      const next = [...(scenarios ?? []), { ...parsed, id: crypto.randomUUID() }];
      setScenarios(await client.saveScenarios(next));
      setDraft(null);
      setDraftError(null);
    } catch (err) {
      setDraftError(err instanceof ApiError || err instanceof SyntaxError ? err.message : (err as Error).message);
    }
  };

  const remove = async (id: string) => {
    if (!scenarios) return;
    setScenarios(await client.saveScenarios(scenarios.filter((s) => s.id !== id)).catch(() => scenarios));
  };

  return (
    <>
      <Section
        number="T.2"
        title="Scenarios"
        hint="Ordered multi-step flows. Each step can extract values (JSONPath, e.g. $.id) into variables and assert status, body fields, latency or the spec's response schema. Failed steps stop the run."
      />
      {error && <p className="rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{error}</p>}
      {scenarios === null ? (
        <p className="text-sm text-ink-3" aria-busy>
          Loading scenarios…
        </p>
      ) : scenarios.length === 0 && draft === null ? (
        <p className="text-sm text-ink-3">No scenarios yet. Write one as JSON to define a reusable multi-step flow.</p>
      ) : (
        <ul className="border-t border-rule">
          {scenarios.map((s) => (
            <ScenarioRow key={s.id} scenario={s} onDeleted={(id) => void remove(id)} />
          ))}
        </ul>
      )}

      {draft === null ? (
        <button type="button" className="btn mt-4" onClick={() => setDraft(EXAMPLE_SCENARIO)}>
          <FilePlus2 aria-hidden size={14} /> New scenario
        </button>
      ) : (
        <div className="mt-4">
          <label className="block">
            <span className="rule-label">Scenario JSON</span>
            <textarea
              className="field mt-1 h-64 w-full font-mono text-[0.8125rem]"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          {draftError && <p className="mt-2 rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{draftError}</p>}
          <div className="mt-3 flex gap-3">
            <button type="button" className="btn btn-primary" onClick={() => void saveDraft()}>
              <Save aria-hidden size={14} /> Save scenario
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ViolationsSection() {
  const [violations, setViolations] = useState<Violation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    client
      .violations()
      .then((v) => {
        setViolations(v);
        setError(null);
      })
      .catch((err: ApiError) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  const clear = async () => {
    if (!window.confirm('Delete every recorded violation?')) return;
    await client.clearViolations().catch((err: ApiError) => setError(err.message));
    load();
  };

  return (
    <>
      <div className="mt-10 mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="font-mono text-sm font-semibold">
            <span className="text-ink-3">T.3.</span> Violations
          </h3>
          <p className="mt-1 max-w-[70ch] text-sm text-ink-2">
            Contract violations reported by the SDK (request/response schema, undeclared statuses) and failed contract runs. Configure a Reporter on
            <code className="font-mono"> createRouter</code> or use HttpReporter in standalone mode.
          </p>
        </div>
        {!!violations?.length && (
          <button type="button" className="btn btn-quiet text-err hover:text-err" onClick={clear}>
            <Trash2 aria-hidden size={14} /> Clear
          </button>
        )}
      </div>
      {error && <p className="rounded-[3px] bg-err-wash px-3 py-2 font-mono text-sm text-err">{error}</p>}
      {violations === null && !error ? (
        <div className="space-y-2" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-[3px] bg-sheet" />
          ))}
        </div>
      ) : violations?.length === 0 ? (
        <p className="text-sm text-ink-3">No violations recorded.</p>
      ) : (
        violations && (
          <ul className="border-t border-rule">
            {violations.map((v) => (
              <li key={v.id} className="border-b border-rule py-2.5 font-mono text-[0.8125rem]">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-ink-3">
                    <time dateTime={v.at}>{when(v.at)}</time>
                  </span>
                  <span className="rounded-[3px] bg-err-wash px-1.5 py-0.5 text-xs text-err">{kindLabel[v.kind]}</span>
                  <span>
                    <span className="font-semibold">{v.method}</span> {v.path}
                    {v.operationId && <span className="text-ink-3"> · {v.operationId}</span>}
                  </span>
                  {v.status !== undefined && <span className="text-ink-3">→ {v.status}</span>}
                </div>
                {v.issues.length > 0 && (
                  <p className="mt-1 pl-[4.5rem] text-ink-3">
                    {v.issues[0]!.path} {v.issues[0]!.message}
                    {v.issues.length > 1 && ` (+${v.issues.length - 1} more)`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )
      )}
    </>
  );
}

export function TestsView() {
  return (
    <section aria-labelledby="tests-title" className="mt-10 pb-24">
      <h2 id="tests-title" className="font-mono text-lg font-semibold">
        Tests
      </h2>
      <p className="mt-2 max-w-[70ch] text-sm text-ink-2">
        Verify the live API against its contract — every operation in one shot, multi-step flows, and a feed of everything the SDK caught in
        production traffic.
      </p>
      <ContractRunSection />
      <ScenariosSection />
      <ViolationsSection />
    </section>
  );
}
