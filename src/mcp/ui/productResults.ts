import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import { getProduct } from "../../catalog/repository.js";
import { resolveImageBytes } from "../../embedding/gemini.js";
import { logLine } from "../../config/logger.js";

// MCP Apps UI for product results. Image content blocks in a tool result reach the calling model,
// but chat hosts don't show them to the user — so product-returning tools also point at this
// ui:// resource, which compliant hosts (Claude, ChatGPT, VS Code, Goose...) render inline as
// product cards built from the same tool result, photos included.
export const PRODUCT_RESULTS_URI = "ui://b2a-merchant/product-results.html";

/** Spread into a tool's config as `_meta` so hosts render its results with the product-card UI. */
export const PRODUCT_RESULTS_TOOL_META = {
  ui: { resourceUri: PRODUCT_RESULTS_URI },
  // Legacy flat key, still read by hosts that predate the nested `ui` object.
  [RESOURCE_URI_META_KEY]: PRODUCT_RESULTS_URI,
};

const SDK_MARKER = "/*__MCP_APPS_SDK__*/";

let cachedHtml: string | undefined;

// The view runs in a sandboxed iframe whose default CSP blocks network scripts, so the App SDK
// bundle is inlined rather than loaded from a CDN. The bundle is an ES module ending in a single
// `export{a as B,...}` statement; that is rewritten into a returned object, and the whole bundle is
// wrapped in a function so its minified top-level names can't collide with the view's own code,
// which only sees `__mcpApps`.
function buildHtml(): string {
  if (cachedHtml) return cachedHtml;

  const bundlePath = fileURLToPath(import.meta.resolve("@modelcontextprotocol/ext-apps/app-with-deps"));
  const bundle = readFileSync(bundlePath, "utf8");
  const exportMatch = /export\s*\{([^}]*)\}\s*;?\s*$/.exec(bundle);
  if (!exportMatch) {
    throw new Error(`Unexpected MCP Apps SDK bundle format (no trailing export) at ${bundlePath}`);
  }
  const entries = exportMatch[1].split(",").map((spec) => {
    const [local, exported] = spec.trim().split(/\s+as\s+/);
    return `${exported ?? local}:${local}`;
  });
  const inlinedSdk =
    `const __mcpApps=(()=>{\n${bundle.slice(0, exportMatch.index)}\nreturn{${entries.join(",")}};\n})();`.replace(
      /<\/script/gi,
      "<\\/script",
    );

  const template = readFileSync(new URL("./product-results.html", import.meta.url), "utf8");
  // Function replacer: the minified bundle is full of `$`, which a string replacement would mangle.
  cachedHtml = template.replace(SDK_MARKER, () => inlinedSdk);
  return cachedHtml;
}

export function registerProductResultsUi(server: McpServer): void {
  registerAppResource(
    server,
    "Product results",
    PRODUCT_RESULTS_URI,
    { description: "Product cards with photos for search, match, complementary and bundle results." },
    async () => ({
      contents: [{ uri: PRODUCT_RESULTS_URI, mimeType: RESOURCE_MIME_TYPE, text: buildHtml() }],
    }),
  );

  // Hosts don't reliably forward a tool result's image blocks to the view (and results only carry
  // the first few photos anyway), so the view fetches each card's photo itself through this tool.
  // App-only visibility keeps it out of the model's tool list.
  server.registerTool(
    PRODUCT_PHOTO_TOOL,
    {
      title: "Get product photo",
      description: "Returns a catalog product's photo for the product-results view. UI-only.",
      inputSchema: { product_id: z.string().min(1).describe("Catalog product id") },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ product_id }) => {
      const product = getProduct(product_id);
      if (!product?.imagePath && !product?.imageUrl) {
        return { content: [{ type: "text", text: `No photo for product ${product_id}.` }], isError: true };
      }
      try {
        const { mimeType, data } = await resolveImageBytes(
          product.imagePath ? { imagePath: product.imagePath } : { imageUrl: product.imageUrl ?? undefined },
        );
        return { content: [{ type: "image", data, mimeType }] };
      } catch (err) {
        logLine(`photo unavailable for ${product_id}: ${(err as Error).message}`);
        return { content: [{ type: "text", text: `Photo unavailable for ${product_id}.` }], isError: true };
      }
    },
  );
}

export const PRODUCT_PHOTO_TOOL = "get_product_photo";
