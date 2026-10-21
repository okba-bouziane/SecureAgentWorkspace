import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** From the tool's readOnlyHint annotation. Missing annotation means "not read-only" (fail closed). */
  readOnly: boolean;
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}

/** One gateway instance belongs to one signed-in user and carries that user's access token. */
export interface McpGateway {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  close(): Promise<void>;
}

export type McpGatewayFactory = (userToken: string) => McpGateway;

export function httpGatewayFactory(url: string): McpGatewayFactory {
  return (token) => new HttpMcpGateway(url, token);
}

class HttpMcpGateway implements McpGateway {
  private client: Client | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ name: "secure-agent-workspace", version: "1.0.0" });
    // The user's own token goes to SecureMCP unchanged, so its role checks decide what the agent may do.
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  async listTools(): Promise<McpToolInfo[]> {
    const client = await this.connect();
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? t.title ?? t.name,
      inputSchema: t.inputSchema as Record<string, unknown>,
      readOnly: t.annotations?.readOnlyHint === true,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const client = await this.connect();
    const res = await client.callTool({ name, arguments: args });
    const content = Array.isArray(res.content) ? res.content : [];
    const text = content
      .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : ""))
      .filter(Boolean)
      .join("\n");
    return { text: text || "(empty result)", isError: res.isError === true };
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => undefined);
    this.client = null;
  }
}
