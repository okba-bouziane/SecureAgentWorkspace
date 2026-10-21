import { MemorySaver } from "@langchain/langgraph";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { McpGateway } from "../src/mcp/mcp-gateway.js";
import { JwtVerifier } from "../src/auth/jwt-verifier.js";
import { CHAT_MODEL_FACTORY, CHECKPOINTER, JWT_VERIFIER, MCP_GATEWAY_FACTORY } from "../src/common/tokens.js";
import { EMBEDDER } from "../src/common/tokens.js";
import { aiCall, aiText, HashEmbedder, makeJwks, ScriptedChatModel, TEST_DATABASE_URL, TEST_REDIS_URL } from "./helpers.js";

const enabled = Boolean(TEST_DATABASE_URL && TEST_REDIS_URL);

function sse(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => JSON.parse(block.split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as { type: string; [k: string]: unknown });
}
const rawParser = (res: request.Response, cb: (e: Error | null, b: unknown) => void) => {
  let d = "";
  res.setEncoding("utf8");
  res.on("data", (c: string) => (d += c));
  res.on("end", () => cb(null, d));
};

describe.skipIf(!enabled)("HTTP API", () => {
  let app: INestApplication;
  let jwt: Awaited<ReturnType<typeof makeJwks>>;
  let script: ScriptedChatModel;
  const calls: { token: string; name: string }[] = [];

  const gatewayFactory = (token: string): McpGateway => ({
    async listTools() {
      return [
        { name: "list_orders", description: "list", inputSchema: { type: "object", properties: {} }, readOnly: true },
        { name: "update_order_status", description: "update", inputSchema: { type: "object", properties: {} }, readOnly: false },
      ];
    },
    async callTool(name) {
      calls.push({ token, name });
      return { text: '{"id":4,"status":"shipped"}', isError: false };
    },
    async close() {},
  });

  const login = async (username: string, roles: string[], sub = username) => {
    const token = await new (await import("jose")).SignJWT({ preferred_username: username, realm_access: { roles } })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("http://issuer.test/realms/x")
      .setAudience("mcp-server")
      .setSubject(sub)
      .setExpirationTime("10m")
      .sign(jwt.privateKey);
    return token;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.REDIS_URL = TEST_REDIS_URL;
    process.env.LLM_API_KEY = "test-key-not-used";
    process.env.CHAT_RATE_LIMIT = "6";
    process.env.CHAT_RATE_WINDOW_SECONDS = "60";
    process.env.SEED_ON_START = "false";
    jwt = await makeJwks();
    const { AppModule } = await import("../src/app.module.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_VERIFIER)
      .useValue(new JwtVerifier({ issuer: "http://issuer.test/realms/x", audience: "mcp-server", jwks: jwt.jwks }))
      .overrideProvider(CHECKPOINTER)
      .useValue(new MemorySaver())
      .overrideProvider(EMBEDDER)
      .useValue(new HashEmbedder())
      .overrideProvider(CHAT_MODEL_FACTORY)
      .useValue(() => script)
      .overrideProvider(MCP_GATEWAY_FACTORY)
      .useValue(gatewayFactory)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const redis = moduleRef.get(await import("../src/common/tokens.js").then((m) => m.REDIS)) as import("ioredis").Redis;
    await redis.flushdb();
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it("rejects requests without a token", async () => {
    await http().get("/traces").expect(401);
    await http().post("/chat/threads/6f1f3e0e-0000-4000-8000-000000000001/messages").send({ message: "hi" }).expect(401);
  });

  it("exposes health and Prometheus metrics without auth", async () => {
    await http().get("/health/ready").expect(200);
    const res = await http().get("/metrics").expect(200);
    expect(res.text).toContain("saw_http_requests_total");
    expect(res.text).toContain("saw_chat_runs_total");
  });

  it("streams a read question, forwarding the caller's own token to the tool", async () => {
    script = new ScriptedChatModel([aiCall("list_orders", {}), aiText("There is one pending order.")]);
    const token = await login("viewer", ["viewer"]);
    const res = await http()
      .post("/chat/threads/6f1f3e0e-0000-4000-8000-000000000002/messages")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "List orders" })
      .buffer(true)
      .parse(rawParser)
      .expect(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = sse(res.body as string);
    expect(events.map((e) => e.type)).toEqual(["run_started", "tool_call", "tool_result", "message", "done"]);
    expect(events.at(-1)).toMatchObject({ status: "completed" });
    expect(calls.at(-1)).toEqual({ token, name: "list_orders" });
  });

  it("asks for approval, then resumes on the second request", async () => {
    script = new ScriptedChatModel([aiCall("update_order_status", { id: 4, status: "shipped" }), aiText("Order 4 shipped.")]);
    const token = await login("admin", ["admin"]);
    const id = "6f1f3e0e-0000-4000-8000-000000000003";
    const first = await http().post(`/chat/threads/${id}/messages`).set("Authorization", `Bearer ${token}`).send({ message: "ship order 4" }).buffer(true).parse(rawParser);
    const events = sse(first.body as string);
    expect(events.at(-2)).toMatchObject({ type: "approval_required", calls: [{ name: "update_order_status" }] });
    expect(events.at(-1)).toMatchObject({ status: "awaiting_approval" });
    expect(calls.some((c) => c.name === "update_order_status")).toBe(false);

    // A second message while the approval is pending is refused.
    await http().post(`/chat/threads/${id}/messages`).set("Authorization", `Bearer ${token}`).send({ message: "another" }).expect(409);

    const hist = await http().get(`/chat/threads/${id}`).set("Authorization", `Bearer ${token}`).expect(200);
    expect(hist.body.pending).toHaveLength(1);

    const second = await http().post(`/chat/threads/${id}/approval`).set("Authorization", `Bearer ${token}`).send({ approved: true }).buffer(true).parse(rawParser);
    const resumed = sse(second.body as string);
    expect(resumed.map((e) => e.type)).toContain("tool_result");
    expect(resumed.at(-1)).toMatchObject({ status: "completed" });
    expect(calls.some((c) => c.name === "update_order_status")).toBe(true);
  });

  it("hides one user's thread from another", async () => {
    script = new ScriptedChatModel([aiText("hi")]);
    const alice = await login("alice", ["viewer"], "alice-sub");
    const bob = await login("bob", ["viewer"], "bob-sub");
    const id = "6f1f3e0e-0000-4000-8000-000000000004";
    await http().post(`/chat/threads/${id}/messages`).set("Authorization", `Bearer ${alice}`).send({ message: "hello" }).buffer(true).parse(rawParser).expect(200);
    await http().get(`/chat/threads/${id}`).set("Authorization", `Bearer ${bob}`).expect(404);
    await http().post(`/chat/threads/${id}/approval`).set("Authorization", `Bearer ${bob}`).send({ approved: true }).expect(404);
  });

  it("returns 429 with Retry-After once the per-user limit is used up", async () => {
    const token = await login("limited", ["viewer"], "limited-sub");
    let last = 200;
    let retryAfter: string | undefined;
    for (let i = 0; i < 8; i++) {
      script = new ScriptedChatModel([aiText("ok")]);
      const res = await http()
        .post(`/chat/threads/6f1f3e0e-0000-4000-8000-0000000001${10 + i}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({ message: "ping" })
        .buffer(true)
        .parse(rawParser);
      last = res.status;
      retryAfter = res.headers["retry-after"] as string | undefined;
      if (last === 429) break;
    }
    expect(last).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("only lets admins add documents", async () => {
    const viewer = await login("viewer", ["viewer"]);
    const admin = await login("admin", ["admin"]);
    const body = { title: "Sample doc", content: "Sample data about packaging and boxes for testing uploads." };
    await http().post("/knowledge/documents").set("Authorization", `Bearer ${viewer}`).send(body).expect(403);
    await http().post("/knowledge/documents").set("Authorization", `Bearer ${admin}`).send({ title: "x" }).expect(400);
    const ok = await http().post("/knowledge/documents").set("Authorization", `Bearer ${admin}`).send(body).expect(201);
    expect(ok.body.status).toBe("queued");
    const again = await http().post("/knowledge/documents").set("Authorization", `Bearer ${admin}`).send(body).expect(201);
    expect(again.body).toMatchObject({ id: ok.body.id, duplicate: true });
  });

  it("stores traces and only shows them to their owner or an admin", async () => {
    const viewer = await login("viewer", ["viewer"]);
    const other = await login("someone", ["viewer"], "someone-sub");
    const mine = await http().get("/traces").set("Authorization", `Bearer ${viewer}`).expect(200);
    expect(mine.body.traces.length).toBeGreaterThan(0);
    const id = mine.body.traces[0].id as string;
    const detail = await http().get(`/traces/${id}`).set("Authorization", `Bearer ${viewer}`).expect(200);
    expect(detail.body.spans.some((s: { name: string }) => s.name === "llm.chat")).toBe(true);
    await http().get(`/traces/${id}`).set("Authorization", `Bearer ${other}`).expect(403);
  });
});
