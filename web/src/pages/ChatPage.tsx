import { useCallback, useEffect, useRef, useState } from "react";
import { TurnView } from "../components/TurnView";
import { Banner, Loading } from "../components/ui";
import { get, postStream } from "../lib/api";
import type { Session } from "../lib/auth";
import { errorText } from "../lib/errors";
import { applyEvent, newTurn, turnsFromHistory, type Turn } from "../lib/turns";
import type { HistoryItem, PendingCall, ThreadRow } from "../lib/types";
import { Composer } from "./chat/Composer";
import { ThreadList } from "./chat/ThreadList";

export default function ChatPage({ session }: { session: Session }) {
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    try {
      setThreads((await get<{ threads: ThreadRow[] }>("/chat/threads")).threads);
    } catch {
      // The list is a convenience; chatting works without it.
      setThreads((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  async function openThread(id: string) {
    setThreadId(id);
    setBanner(null);
    setLoadingThread(true);
    try {
      const history = await get<{ items: HistoryItem[]; pending: PendingCall[] }>(`/chat/threads/${id}`);
      setTurns(turnsFromHistory(history.items, history.pending));
    } catch (e) {
      setTurns([]);
      setBanner(errorText(e, "Could not load the conversation"));
    } finally {
      setLoadingThread(false);
    }
  }

  function newChat() {
    setThreadId(crypto.randomUUID());
    setTurns([]);
    setBanner(null);
  }

  /** Streams one agent run into the last turn. A new question adds a turn; an approval continues the current one. */
  async function runAgent(path: string, body: unknown, question?: string) {
    setBusy(true);
    setBanner(null);
    const updateLast = (fn: (t: Turn) => Turn) => setTurns((all) => all.map((t, i) => (i === all.length - 1 ? fn(t) : t)));
    if (question === undefined) updateLast((t) => ({ ...t, running: true }));
    else setTurns((all) => [...all, newTurn(question)]);
    try {
      await postStream(path, body, (event) => updateLast((t) => applyEvent(t, event)));
    } catch (e) {
      setBanner(errorText(e, "Request failed"));
      updateLast((t) => ({ ...t, running: false }));
    } finally {
      setBusy(false);
      void loadThreads();
    }
  }

  const sendMessage = (message: string) => void runAgent(`/chat/threads/${threadId}/messages`, { message }, message);
  const decide = (approved: boolean) => void runAgent(`/chat/threads/${threadId}/approval`, { approved });

  const waitingForApproval = Boolean(turns.at(-1)?.approval);

  return (
    <div className="chat">
      <ThreadList threads={threads} activeId={threadId} onOpen={(id) => void openThread(id)} onNew={newChat} />
      <div className="chat-main">
        <div className="messages">
          <div className="messages-inner">
            {loadingThread && <Loading label="Loading conversation" />}
            {!loadingThread && turns.length === 0 && (
              <div className="empty">
                <h1>Ask about orders or policies</h1>
                <p className="muted">
                  Signed in as <b>{session.username}</b> ({session.roles.join(", ") || "no role"}). Order tools run with your own permissions; changes need your approval.
                </p>
              </div>
            )}
            {turns.map((turn, i) => (
              <TurnView key={turn.id} turn={turn} busy={busy} onDecision={i === turns.length - 1 ? decide : () => undefined} />
            ))}
            {banner && <Banner kind="err">{banner}</Banner>}
            <div ref={bottom} />
          </div>
        </div>
        <Composer busy={busy || loadingThread} locked={waitingForApproval} showExamples={turns.length === 0 && !loadingThread} onSend={sendMessage} />
      </div>
    </div>
  );
}
