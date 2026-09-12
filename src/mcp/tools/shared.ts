import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SearchToolResult } from "../searchPipeline.js";

// Shared response formatting for the three search-shaped tools (search_exact_product,
// find_matching_product, find_complementary_product) and answer_clarification, which all
// resolve to the same SearchToolResult shape.
export function searchResultToCallToolResult(result: SearchToolResult): CallToolResult {
  if (result.status === "needs_clarification") {
    return {
      content: [
        {
          type: "text",
          text:
            `Needs clarification (session_id: ${result.sessionId}): ${result.clarification?.question}\n` +
            `Reason: ${result.clarification?.reason}`,
        },
      ],
      structuredContent: {
        status: "needs_clarification",
        session_id: result.sessionId,
        clarification: result.clarification,
      },
    };
  }

  const rankedCount = result.rankedResults?.length ?? 0;
  const secondaryCount = result.secondaryResults?.length ?? 0;

  return {
    content: [
      {
        type: "text",
        text: `session_id: ${result.sessionId} — ${rankedCount} matching product(s), ${secondaryCount} secondary/near-miss product(s) shown for context.`,
      },
    ],
    structuredContent: {
      status: "ok",
      session_id: result.sessionId,
      ranked_results: result.rankedResults ?? [],
      secondary_results: result.secondaryResults ?? [],
    },
  };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
