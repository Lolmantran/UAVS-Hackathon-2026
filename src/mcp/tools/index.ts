import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchExactProduct } from "./searchExactProduct.js";
import { registerFindMatchingProduct } from "./findMatchingProduct.js";
import { registerFindComplementaryProduct } from "./findComplementaryProduct.js";
import { registerGetBundleSuggestions } from "./getBundleSuggestions.js";
import { registerAnswerClarification } from "./answerClarification.js";
import { registerInitiateCheckout } from "./initiateCheckout.js";

export function registerAllTools(server: McpServer): void {
  registerSearchExactProduct(server);
  registerFindMatchingProduct(server);
  registerFindComplementaryProduct(server);
  registerGetBundleSuggestions(server);
  registerAnswerClarification(server);
  registerInitiateCheckout(server);
}
