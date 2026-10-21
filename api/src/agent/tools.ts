import { z } from "zod";
import type { McpGateway } from "../mcp/mcp-gateway.js";
import type { RagService } from "../rag/rag.service.js";
import { neutraliseInstructions } from "../guardrails/untrusted.js";
import type { SourceRef } from "./events.js";

export interface ToolOutcome {
  text: string;
  isError: boolean;
  sources?: SourceRef[];
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON schema of the arguments. */
  parameters: Record<string, unknown>;
  /** Write tools pause for human approval before they run. */
  write: boolean;
  origin: "mcp" | "local";
  execute(args: Record<string, unknown>): Promise<ToolOutcome>;
}

const searchArgs = z.object({
  query: z.string().min(2).max(500),
  k: z.number().int().min(1).max(8).optional(),
});

export function searchKnowledgeTool(rag: Pick<RagService, "search">): AgentTool {
  return {
    name: "search_knowledge",
    origin: "local",
    write: false,
    description:
      "Search the shop's internal knowledge base (return policy, shipping, order statuses, admin runbook) with hybrid full-text + vector search. Returns passages tagged [S<number>]; cite the tags you rely on.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in natural language" },
        k: { type: "integer", description: "Number of passages (default 4)", minimum: 1, maximum: 8 },
      },
      required: ["query"],
    },
    async execute(args) {
      const parsed = searchArgs.safeParse(args);
      if (!parsed.success) return { text: `Invalid arguments: ${parsed.error.message}`, isError: true };
      const hits = await rag.search(parsed.data.query, { k: parsed.data.k ?? 4 });
      if (hits.length === 0) return { text: "No matching passages found.", isError: false, sources: [] };
      const sources: SourceRef[] = hits.map((h) => ({
        tag: `S${h.chunkId}`,
        chunkId: h.chunkId,
        documentId: h.documentId,
        title: h.title,
        ordinal: h.ordinal,
        snippet: neutraliseInstructions(h.content).text.slice(0, 280),
        suspicious: h.suspicious,
        ftsRank: h.ftsRank,
        vectorRank: h.vectorRank,
        fusedScore: h.fusedScore,
        rerankScore: h.rerankScore,
      }));
      const text = hits.map((h) => `[S${h.chunkId}] ${h.content}`).join("\n\n");
      return { text, isError: false, sources };
    },
  };
}

/** Wraps every tool the SecureMCP server offers to this user. Tools without readOnlyHint count as writes. */
export async function mcpTools(gateway: McpGateway): Promise<AgentTool[]> {
  const infos = await gateway.listTools();
  return infos.map((info) => ({
    name: info.name,
    description: info.description,
    parameters: info.inputSchema,
    write: !info.readOnly,
    origin: "mcp" as const,
    async execute(args) {
      const res = await gateway.callTool(info.name, args);
      return { text: res.text, isError: res.isError };
    },
  }));
}

export function toOpenAiTools(tools: AgentTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
