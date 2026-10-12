import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Collection } from '../lib/api';
import type { Section } from '../lib/spec';

interface Props {
  sections: Section[];
  currentId: string | undefined;
  onNavigate?: () => void;
  collections?: Collection[];
}

const isTyping = (el: Element | null) => !!el && (el.matches('input, textarea, select') || (el as HTMLElement).isContentEditable);

export function Toc({ sections, currentId, onNavigate, collections = [] }: Props) {
  const [filter, setFilter] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !isTyping(document.activeElement) && input.current?.offsetParent) {
        e.preventDefault();
        input.current.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map((s) => ({
        ...s,
        operations: s.operations.filter((o) =>
          [o.method, o.path, o.id, o.op.summary ?? '', s.tag, o.section].some((v) => v.toLowerCase().includes(q)),
        ),
      }))
      .filter((s) => s.operations.length);
  }, [sections, filter]);

  return (
    <nav aria-label="Table of contents" className="flex min-h-0 flex-col">
      <label className="relative mx-4 mb-3 block">
        <span className="sr-only">Filter operations</span>
        <Search aria-hidden size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
        <input
          ref={input}
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (setFilter(''), e.currentTarget.blur())}
          placeholder="Filter  /"
          className="field w-full py-1.5 pl-8"
        />
      </label>

      <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 font-mono text-[0.8125rem]">
        {visible.map((section) => (
          <li key={section.tag} className="mt-3 first:mt-0">
            <p className="px-2 py-1 text-ink">
              <span className="text-ink-3">{section.number}.</span> <span className="font-semibold">{section.tag}</span>
            </p>
            <ol>
              {section.operations.map((o) => {
                const current = o.id === currentId;
                return (
                  <li key={o.id}>
                    <a
                      href={`#/op/${encodeURIComponent(o.id)}`}
                      aria-current={current ? 'page' : undefined}
                      onClick={onNavigate}
                      title={o.op.summary ?? `${o.method} ${o.path}`}
                      className={`grid grid-cols-[2.75rem_3.75rem_1fr] items-baseline rounded-[3px] px-2 py-[0.3rem] no-underline transition-colors duration-150 ${
                        current ? 'bg-link-wash text-link' : 'text-ink-2 hover:bg-paper hover:text-ink'
                      }`}
                    >
                      <span className={current ? 'text-link' : 'text-ink-3'}>{o.section}</span>
                      <span className="text-[0.6875rem] font-semibold tracking-[0.04em]">{o.method}</span>
                      <span className={`truncate ${o.op.deprecated ? 'line-through' : ''}`}>{o.path}</span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
        {visible.length === 0 && <li className="px-2 py-4 font-sans text-sm text-ink-3">No operation matches “{filter}”.</li>}

        {collections.length > 0 && (
          <li className="mt-6 border-t border-rule pt-3">
            <p className="px-2 py-1 text-ink-3">Collections</p>
            <ol>
              {collections.map((col) => (
                <li key={col.id}>
                  <p className="px-2 pt-1.5 text-[0.6875rem] font-semibold tracking-wide text-ink-2">{col.name}</p>
                  {col.requests.map((r) => (
                    <a
                      key={r.id}
                      href={`#/saved/${encodeURIComponent(col.id)}/${encodeURIComponent(r.id)}`}
                      onClick={onNavigate}
                      title={r.name}
                      className="grid grid-cols-[3.75rem_1fr] items-baseline gap-2 rounded-[3px] px-2 py-[0.25rem] pl-4 text-ink-2 no-underline hover:bg-paper hover:text-ink"
                    >
                      <span className="text-[0.6875rem] font-semibold tracking-[0.04em]">{r.method}</span>
                      <span className="truncate">{r.name}</span>
                    </a>
                  ))}
                </li>
              ))}
            </ol>
          </li>
        )}
      </ol>
    </nav>
  );
}
