import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SearchToolResult } from "../searchPipeline.js";
import { resolveImageToDataUri } from "../../embedding/gemini.js";
import { toBundleResponse } from "../format.js";

// Three interchangeable ways for an agent to supply a reference image. Prefer path or url:
// a calling LLM cannot realistically emit a whole base64 image as a tool argument (a 400KB
// JPEG is ~550k characters), so base64 is really only usable by programmatic clients.
export const IMAGE_INPUT_SCHEMA = {
  image_path: z
    .string()
    .optional()
    .describe("Path to a local image file, absolute or relative to the server's cwd (e.g. 'data/images/0146721001.jpg'). Preferred."),
  image_url: z.string().url().optional().describe("Public URL of a reference image. Preferred over base64."),
  image_base64: z
    .string()
    .optional()
    .describe("Reference image as raw base64 or a data: URI. For programmatic clients; prefer image_path or image_url."),
};

export interface ToolImageInput {
  image_path?: string;
  image_url?: string;
  image_base64?: string;
}

/**
 * Normalises whichever image field the caller supplied into a data: URI for the pipeline.
 * Returns undefined when no image was given and `required` is false.
 */
export async function resolveToolImage(
  input: ToolImageInput,
  opts: { required: boolean; label: string },
): Promise<string | undefined> {
  const supplied = [input.image_path, input.image_url, input.image_base64].filter(Boolean);

  if (supplied.length === 0) {
    if (opts.required) {
      throw new Error(
        `${opts.label} requires a reference image: pass image_path (preferred), image_url, or image_base64.`,
      );
    }
    return undefined;
  }
  if (supplied.length > 1) {
    throw new Error(`Pass only one of image_path, image_url or image_base64 — received ${supplied.length}.`);
  }

  return resolveImageToDataUri({
    imagePath: input.image_path,
    imageUrl: input.image_url,
    imageBase64: input.image_base64,
  });
}

interface ProductResultForText {
  productId: string;
  title: string;
  priceUsd: number | null;
  imageUrl: string | null;
  imagePath: string | null;
}

function formatPrice(priceUsd: number | null): string {
  return priceUsd === null ? "unavailable in source catalog" : `$${priceUsd.toFixed(2)} USD`;
}

function formatProductLine(product: ProductResultForText): string {
  const image = product.imageUrl ?? product.imagePath ?? "unavailable in source catalog";
  return `- ${product.title} (${product.productId}) — price: ${formatPrice(product.priceUsd)}; image: ${image}`;
}

function toBuyerFacingBundleOffer(result: SearchToolResult):
  | {
      heading: string;
      message: string;
      anchorProductId: string;
      bundleProductIds: string[];
      proposedTotalUsd: number;
      savingsUsd: number;
    }
  | undefined {
  if (!result.automaticBundleSuggestion) return undefined;
  const bundle = toBundleResponse(result.automaticBundleSuggestion);
  if (bundle.bundleItems.length === 0) return undefined;

  return {
    heading: "Automatic bundle offer",
    message:
      `Complete the set: add ${bundle.bundleItems.map((item) => item.title).join(" + ")} to ` +
      `"${bundle.anchor.title}" for $${bundle.proposal.proposedTotalUsd} USD ` +
      `(save $${bundle.proposal.savingsUsd}).`,
    anchorProductId: bundle.anchor.productId,
    bundleProductIds: bundle.bundleItems.map((item) => item.productId),
    proposedTotalUsd: bundle.proposal.proposedTotalUsd,
    savingsUsd: bundle.proposal.savingsUsd,
  };
}

function formatSearchText(result: SearchToolResult): string {
  const ranked = result.rankedResults ?? [];
  const secondary = result.secondaryResults ?? [];
  const bundleOffer = toBuyerFacingBundleOffer(result);
  const lines = [
    `session_id: ${result.sessionId} — ${ranked.length} matching product(s), ${secondary.length} secondary/near-miss product(s).`,
  ];

  if (ranked.length > 0) {
    lines.push("Matching product metadata:", ...ranked.map(formatProductLine));
  }
  if (bundleOffer) {
    // This lives immediately after primary matches so a chat agent sees it as part of the
    // recommendation, not optional diagnostic metadata appended after near-misses.
    lines.push(`${bundleOffer.heading} — include in the buyer-facing reply:`, bundleOffer.message);
  }
  if (secondary.length > 0) {
    lines.push("Secondary product metadata:", ...secondary.map(formatProductLine));
  }
  lines.push("Each structured result also includes catalogMetadata and explicit availability flags.");
  return lines.join("\n");
}

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

  const bundleOffer = toBuyerFacingBundleOffer(result);

  return {
    content: [
      {
        type: "text",
        text: formatSearchText(result),
      },
    ],
    structuredContent: {
      status: "ok",
      session_id: result.sessionId,
      ranked_results: result.rankedResults ?? [],
      secondary_results: result.secondaryResults ?? [],
      ...(bundleOffer ? { automatic_bundle_offer: bundleOffer } : {}),
      ...(result.automaticBundleSuggestion
        ? { automatic_bundle_suggestion: toBundleResponse(result.automaticBundleSuggestion) }
        : {}),
    },
  };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
