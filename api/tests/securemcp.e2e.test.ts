import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAgentGraph } from "../src/agent/graph.js";
import { mcpTools } from "../src/agent/tools.js";
import { GuardrailsService } from "../src/guardrails/guardrails.service.js";
import { httpGatewayFactory } from "../src/mcp/mcp-gateway.js";
import { MetricsService } from "../src/metrics/metrics.service.js";
import { MemorySink } from "../src/tracing/memory-sink.js";
import { Tracer } from "../src/tracing/tracer.js";
import { aiCall, aiText, ScriptedChatModel } from "./helpers.js";

/**
 * Runs the real SecureMCP server (path in SECUREMCP_PATH, already built) against a local JWKS,
 * so tokens, role checks and the audit log are the real thing. Only the chat model is scripted.
 */
const path = process.env.SECUREMCP_PATH;
const entry = path ? join(path, "dist", "index.js") : "";
const enabled = Boolean(path && existsSync(entry));

describe.skipIf(!enabled)("end to end with the real SecureMCP", () => {
  const ISSUER = "http://issuer.test/realms/x";
  const MCP_PORT = 3911;
  const JWKS_PORT = 3912;
  let jwksServer: Server;
  let mcp: ChildProcess;
  let sign: (user: string, role: "viewer" | "admin") => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    jwksServer = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
    }).listen(JWKS_PORT);
    sign = (user, role) =>
      new SignJWT({ preferred_username: user, realm_access: { roles: [role] } })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(ISSUER)
        .setAudience("mcp-server")
        .setSubject(user)
        .setExpirationTime("10m")
        .sign(privateKey);

    mcp = spawn("node", [entry], {
      cwd: path,
      env: {
        ...process.env,
        PORT: String(MCP_PORT),
        DB_PATH: join(mkdtempSync(join(tmpdir(), "securemcp-")), "test.db"),
        KEYCLOAK_ISSUER: ISSUER,
        KEYCLOAK_JWKS_URL: `http://127.0.0.1:${JWKS_PORT}/`,
        KEYCLOAK_AUDIENCE: "mcp-server",
      },
      stdio: "ignore",
    });
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`http://127.0.0.1:${MCP_PORT}/mcp`, { method: "POST" });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("SecureMCP did not start");
  });
  afterAll(() => {
    mcp?.kill();
    jwksServer?.close();
  });

  const factory = httpGatewayFactory(`http://127.0.0.1:${MCP_PORT}/mcp`);

  async function runWrite(role: "viewer" | "admin", approved: boolean) {
    const token = await sign(role, role);
    const gateway = factory(token);
    const tools = await mcpTools(gateway);
    const events: { type: string; [k: string]: unknown }[] = [];
    const graph = buildAgentGraph({
      model: new ScriptedChatModel([aiCall("update_order_status", { id: 4, status: "shipped" }), aiText("done"), aiText("done")]),
      tools,
      guardrails: new GuardrailsService(new MetricsService()),
      tracer: new Tracer([new MemorySink()], { inPerM: 0, outPerM: 0 }),
      emit: (e) => events.push(e),
      checkpointer: new MemorySaver(),
      maxSteps: 4,
    });
    const cfg = { configurable: { thread_id: `${role}-${approved}` } };
    const tracer = new Tracer([new MemorySink()], { inPerM: 0, outPerM: 0 });
    await tracer.trace({ name: "t", userSub: role }, async () => {
      await graph.invoke({ messages: [new HumanMessage("Mark order 4 as shipped")] }, cfg);
      await graph.invoke(new Command({ resume: { approved } }), cfg);
    });
    await gateway.close();
    return { events, tools };
  }

  it("lists the tools and marks update_order_status as a write via readOnlyHint", async () => {
    const gateway = factory(await sign("viewer", "viewer"));
    const tools = await mcpTools(gateway);
    await gateway.close();
    expect(Object.fromEntries(tools.map((t) => [t.name, t.write]))).toEqual({
      list_orders: false,
      get_order: false,
      update_order_status: true,
      get_audit_log: false,
    });
  });

  it("answers read calls for a viewer with the viewer's own token", async () => {
    const gateway = factory(await sign("viewer", "viewer"));
    const res = await gateway.callTool("get_order", { id: 4 });
    await gateway.close();
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.text)).toMatchObject({ id: 4 });
  });

  it("viewer: approval is granted but SecureMCP answers Forbidden", async () => {
    const { events } = await runWrite("viewer", true);
    const result = events.find((e) => e.type === "tool_result");
    expect(result).toMatchObject({ isError: true });
    expect(String(result?.preview)).toMatch(/Forbidden: user 'viewer'/);
  });

  it("admin: the approved write succeeds", async () => {
    const { events } = await runWrite("admin", true);
    const result = events.find((e) => e.type === "tool_result");
    expect(result).toMatchObject({ isError: false });
    expect(String(result?.preview)).toContain('"status": "shipped"');
  });

  it("admin: the audit log shows the denied viewer call and the allowed admin call", async () => {
    const gateway = factory(await sign("admin", "admin"));
    const res = await gateway.callTool("get_audit_log", { limit: 50 });
    await gateway.close();
    const rows = JSON.parse(res.text) as { username: string; tool: string; decision: string }[];
    expect(rows.some((r) => r.username === "viewer" && r.tool === "update_order_status" && r.decision === "denied")).toBe(true);
    expect(rows.some((r) => r.username === "admin" && r.tool === "update_order_status" && r.decision === "allowed")).toBe(true);
  });

  it("rejects a bad token at the transport", async () => {
    const gateway = factory("garbage");
    await expect(gateway.listTools()).rejects.toThrow();
    await gateway.close();
  });
});
