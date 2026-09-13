import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PRODUCT_CATEGORIES, type Product, type ProductCategory } from "../../types/catalog.js";
import { getProduct, getAllProducts, similaritySearch } from "../../catalog/repository.js";
import { getComplementaryCandidates } from "../../bundling/engine.js";
import { extractIntent } from "../../extraction/intent.js";
import { toProductSummary } from "../format.js";
import { runSearch } from "../searchPipeline.js";
import {
  IMAGE_INPUT_SCHEMA,
  errorResult,
  resolveToolImage,
  searchResultToCallToolResult,
} from "./shared.js";

const CATEGORY_ENUM = PRODUCT_CATEGORIES as [ProductCategory, ...ProductCategory[]];

// Below this, the closest catalog product to the reference image is too dissimilar to trust as
// an anchor — e.g. a photo of something this merchant doesn't sell at all. similarity is
// 1/(1+L2 distance) (see catalog/repository.ts), so this is a judgment call, not a calibrated
// probability; tune it against real usage. Kept as a last-resort net — see resolveAnchor for why
// it's no longer the primary defense against a bad anchor.
const MIN_IMAGE_ANCHOR_SIMILARITY = 0.35;

export function registerFindComplementaryProduct(server: McpServer): void {
  server.registerTool(
    "find_complementary_product",
    {
      title: "Find complementary product",
      description:
        "Given an existing product — by anchor_product_id, or by a reference image of a product " +
        "the buyer already has (e.g. a photo of a shirt they own, which need not be in this " +
        "merchant's catalog) — find products that go with it (e.g. pants), optionally narrowed by " +
        "stated preferences (e.g. 'straight fit'). When given an image, the closest real catalog " +
        "product is resolved first and used as the anchor. Candidates are drawn from the same " +
        "category's documented 'goes-with' taxonomy groups, then ranked. Returns a clarification " +
        "question if stated preferences are too ambiguous to rank confidently.",
      inputSchema: {
        anchor_product_id: z
          .string()
          .optional()
          .describe("Product id already in the catalog to find complementary items for. Omit if supplying an image instead."),
        ...IMAGE_INPUT_SCHEMA,
        category: z
          .enum(CATEGORY_ENUM)
          .optional()
          .describe("Narrows image-based anchor resolution to one category, if known. Ignored when anchor_product_id is given."),
        intent_text: z
          .string()
          .optional()
          .describe("Optional stated preferences for the complementary item, e.g. fit/material/color"),
      },
    },
    async ({ anchor_product_id, image_path, image_url, image_base64, category, intent_text }) => {
      const resolution = await resolveAnchor({ anchor_product_id, image_path, image_url, image_base64, category });
      if (!resolution.ok) return resolution.error;
      const { anchor, resolvedFromImage } = resolution;

      const candidatePool = getComplementaryCandidates(anchor, getAllProducts());
      if (candidatePool.length === 0) {
        return withAnchorNote(
          searchResultToCallToolResult({ status: "ok", sessionId: "n/a", rankedResults: [], secondaryResults: [] }),
          anchor,
          resolvedFromImage,
        );
      }

      // Extraction must never see the anchor's name (suppressPairingCriterion in runSearch also
      // guards this, but keeping the base query anchor-name-free avoids relying on that alone) —
      // otherwise the model tends to encode "pairs with X" as a literal, unsatisfiable mandatory
      // criterion, since no candidate's own text will ever mention the anchor by name. The anchor
      // context that DOES help — for embedding-similarity ranking within the pool — goes through
      // embeddingContextText instead, a separate channel extraction never sees.
      const query = intent_text ?? "Find a product that completes the set.";
      const embeddingContextText = `${intent_text ?? "a complementary product"} that pairs well with "${anchor.title}"`;

      const result = await runSearch({
        query,
        embeddingContextText,
        category: anchor.category,
        originTool: "find_complementary_product",
        candidatePool,
        anchorProductId: anchor.id,
      });
      return withAnchorNote(searchResultToCallToolResult(result), anchor, resolvedFromImage);
    },
  );
}

interface AnchorResolutionOk {
  ok: true;
  anchor: Product;
  resolvedFromImage: boolean;
}
interface AnchorResolutionErr {
  ok: false;
  error: CallToolResult;
}

async function resolveAnchor(input: {
  anchor_product_id?: string;
  image_path?: string;
  image_url?: string;
  image_base64?: string;
  category?: ProductCategory;
}): Promise<AnchorResolutionOk | AnchorResolutionErr> {
  if (input.anchor_product_id) {
    const anchor = getProduct(input.anchor_product_id);
    if (!anchor) {
      return { ok: false, error: errorResult(`Unknown anchor_product_id: ${input.anchor_product_id}`) };
    }
    return { ok: true, anchor, resolvedFromImage: false };
  }

  let imageBase64: string | undefined;
  try {
    imageBase64 = await resolveToolImage(
      { image_path: input.image_path, image_url: input.image_url, image_base64: input.image_base64 },
      { required: true, label: "find_complementary_product (without anchor_product_id, an image is required)" },
    );
  } catch (err) {
    return { ok: false, error: errorResult(err instanceof Error ? err.message : String(err)) };
  }

  // Image-ONLY embedding similarity turned out not to discriminate at all on this catalog: a
  // live test on a red polo shirt photo returned its top-8 nearest neighbors (a skincare gift
  // set, a throw pillow, a phone touch-screen part, and various clothing) all clustered within a
  // 0.004-wide similarity band (0.512-0.516) — nowhere near enough separation for a similarity
  // floor to reject the wrong ones. extractIntent's vision classification has proven reliable all
  // session (correctly named "polo shirt", "chelsea boots", "slip-on low-heel style", etc. from
  // images elsewhere in this pipeline), so we use it here to get a category + item-type text hint
  // first, then run a combined text+image query scoped to that category — combining a real
  // conceptual anchor with the visual signal, rather than relying on the visual signal alone.
  const classification = await extractIntent({
    query: "Identify the fundamental kind of product shown in this reference image.",
    imageBase64,
    category: input.category,
  });
  const classified = classification.status === "ok" ? classification.intent : classification.partialIntent;
  const resolvedCategory = input.category ?? classified.category ?? undefined;

  const matches = await similaritySearch(
    { text: classified.itemType, imageBase64 },
    { category: resolvedCategory, topK: 1 },
  );
  const top = matches[0];

  if (!top || top.similarity < MIN_IMAGE_ANCHOR_SIMILARITY) {
    return {
      ok: false,
      error: errorResult(
        top
          ? `The closest catalog product to this image ("${top.product.title}", similarity ${top.similarity.toFixed(2)}) ` +
            `is too dissimilar to use as a reliable anchor — this merchant's catalog likely doesn't carry anything ` +
            `resembling the reference image (identified as: ${classified.itemType}).`
          : `No catalog product resembles this image at all` +
            `${resolvedCategory ? ` in category "${resolvedCategory}"` : ""} ` +
            `(identified as: ${classified.itemType}).`,
      ),
    };
  }

  return { ok: true, anchor: top.product, resolvedFromImage: true };
}

// Prepends a transparency note when the anchor came from an image, so the caller can see (and a
// demo can show) what the system matched the reference image to before searching for pairings.
function withAnchorNote(result: CallToolResult, anchor: Product, resolvedFromImage: boolean): CallToolResult {
  if (!resolvedFromImage) return result;

  const note = `Resolved reference image to closest catalog match: "${anchor.title}" (${anchor.id}). Finding complementary items for that product.\n\n`;
  const content = result.content.map((block, i) =>
    i === 0 && block.type === "text" ? { ...block, text: note + block.text } : block,
  );

  return {
    ...result,
    content,
    structuredContent: {
      ...(result.structuredContent ?? {}),
      resolved_anchor: toProductSummary(anchor),
    },
  };
}
