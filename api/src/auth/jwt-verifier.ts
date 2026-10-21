import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export interface AuthUser {
  sub: string;
  username: string;
  roles: string[];
  /** The raw access token. Forwarded as-is to SecureMCP so its role checks apply. */
  token: string;
  expiresAt: number;
}

export interface VerifierOptions {
  issuer: string;
  audience: string;
  jwks: JWTVerifyGetKey;
}

interface KeycloakClaims extends JWTPayload {
  preferred_username?: string;
  realm_access?: { roles?: string[] };
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function remoteJwks(url: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(url));
}

export class JwtVerifier {
  constructor(private readonly opts: VerifierOptions) {}

  async verify(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify<KeycloakClaims>(token, this.opts.jwks, {
        issuer: this.opts.issuer,
        audience: this.opts.audience,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "sub"],
      });
      return {
        sub: payload.sub as string,
        username: payload.preferred_username ?? (payload.sub as string),
        roles: payload.realm_access?.roles ?? [],
        token,
        expiresAt: payload.exp as number,
      };
    } catch (err) {
      throw new AuthError(describe(err));
    }
  }
}

function describe(err: unknown): string {
  if (err instanceof errors.JWTExpired) return "Token has expired";
  if (err instanceof errors.JWTClaimValidationFailed) return `Invalid token claim: ${err.claim}`;
  if (err instanceof errors.JWSSignatureVerificationFailed) return "Invalid token signature";
  if (err instanceof errors.JOSEError) return "Invalid token";
  return "Token verification failed";
}
