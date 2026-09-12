import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerAllTools } from "./mcp/tools/index.js";
import { logLine, LOG_PATH } from "./config/logger.js";

const server = new McpServer({
  name: "b2a-merchant-mcp",
  version: "0.1.0",
});

// Wrap every tool registration so each call/result/error is visible in var/server.log —
// stdout is reserved for the JSON-RPC protocol itself, so this is the only place to look.
const originalRegisterTool = server.registerTool.bind(server);
server.registerTool = ((name: string, config: unknown, handler: (...a: unknown[]) => unknown) => {
  const wrapped = async (...args: unknown[]) => {
    logLine(`→ ${name} args=${JSON.stringify(args[0] ?? {})}`);
    try {
      const result = await handler(...args);
      logLine(`← ${name} ok result=${JSON.stringify(result).slice(0, 2000)}`);
      return result;
    } catch (err) {
      logLine(`✗ ${name} threw: ${(err as Error).message}`);
      throw err;
    }
  };
  return originalRegisterTool(name as never, config as never, wrapped as never);
}) as typeof server.registerTool;

logLine(`server starting, pid=${process.pid}`);
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
logLine(`server connected, listening on stdio (log file: ${LOG_PATH})`);
