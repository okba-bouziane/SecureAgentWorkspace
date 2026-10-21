export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";
export const OIDC_AUTHORITY = (import.meta.env.VITE_OIDC_AUTHORITY as string | undefined) ?? "http://localhost:8081/realms/securemcp";
export const OIDC_CLIENT_ID = (import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined) ?? "saw-web";
