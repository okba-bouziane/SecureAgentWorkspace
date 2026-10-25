import { getAccessToken } from "./auth";
import { API_URL } from "./config";
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

function requestInit(method: "GET" | "POST", body?: unknown, signal?: AbortSignal): RequestInit {
  const headers: Record<string, string> = { Authorization: `Bearer ${getAccessToken() ?? ""}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal };
}

/** Turns an error response into an ApiError, using the API's `message` field when there is one. */
async function toApiError(res: Response): Promise<ApiError> {
  let message = res.statusText;
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (body.message) message = Array.isArray(body.message) ? body.message.join("; ") : body.message;
  } catch {
    // The body is not JSON; the status text is all we have.
  }
  const retry = Number(res.headers.get("Retry-After"));
  return new ApiError(message, res.status, Number.isFinite(retry) && retry > 0 ? retry : undefined);
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, requestInit(method, body));
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export const get = <T>(path: string): Promise<T> => request<T>("GET", path);
export const post = <T>(path: string, body: unknown): Promise<T> => request<T>("POST", path, body);

/** POST that answers with server-sent events. Calls onEvent for each parsed event as it arrives. */
export async function postStream(path: string, body: unknown, onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, requestInit("POST", body, signal));
  if (!res.ok) throw await toApiError(res);
  if (!res.body) throw new ApiError("No response stream", res.status);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    // Events are separated by a blank line; keep any trailing partial event in the buffer.
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const dataLine = buffer.slice(0, end).split("\n").find((l) => l.startsWith("data: "));
      buffer = buffer.slice(end + 2);
      if (dataLine) onEvent(JSON.parse(dataLine.slice(6)) as AgentEvent);
    }
  }
}
