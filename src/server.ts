import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "b2a-merchant-mcp",
  version: "0.1.0",
});

// Smoke-test tool, confirms the server + transport wiring works end to end.
// Real tools are registered in src/mcp/tools and wired in from here in Phase 6.
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
