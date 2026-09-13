// Zod schema(s) for the raw JSON the model returns, shared by intent.ts and any test script.
import { z } from "zod";
import { PRODUCT_CATEGORIES, type ProductCategory } from "../types/catalog.js";

const CATEGORY_VALUES = PRODUCT_CATEGORIES as [ProductCategory, ...ProductCategory[]];

export const RawCriterionSchema = z.object({
  attribute: z.string().min(1),
  description: z.string().min(1),
  importance: z.enum(["mandatory", "preferred"]),
  rawPhrase: z.string().min(1),
});

// No .min(1) here: Gemini sometimes emits an empty {question:"",reason:""} object even when
// needsClarification is false (it should omit the field entirely, but doesn't always). Rejecting
// that at the base-schema level used to throw the whole extraction out — see superRefine below,
// which enforces non-empty text only in the branch where the content is actually read/used.
export const RawClarificationSchema = z.object({
  question: z.string(),
  reason: z.string(),
});

// Mirrors the JSON shape we instruct the model to produce (see intent.ts's prompt).
export const RawExtractionSchema = z
  .object({
    needsClarification: z.boolean(),
    category: z.enum(CATEGORY_VALUES).nullable(),
    // Separate, dedicated field for the fundamental product type — NOT one entry among
    // criteria[]. Earlier we asked the model to add an "item_type" criterion inside the
    // criteria array via prompt instruction alone, and it would routinely ignore that and
    // either bundle style/material modifiers into it (making it fail literal text matching
    // against sparse catalog data) or key it under an inconsistent attribute name entirely
    // (e.g. "garment_type"), silently breaking rank.ts's item-type-priority sort. Giving it
    // its own required schema field makes both failure modes structurally impossible instead
    // of relying on instruction-following.
    itemType: z.string().min(1),
    useCaseSummary: z.string().min(1),
    criteria: z.array(RawCriterionSchema),
    clarification: RawClarificationSchema.optional(),
  })
  .superRefine((val, ctx) => {
    // clarification is required, and must actually have content, exactly when
    // needsClarification is true. When false, any clarification the model sent (even an
    // empty placeholder object) is simply ignored downstream — see toExtractionResult.
    if (!val.needsClarification) return;
    if (!val.clarification) {
      ctx.addIssue({
        code: "custom",
        message: "clarification is required when needsClarification is true",
        path: ["clarification"],
      });
      return;
    }
    if (!val.clarification.question.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "clarification.question must be non-empty when needsClarification is true",
        path: ["clarification", "question"],
      });
    }
    if (!val.clarification.reason.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "clarification.reason must be non-empty when needsClarification is true",
        path: ["clarification", "reason"],
      });
    }
  });

export type RawExtraction = z.infer<typeof RawExtractionSchema>;
