import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PRODUCT_CATEGORIES, type ProductCategory } from "../../types/catalog.js";
import { runSearch } from "../searchPipeline.js";
import {
  IMAGE_INPUT_SCHEMA,
  errorResult,
  resolveToolImage,
  searchResultToCallToolResult,
} from "./shared.js";

const CATEGORY_ENUM = PRODUCT_CATEGORIES as [ProductCategory, ...ProductCategory[]];

export function registerSearchExactProduct(server: McpServer): void {
  server.registerTool(
    "search_exact_product",
    {
      title: "Search exact product",
      description:
        "Find products matching a complex natural-language query and/or an optional reference " +
        "image (e.g. 'ANC earbuds, good sound, black, under $200'). Returns ranked, justified " +
        "matches plus a few secondary near-misses, or a clarification question if the request is " +
        "too underspecified to search confidently. Supply any image as image_path or image_url.",
      inputSchema: {
        query: z.string().min(1).describe("Buyer's natural-language shopping request"),
        ...IMAGE_INPUT_SCHEMA,
        category: z.enum(CATEGORY_ENUM).optional().describe("Narrows the search to one category, if known"),
      },
    },
    async ({ query, image_path, image_url, image_base64, category }) => {
      let imageBase64: string | undefined;
      try {
        imageBase64 = await resolveToolImage(
          { image_path, image_url, image_base64 },
          { required: false, label: "search_exact_product" },
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const result = await runSearch({
        query,
        imageBase64,
        category,
        originTool: "search_exact_product",
      });
      return searchResultToCallToolResult(result);
    },
  );
}
