import path from "node:path";
import dotenv from "dotenv";
import { PROJECT_ROOT } from "./paths.js";

// quiet: dotenv would otherwise log to stdout, which the stdio MCP transport reserves for JSON-RPC.
dotenv.config({ path: path.join(PROJECT_ROOT, ".env"), quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  geminiApiKey: () => required("GEMINI_API_KEY"),
};
