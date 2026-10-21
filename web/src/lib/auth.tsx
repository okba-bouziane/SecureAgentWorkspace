import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from "./config";

/** Authorization Code + PKCE against Keycloak. No client secret exists in this app. */
export const userManager = new UserManager({
  authority: OIDC_AUTHORITY,
  client_id: OIDC_CLIENT_ID,
  redirect_uri: window.location.origin + "/",
  post_logout_redirect_uri: window.location.origin + "/",
  response_type: "code",
  scope: "openid profile email",
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: true,
});

export interface Session {
  username: string;
  roles: string[];
  isAdmin: boolean;
  accessToken: string;
}

function toSession(user: User): Session {
  const payload = decodeJwt(user.access_token);
  const roles = ((payload.realm_access as { roles?: string[] } | undefined)?.roles ?? []).filter((r) => r === "admin" || r === "viewer");
  return {
    username: (payload.preferred_username as string | undefined) ?? user.profile.preferred_username ?? user.profile.sub,
    roles,
    isAdmin: roles.includes("admin"),
    accessToken: user.access_token,
  };
}

export function decodeJwt(token: string): Record<string, unknown> {
  const body = token.split(".")[1] ?? "";
  const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(decodeURIComponent(escape(json))) as Record<string, unknown>;
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  error: string | null;
  login(): void;
  logout(): void;
}

const Ctx = createContext<AuthState | null>(null);
let currentToken: string | null = null;
export const getAccessToken = () => currentToken;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const apply = (user: User | null) => {
      currentToken = user && !user.expired ? user.access_token : null;
      setSession(user && !user.expired ? toSession(user) : null);
    };
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.has("code") && params.has("state")) {
          const user = await userManager.signinRedirectCallback();
          window.history.replaceState({}, "", user.url_state ?? "/");
          if (!cancelled) apply(user);
        } else if (!cancelled) {
          apply(await userManager.getUser());
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Sign-in failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const onLoaded = (u: User) => apply(u);
    const onGone = () => apply(null);
    userManager.events.addUserLoaded(onLoaded);
    userManager.events.addUserUnloaded(onGone);
    userManager.events.addAccessTokenExpired(onGone);
    return () => {
      cancelled = true;
      userManager.events.removeUserLoaded(onLoaded);
      userManager.events.removeUserUnloaded(onGone);
      userManager.events.removeAccessTokenExpired(onGone);
    };
  }, []);

  const login = useCallback(() => void userManager.signinRedirect({ state: window.location.pathname }), []);
  const logout = useCallback(() => void userManager.signoutRedirect(), []);
  const value = useMemo(() => ({ session, loading, error, login, logout }), [session, loading, error, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
