// Live tool-routing eval: does the configured real model pick the right tool for each prompt?
// Needs LLM_API_KEY (or a local server). Not part of CI, because it depends on an external model.
//   npm run evals:live   (reads ../.env when run with: node --env-file=../.env ...)
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { openAiCompatibleFactory } from "../src/agent/llm.js";
import { SYSTEM_PROMPT } from "../src/agent/prompt.js";
import { toOpenAiTools, type AgentTool } from "../src/agent/tools.js";
import { loadConfig } from "../src/config.js";
import data from "./dataset.json" with { type: "json" };

const cfg = loadConfig();
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const mk = (name: string, description: string, parameters: Record<string, unknown>, write = false): AgentTool => ({
  name,
  description,
  parameters,
  write,
  origin: "local",
  execute: async () => ({ text: "", isError: false }),
});
// Same definitions SecureMCP and the knowledge tool expose to the agent.
const tools = [
  mk("search_knowledge", "Search the shop's internal knowledge base (return policy, shipping, order statuses, admin runbook). Returns passages tagged [S<number>].", obj({ query: { type: "string" } }, ["query"])),
  mk("list_orders", "List all orders, optionally filtered by status. Roles: viewer, admin.", obj({ status: { type: "string", enum: ["pending", "paid", "shipped", "delivered", "cancelled"] } })),
  mk("get_order", "Get a single order by id. Roles: viewer, admin.", obj({ id: { type: "integer" } }, ["id"])),
  mk("update_order_status", "Change the status of an order. Roles: admin.", obj({ id: { type: "integer" }, status: { type: "string", enum: ["pending", "paid", "shipped", "delivered", "cancelled"] } }, ["id", "status"]), true),
  mk("get_audit_log", "Read the most recent tool-call audit entries (newest first). Roles: admin.", obj({ limit: { type: "integer" } })),
];

const cases = data.routing.filter((c) => tools.some((t) => t.name === c.tool));
const model = openAiCompatibleFactory(cfg)().bindTools(toOpenAiTools(tools));
let correct = 0;
for (const c of cases) {
  const reply = await model.invoke([new SystemMessage(SYSTEM_PROMPT), new HumanMessage(c.prompt)]);
  const picked = (reply.tool_calls ?? []).map((t) => t.name);
  const ok = picked[0] === c.tool;
  if (ok) correct += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.prompt}  ->  ${picked.join(", ") || "(no tool)"}  (expected ${c.tool})`);
  await new Promise((r) => setTimeout(r, Number(process.env.PACE_MS ?? 8000))); // free-tier tokens-per-minute limits
}
const accuracy = correct / cases.length;
console.log(`\nlive routing accuracy: ${correct}/${cases.length} = ${accuracy.toFixed(2)} (model ${cfg.LLM_MODEL}, threshold ${data.thresholds.liveRoutingAccuracy})`);
process.exit(accuracy >= data.thresholds.liveRoutingAccuracy ? 0 : 1);
