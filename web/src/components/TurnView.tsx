import { ChevronDown, ChevronRight, FileText, Hand, ShieldAlert, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { renderMarkdown } from "../lib/markdown";
import { Banner, Loading } from "./ui";
import type { Step, Turn } from "../lib/turns";
import type { SourceRef } from "../lib/types";

function StepRow({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const args = Object.keys(step.args).length ? JSON.stringify(step.args) : "";
  return (
    <div className="step">
      <button className="step-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className={`dot ${step.state}`} />
        <Wrench size={13} className="muted" />
        <span className="step-name">{step.name}</span>
        <span className="step-args">{args}</span>
        {step.write && <span className="badge warn">write</span>}
        {(step.neutralised ?? 0) > 0 && (
          <span className="badge err" title="Instruction-like text in the tool output was removed before the model saw it">
            <ShieldAlert size={11} /> injection neutralised
          </span>
        )}
        {step.durationMs !== undefined && <span className="muted small">{Math.round(step.durationMs)} ms</span>}
      </button>
      {open && (
        <div className="step-body">
          <pre>{step.preview ?? "(running)"}</pre>
        </div>
      )}
    </div>
  );
}

function SourceCard({ s, elementId, highlighted }: { s: SourceRef; elementId: string; highlighted: boolean }) {
  return (
    <div className={`source${highlighted ? " hl" : ""}`} id={elementId}>
      <div className="source-head">
        <span className="cite static">{s.tag.slice(1)}</span>
        <FileText size={13} className="muted" aria-hidden />
        <b className="source-title">{s.title}</b>
      </div>
      <div className="snip">{s.snippet}</div>
      <div className="muted small">
        FTS #{s.ftsRank ?? "-"} - vector #{s.vectorRank ?? "-"} - fused {s.fusedScore.toFixed(4)}
        {s.suspicious && <span className="badge err">flagged</span>}
      </div>
    </div>
  );
}

interface Props {
  turn: Turn;
  onDecision(approved: boolean): void;
  busy: boolean;
}

export function TurnView({ turn, onDecision, busy }: Props) {
  const [hl, setHl] = useState<string | null>(null);
  const clearHighlight = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(clearHighlight.current), []);

  // Ids are per turn: two turns in one thread can cite the same chunk.
  const sourceElementId = (tag: string) => `src-${turn.id}-${tag}`;

  /** Clicking a [S12] badge in the answer scrolls to that source card and highlights it briefly. */
  const cite = (tag: string) => {
    setHl(tag);
    document.getElementById(sourceElementId(tag))?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    clearTimeout(clearHighlight.current);
    clearHighlight.current = setTimeout(() => setHl(null), 2000);
  };
  const cited = new Set([...(turn.answer ?? "").matchAll(/\[(S\d+)\]/g)].map((m) => m[1]));
  const sources = [...turn.sources].sort((a, b) => Number(cited.has(b.tag)) - Number(cited.has(a.tag)));

  return (
    <div className="turn">
      <div className="q">{turn.question}</div>
      {turn.steps.length > 0 && (
        <div className="steps">
          {turn.steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </div>
      )}
      {sources.length > 0 && (
        <div>
          <div className="muted small section-label">Retrieved sources</div>
          <div className="sources">
            {sources.map((s) => (
              <SourceCard key={s.tag} s={s} elementId={sourceElementId(s.tag)} highlighted={hl === s.tag} />
            ))}
          </div>
        </div>
      )}
      {turn.approval && (
        <div className="approval" role="alertdialog" aria-label="Approval required">
          <h3>
            <Hand size={16} /> Approval needed before this runs
          </h3>
          {turn.approval.map((c) => (
            <div key={c.id}>
              <b>{c.name}</b> <code>{JSON.stringify(c.args)}</code>
            </div>
          ))}
          <div className="muted small">The agent will call SecureMCP with your own access token. If your role is not allowed, SecureMCP will refuse.</div>
          <div className="approval-actions">
            <button className="btn primary" disabled={busy} onClick={() => onDecision(true)}>
              Approve
            </button>
            <button className="btn danger" disabled={busy} onClick={() => onDecision(false)}>
              Reject
            </button>
          </div>
        </div>
      )}
      {turn.warning && <Banner kind="warn">{turn.warning}</Banner>}
      {turn.answer && (
        <div className={`answer${turn.blocked ? " blocked" : ""}`}>
          {renderMarkdown(turn.answer, cite)}
          {turn.redactions && Object.keys(turn.redactions).length > 0 && (
            <div className="muted small redactions">
              PII redacted: {Object.entries(turn.redactions).map(([k, v]) => `${v} ${k}`).join(", ")}
            </div>
          )}
        </div>
      )}
      {turn.error && <Banner kind="err">{turn.error}</Banner>}
      {turn.running && !turn.approval && !turn.answer && <Loading label="Working" />}
    </div>
  );
}
