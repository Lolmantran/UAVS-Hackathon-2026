import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProduct, getAllProducts } from "../../catalog/repository.js";
import { getBundleSuggestions } from "../../bundling/engine.js";
import { toBundleResponse } from "../format.js";
import { errorResult, productImageBlocks } from "./shared.js";

export function registerGetBundleSuggestions(server: McpServer): void {
  server.registerTool(
    "get_bundle_suggestions",
    {
      title: "Get bundle suggestions",
      description:
        "Merchant-side upsell: given an anchor product (e.g. facewash), return 1-2 complementary " +
        "products (e.g. toner, moisturiser) with a mocked bundle discount and a proposed bundle " +
        "price, to encourage a larger basket. Informational only — does not create an order.",
      inputSchema: {
        anchor_product_id: z.string().min(1).describe("Product id to build a bundle offer around"),
      },
    },
    async ({ anchor_product_id }) => {
      const anchor = getProduct(anchor_product_id);
      if (!anchor) {
        return errorResult(`Unknown anchor_product_id: ${anchor_product_id}`);
      }

      const bundle = getBundleSuggestions(anchor, getAllProducts());
      const payload = toBundleResponse(bundle);

      return {
        content: [
          {
            type: "text",
            text:
              bundle.items.length > 0
                ? `${bundle.items.length} bundle item(s) suggested alongside "${anchor.title}" — ` +
                  `proposed bundle price $${payload.proposal.proposedTotalUsd} USD ` +
                  `(save $${payload.proposal.savingsUsd} vs. $${payload.proposal.subtotalUsd} full price).`
                : `No complementary products found for "${anchor.title}"'s taxonomy group.`,
          },
          ...(await productImageBlocks([anchor.id, ...bundle.items.map((item) => item.product.id)])),
        ],
        structuredContent: payload,
      };
    },
  );
}
