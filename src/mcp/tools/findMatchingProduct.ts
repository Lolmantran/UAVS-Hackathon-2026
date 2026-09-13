import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PRODUCT_RESULTS_TOOL_META } from "../ui/productResults.js";
import { PRODUCT_CATEGORIES, type ProductCategory } from "../../types/catalog.js";
import { runSearch } from "../searchPipeline.js";
import {
  IMAGE_INPUT_SCHEMA,
  errorResult,
  resolveToolImage,
  searchResultToCallToolResult,
} from "./shared.js";

const CATEGORY_ENUM = PRODUCT_CATEGORIES as [ProductCategory, ...ProductCategory[]];

export function registerFindMatchingProduct(server: McpServer): void {
  server.registerTool(
    "find_matching_product",
    {
      title: "Find matching product",
      _meta: PRODUCT_RESULTS_TOOL_META,
      description:
        "Given a reference image (a look/style/product the buyer likes) plus stated needs " +
        "(e.g. occasion, fit, material), find catalog products tailored to match both. Returns " +
        "ranked, justified matches plus secondary near-misses, or a clarification question. " +
        "Supply the image as image_path (preferred) or image_url.",
      inputSchema: {
        ...IMAGE_INPUT_SCHEMA,
        intent_text: z
          .string()
          .min(1)
          .describe("Buyer's stated needs/context alongside the image, e.g. occasion, fit, material"),
        category: z.enum(CATEGORY_ENUM).optional().describe("Narrows the search to one category, if known"),
      },
    },
    async ({ image_path, image_url, image_base64, intent_text, category }) => {
      let imageBase64: string | undefined;
      try {
        imageBase64 = await resolveToolImage(
          { image_path, image_url, image_base64 },
          { required: true, label: "find_matching_product" },
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const result = await runSearch({
        query: intent_text,
        imageBase64,
        category,
        originTool: "find_matching_product",
      });
      return searchResultToCallToolResult(result);
    },
  );
}
