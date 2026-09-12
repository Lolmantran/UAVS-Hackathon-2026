import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProduct, getAllProducts } from "../../catalog/repository.js";
import { getComplementaryCandidates } from "../../bundling/engine.js";
import { runSearch } from "../searchPipeline.js";
import { searchResultToCallToolResult, errorResult } from "./shared.js";

export function registerFindComplementaryProduct(server: McpServer): void {
  server.registerTool(
    "find_complementary_product",
    {
      title: "Find complementary product",
      description:
        "Given an existing product (e.g. a shirt), find products that go with it (e.g. pants), " +
        "optionally narrowed by stated preferences (e.g. 'straight fit'). Candidates are drawn " +
        "from the same category's documented 'goes-with' taxonomy groups, then ranked. Returns a " +
        "clarification question if stated preferences are too ambiguous to rank confidently.",
      inputSchema: {
        anchor_product_id: z.string().min(1).describe("Product id to find complementary items for"),
        intent_text: z
          .string()
          .optional()
          .describe("Optional stated preferences for the complementary item, e.g. fit/material/color"),
      },
    },
    async ({ anchor_product_id, intent_text }) => {
      const anchor = getProduct(anchor_product_id);
      if (!anchor) {
        return errorResult(`Unknown anchor_product_id: ${anchor_product_id}`);
      }

      const candidatePool = getComplementaryCandidates(anchor, getAllProducts());
      if (candidatePool.length === 0) {
        return searchResultToCallToolResult({
          status: "ok",
          sessionId: "n/a",
          rankedResults: [],
          secondaryResults: [],
        });
      }

      const query =
        intent_text ??
        `Find a product that pairs well with "${anchor.title}" (${anchor.category}).`;

      const result = await runSearch({
        query,
        category: anchor.category,
        originTool: "find_complementary_product",
        candidatePool,
        anchorProductId: anchor.id,
      });
      return searchResultToCallToolResult(result);
    },
  );
}
