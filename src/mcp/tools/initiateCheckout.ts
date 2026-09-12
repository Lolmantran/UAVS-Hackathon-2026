import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProduct, getAllProducts } from "../../catalog/repository.js";
import { getSession } from "../../session/store.js";
import { getComplementaryCandidates, BUNDLE_DISCOUNT_PERCENT } from "../../bundling/engine.js";
import { toProductSummary } from "../format.js";
import { errorResult } from "./shared.js";

// Mocked, API-driven "closing the loop" step — no real payment/inventory system behind this.
// Catalog prices are USD (real Amazon 2023 metadata), not AUD as products.md originally assumed;
// reported as-is rather than applying a fabricated exchange rate.
export function registerInitiateCheckout(server: McpServer): void {
  server.registerTool(
    "initiate_checkout",
    {
      title: "Initiate checkout",
      description:
        "Mocked API-driven checkout: finalizes a purchase for the given product selection under " +
        "an existing session. Applies the bundle discount automatically if the selection includes " +
        "a known complementary pair. Returns a fake order confirmation, not a real transaction.",
      inputSchema: {
        session_id: z.string().min(1).describe("An active session_id from a prior search/match/bundle call"),
        selected_product_ids: z.array(z.string().min(1)).min(1).describe("Product ids the buyer's agent selected to purchase"),
      },
    },
    async ({ session_id, selected_product_ids }) => {
      const session = getSession(session_id);
      if (!session) {
        return errorResult(`Unknown or expired session_id: ${session_id}`);
      }

      const products = selected_product_ids.map((id) => getProduct(id));
      const missing = selected_product_ids.filter((_, i) => !products[i]);
      if (missing.length > 0) {
        return errorResult(`Unknown product id(s): ${missing.join(", ")}`);
      }
      const resolvedProducts = products.map((p) => p!);

      const missingPrice = resolvedProducts.filter((p) => p.priceUsd === null).map((p) => p.id);
      const subtotal = resolvedProducts.reduce((sum, p) => sum + (p.priceUsd ?? 0), 0);

      const catalog = getAllProducts();
      const discountApplies = resolvedProducts.some((anchor) => {
        const complements = new Set(getComplementaryCandidates(anchor, catalog).map((p) => p.id));
        return resolvedProducts.some((other) => other.id !== anchor.id && complements.has(other.id));
      });
      const discountPercent = discountApplies ? BUNDLE_DISCOUNT_PERCENT : 0;
      const total = subtotal * (1 - discountPercent / 100);

      const payload = {
        status: "confirmed" as const,
        orderId: randomUUID(),
        sessionId: session_id,
        currency: "USD",
        items: resolvedProducts.map(toProductSummary),
        subtotal: round2(subtotal),
        discountPercent,
        total: round2(total),
        notes: [
          "Mocked transaction — no real payment or inventory system behind this.",
          ...(missingPrice.length > 0
            ? [`No price data for: ${missingPrice.join(", ")} — treated as $0 in the subtotal.`]
            : []),
        ],
      };

      return {
        content: [
          {
            type: "text",
            text: `Order ${payload.orderId} confirmed: ${resolvedProducts.length} item(s), total $${payload.total} USD${discountApplies ? ` (${discountPercent}% bundle discount applied)` : ""}.`,
          },
        ],
        structuredContent: payload,
      };
    },
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
