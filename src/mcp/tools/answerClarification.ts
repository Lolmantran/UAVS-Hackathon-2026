import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PRODUCT_RESULTS_TOOL_META } from "../ui/productResults.js";
import { resumeSearch } from "../searchPipeline.js";
import { searchResultToCallToolResult, errorResult } from "./shared.js";

export function registerAnswerClarification(server: McpServer): void {
  server.registerTool(
    "answer_clarification",
    {
      title: "Answer clarification",
      _meta: PRODUCT_RESULTS_TOOL_META,
      description:
        "Resumes a search/match/complementary-search session after a needs_clarification " +
        "response, merging the buyer's answer back into the original request and re-running " +
        "the same pipeline. May itself return another clarification question if still ambiguous.",
      inputSchema: {
        session_id: z.string().min(1).describe("session_id from the prior needs_clarification response"),
        answer: z.string().min(1).describe("The buyer's answer to the pending clarification question"),
      },
    },
    async ({ session_id, answer }) => {
      try {
        const result = await resumeSearch(session_id, answer);
        return await searchResultToCallToolResult(result);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}
