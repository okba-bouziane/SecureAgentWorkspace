import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export function Banner({ kind, children }: { kind: "ok" | "warn" | "err"; children: ReactNode }) {
  return (
    <div className={`banner ${kind}`} role={kind === "err" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading muted" role="status">
      <Loader2 size={15} className="spin" aria-hidden /> {label}...
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="empty-note muted">{children}</div>;
}
