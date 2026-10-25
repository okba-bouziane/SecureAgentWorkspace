/** Reads the claims of a JWT without verifying it. Only for showing the user's name and roles: the API does the real verification. */
export function decodeJwt(token: string): Record<string, unknown> {
  const body = token.split(".")[1] ?? "";
  const base64 = body.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}
