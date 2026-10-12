import { useMemo, type ReactNode } from 'react';

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJson(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [whole, str, colon, literal, num] = m;
    if (str !== undefined) {
      out.push(
        <span key={i++} className={colon ? 'json-key' : 'json-string'}>
          {str}
        </span>,
      );
      if (colon) out.push(colon);
    } else if (literal) out.push(<span key={i++} className="json-literal">{literal}</span>);
    else if (num) out.push(<span key={i++} className="json-number">{num}</span>);
    else out.push(whole);
    last = m.index + whole.length;
  }
  out.push(text.slice(last));
  return out;
}

export function prettyBody(body: string, contentType = ''): { text: string; json: boolean } {
  if (/json/i.test(contentType) || /^\s*[[{]/.test(body)) {
    try {
      return { text: JSON.stringify(JSON.parse(body), null, 2), json: true };
    } catch {
      /* not JSON after all */
    }
  }
  return { text: body, json: false };
}

export function CodeBlock({ text, json, label, className = '' }: { text: string; json?: boolean; label: string; className?: string }) {
  const content = useMemo(() => (json ? highlightJson(text) : text), [text, json]);
  return (
    <pre
      aria-label={label}
      tabIndex={0}
      className={`overflow-auto font-mono text-[0.8125rem] leading-[1.6] whitespace-pre text-ink ${className}`}
    >
      {content}
    </pre>
  );
}
