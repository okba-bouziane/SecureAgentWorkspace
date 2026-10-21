import { generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthGuard } from "../src/auth/auth.guard.js";
import { AuthError, JwtVerifier } from "../src/auth/jwt-verifier.js";
import { makeJwks } from "./helpers.js";

const ISSUER = "http://issuer.test/realms/x";
let jwt: Awaited<ReturnType<typeof makeJwks>>;
let verifier: JwtVerifier;

beforeAll(async () => {
  jwt = await makeJwks();
  verifier = new JwtVerifier({ issuer: ISSUER, audience: "mcp-server", jwks: jwt.jwks });
});

describe("JwtVerifier", () => {
  it("accepts a valid token and extracts identity and realm roles", async () => {
    const token = await jwt.sign({ preferred_username: "admin", realm_access: { roles: ["admin", "offline_access"] } });
    const user = await verifier.verify(token);
    expect(user).toMatchObject({ sub: "user-1", username: "admin", roles: ["admin", "offline_access"], token });
  });

  it("rejects an expired token", async () => {
    const token = await jwt.sign({}, { expiresIn: "-1m" });
    await expect(verifier.verify(token)).rejects.toThrow("expired");
  });

  it("rejects the wrong audience and the wrong issuer", async () => {
    await expect(verifier.verify(await jwt.sign({}, { audience: "other" }))).rejects.toThrow(AuthError);
    await expect(verifier.verify(await jwt.sign({}, { issuer: "http://evil.test" }))).rejects.toThrow(AuthError);
  });

  it("rejects a token signed with an unknown key", async () => {
    const other = await generateKeyPair("RS256");
    const token = await jwt.sign({}, { key: other.privateKey });
    await expect(verifier.verify(token)).rejects.toThrow("signature");
  });

  it("rejects garbage", async () => {
    await expect(verifier.verify("not.a.jwt")).rejects.toThrow(AuthError);
  });
});

describe("AuthGuard", () => {
  const ctx = (authorization?: string) => {
    const req: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
    return { req, context: { switchToHttp: () => ({ getRequest: () => req }) } as never };
  };

  it("401s without a bearer token", async () => {
    const guard = new AuthGuard(verifier);
    await expect(guard.canActivate(ctx().context)).rejects.toThrow("Missing Bearer token");
    await expect(guard.canActivate(ctx("Basic abc").context)).rejects.toThrow("Missing Bearer token");
  });

  it("attaches the user for a valid token", async () => {
    const guard = new AuthGuard(verifier);
    const token = await jwt.sign({ preferred_username: "viewer", realm_access: { roles: ["viewer"] } });
    const { req, context } = ctx(`Bearer ${token}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((req.user as { username: string }).username).toBe("viewer");
  });

  it("401s for an invalid token", async () => {
    const guard = new AuthGuard(verifier);
    await expect(guard.canActivate(ctx("Bearer nope").context)).rejects.toThrow();
  });
});
