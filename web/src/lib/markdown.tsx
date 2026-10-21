import type { ReactNode } from "react";

/** Tiny, safe markdown subset (paragraphs, lists, bold, inline code) plus [S12] citation badges. React escapes everything. */
export function renderMarkdown(text: string, onCite?: (tag: string) => void): ReactNode {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, i) => {
    const lines = block.split("\n");
    if (lines.length >= 2 && lines.every((l) => l.trim().startsWith("|")) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[1] ?? "")) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      return (
        <table key={i} className="md-table">
          <thead>
            <tr>
              {cells(lines[0] ?? "").map((c, j) => (
                <th key={j}>{inline(c, onCite)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.slice(2).map((l, r) => (
              <tr key={r}>
                {cells(l).map((c, j) => (
                  <td key={j}>{inline(c, onCite)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      return (
        <ul key={i}>
          {lines.map((l, j) => (
            <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ""), onCite)}</li>
          ))}
        </ul>
      );
    }
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      return (
        <ol key={i}>
          {lines.map((l, j) => (
            <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""), onCite)}</li>
          ))}
        </ol>
      );
    }
    return (
      <p key={i}>
        {lines.map((l, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {inline(l, onCite)}
          </span>
        ))}
      </p>
    );
  });
}

export function inline(text: string, onCite?: (tag: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[S\d+\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    else {
      const tag = tok.slice(1, -1);
      out.push(
        <button key={key++} type="button" className="cite" onClick={() => onCite?.(tag)} title="Show source">
          {tag.slice(1)}
        </button>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
