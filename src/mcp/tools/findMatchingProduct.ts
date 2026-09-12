import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PRODUCT_CATEGORIES, type ProductCategory } from "../../types/catalog.js";
import { runSearch } from "../searchPipeline.js";
import { searchResultToCallToolResult } from "./shared.js";

const CATEGORY_ENUM = PRODUCT_CATEGORIES as [ProductCategory, ...ProductCategory[]];

export function registerFindMatchingProduct(server: McpServer): void {
  server.registerTool(
    "find_matching_product",
    {
      title: "Find matching product",
      description:
        "Given a reference image (a look/style/product the buyer likes) plus stated needs " +
        "(e.g. occasion, fit, material), find catalog products tailored to match both. Returns " +
        "ranked, justified matches plus secondary near-misses, or a clarification question.",
      inputSchema: {
        reference_image_base64: z
          .string()
          .min(1)
          .describe("Reference image to match style/look against, as base64 or a data: URI"),
        intent_text: z
          .string()
          .min(1)
          .describe("Buyer's stated needs/context alongside the image, e.g. occasion, fit, material"),
        category: z.enum(CATEGORY_ENUM).optional().describe("Narrows the search to one category, if known"),
      },
    },
    async ({ reference_image_base64, intent_text, category }) => {
      const result = await runSearch({
        query: intent_text,
        imageBase64: reference_image_base64,
        category,
        originTool: "find_matching_product",
      });
      return searchResultToCallToolResult(result);
    },
  );
}
