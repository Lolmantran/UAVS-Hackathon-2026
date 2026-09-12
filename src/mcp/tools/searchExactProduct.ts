import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PRODUCT_CATEGORIES, type ProductCategory } from "../../types/catalog.js";
import { runSearch } from "../searchPipeline.js";
import { searchResultToCallToolResult } from "./shared.js";

const CATEGORY_ENUM = PRODUCT_CATEGORIES as [ProductCategory, ...ProductCategory[]];

export function registerSearchExactProduct(server: McpServer): void {
  server.registerTool(
    "search_exact_product",
    {
      title: "Search exact product",
      description:
        "Find products matching a complex natural-language query and/or a reference image " +
        "(e.g. 'ANC earbuds, good sound, black, under $200'). Returns ranked, justified matches " +
        "plus a few secondary near-misses, or a clarification question if the request is too " +
        "underspecified to search confidently.",
      inputSchema: {
        query: z.string().min(1).describe("Buyer's natural-language shopping request"),
        image_base64: z
          .string()
          .optional()
          .describe("Optional reference image as base64 or a data: URI"),
        category: z.enum(CATEGORY_ENUM).optional().describe("Narrows the search to one category, if known"),
      },
    },
    async ({ query, image_base64, category }) => {
      const result = await runSearch({
        query,
        imageBase64: image_base64,
        category,
        originTool: "search_exact_product",
      });
      return searchResultToCallToolResult(result);
    },
  );
}
