import type { ReactNode } from "react";

type OnCite = ((tag: string) => void) | undefined;

const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const TABLE_DIVIDER = /^\s*\|[\s:|-]+\|\s*$/;

const splitCells = (line: string) =>
  line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

const isTable = (lines: string[]) =>
  lines.length >= 2 && lines.every((l) => l.trim().startsWith("|")) && TABLE_DIVIDER.test(lines[1] ?? "");

function Table({ lines, onCite }: { lines: string[]; onCite: OnCite }) {
  return (
    <div className="table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {splitCells(lines[0] ?? "").map((c, i) => (
              <th key={i}>{inline(c, onCite)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.slice(2).map((line, r) => (
            <tr key={r}>
              {splitCells(line).map((c, i) => (
                <td key={i}>{inline(c, onCite)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function List({ lines, marker, ordered, onCite }: { lines: string[]; marker: RegExp; ordered: boolean; onCite: OnCite }) {
  const items = lines.map((l, i) => <li key={i}>{inline(l.replace(marker, ""), onCite)}</li>);
  return ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
}

/**
 * Tiny, safe markdown subset (paragraphs, lists, tables, bold, inline code) plus [S12] citation badges.
 * React escapes every string, so model output can never inject HTML.
 */
export function renderMarkdown(text: string, onCite?: (tag: string) => void): ReactNode {
  return text.split(/\n{2,}/).map((block, i) => {
    const lines = block.split("\n");
    if (isTable(lines)) return <Table key={i} lines={lines} onCite={onCite} />;
    if (lines.every((l) => BULLET.test(l))) return <List key={i} lines={lines} marker={BULLET} ordered={false} onCite={onCite} />;
    if (lines.every((l) => NUMBERED.test(l))) return <List key={i} lines={lines} marker={NUMBERED} ordered onCite={onCite} />;
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

const INLINE_TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[S\d+\])/g;

export function inline(text: string, onCite?: (tag: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const token = match[0];
    if (match.index > last) out.push(text.slice(last, match.index));
    if (token.startsWith("**")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else {
      const tag = token.slice(1, -1); // "S12"
      out.push(
        <button key={key++} type="button" className="cite" onClick={() => onCite?.(tag)} title="Show source" aria-label={`Show source ${tag.slice(1)}`}>
          {tag.slice(1)}
        </button>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
