import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve project files from this module's location, not process.cwd(): MCP clients launch the
// server from whatever directory they were started in, so cwd-relative paths silently miss
// .env, data/ and var/.
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
