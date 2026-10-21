import { ChevronDown, ChevronRight, FileText, Hand, ShieldAlert, Wrench } from "lucide-react";
import { useState } from "react";
import { renderMarkdown } from "../lib/markdown";
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

export function SourceCard({ s, highlighted }: { s: SourceRef; highlighted: boolean }) {
  return (
    <div className={`source${highlighted ? " hl" : ""}`} id={`src-${s.tag}`}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span className="cite" style={{ cursor: "default" }}>
          {s.tag.slice(1)}
        </span>
        <FileText size={13} className="muted" />
        <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</b>
      </div>
      <div className="snip">{s.snippet}</div>
      <div className="muted small">
        FTS #{s.ftsRank ?? "-"} - vector #{s.vectorRank ?? "-"} - fused {s.fusedScore.toFixed(4)}
        {s.suspicious && <span className="badge err" style={{ marginLeft: 6 }}>flagged</span>}
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
  const cite = (tag: string) => {
    setHl(tag);
    document.getElementById(`src-${tag}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setTimeout(() => setHl(null), 2000);
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
          <div className="muted small" style={{ marginBottom: 4 }}>
            Retrieved sources
          </div>
          <div className="sources">
            {sources.map((s) => (
              <SourceCard key={s.tag} s={s} highlighted={hl === s.tag} />
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
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" disabled={busy} onClick={() => onDecision(true)}>
              Approve
            </button>
            <button className="btn danger" disabled={busy} onClick={() => onDecision(false)}>
              Reject
            </button>
          </div>
        </div>
      )}
      {turn.warning && <div className="banner warn">{turn.warning}</div>}
      {turn.answer && (
        <div className={`answer${turn.blocked ? " blocked" : ""}`}>
          {renderMarkdown(turn.answer, cite)}
          {turn.redactions && Object.keys(turn.redactions).length > 0 && (
            <div className="muted small" style={{ marginTop: 6 }}>
              PII redacted: {Object.entries(turn.redactions).map(([k, v]) => `${v} ${k}`).join(", ")}
            </div>
          )}
        </div>
      )}
      {turn.error && <div className="banner err">{turn.error}</div>}
      {turn.running && !turn.approval && !turn.answer && <div className="muted small">Working...</div>}
    </div>
  );
}
