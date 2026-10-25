import type { AuthUser } from "./jwt-verifier.js";

export const ADMIN_ROLE = "admin";

export const isAdmin = (user: AuthUser): boolean => user.roles.includes(ADMIN_ROLE);
