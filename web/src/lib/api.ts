import { API_URL } from "./config";
import { getAccessToken } from "./auth";
import type { AgentEvent } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

function headers(json = true): HeadersInit {
  const h: Record<string, string> = { Authorization: `Bearer ${getAccessToken() ?? ""}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function fail(res: Response): Promise<never> {
  let message = res.statusText;
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (body.message) message = Array.isArray(body.message) ? body.message.join("; ") : body.message;
  } catch {
    /* body is not JSON */
  }
  const retry = Number(res.headers.get("Retry-After"));
  throw new ApiError(message, res.status, Number.isFinite(retry) && retry > 0 ? retry : undefined);
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: headers(false) });
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

/** POST that answers with server-sent events. Calls onEvent for each parsed event as it arrives. */
export async function postStream(path: string, body: unknown, onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
  if (!res.ok) return fail(res);
  if (!res.body) throw new ApiError("No response stream", res.status);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = block.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)) as AgentEvent);
    }
  }
}
