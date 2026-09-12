import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerAllTools } from "./mcp/tools/index.js";

const server = new McpServer({
  name: "b2a-merchant-mcp",
  version: "0.1.0",
});

registerAllTools(server);

// Smoke-test tool, kept for quick health checks independent of the real pipeline.
server.registerTool(
  "ping",
  {
    title: "Ping",
    description: "Health check — returns pong plus the received message.",
    inputSchema: { message: z.string().optional() },
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `pong${message ? `: ${message}` : ""}` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
