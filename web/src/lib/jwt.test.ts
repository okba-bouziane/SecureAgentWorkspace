import { describe, expect, it } from "vitest";
import { decodeJwt } from "./jwt";

const encode = (claims: object) => Buffer.from(JSON.stringify(claims)).toString("base64url");

describe("decodeJwt", () => {
  it("reads the payload of a token", () => {
    const token = `${encode({ alg: "RS256" })}.${encode({ preferred_username: "viewer", realm_access: { roles: ["viewer"] } })}.sig`;
    expect(decodeJwt(token)).toMatchObject({ preferred_username: "viewer", realm_access: { roles: ["viewer"] } });
  });

  it("keeps non-ASCII characters intact", () => {
    const token = `${encode({})}.${encode({ preferred_username: "Zoë Müller" })}.sig`;
    expect(decodeJwt(token).preferred_username).toBe("Zoë Müller");
  });
});
