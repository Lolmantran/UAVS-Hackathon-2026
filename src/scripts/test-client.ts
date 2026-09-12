// Local MCP test client — used through the build to call tools against the running
// server without needing a real buyer-agent. Phase 7 demo scripting expands on this.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const toolName = process.argv[2] ?? "ping";
  const argsJson = process.argv[3] ?? "{}";

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/server.ts"],
  });
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await client.connect(transport);

  const result = await client.callTool({
    name: toolName,
    arguments: JSON.parse(argsJson),
  });

  console.log(JSON.stringify(result, null, 2));
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
