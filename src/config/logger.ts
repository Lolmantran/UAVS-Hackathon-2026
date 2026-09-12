// Stdio MCP transport reserves stdout for the JSON-RPC protocol, so any visibility into what
// the running server is doing has to go somewhere else — a plain file the user can `tail -f`.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const LOG_PATH = path.resolve(process.cwd(), "var/server.log");
mkdirSync(path.dirname(LOG_PATH), { recursive: true });

export function logLine(message: string): void {
  appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
}

export { LOG_PATH };
