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

export const RawClarificationSchema = z.object({
  question: z.string().min(1),
  reason: z.string().min(1),
});

// Mirrors the JSON shape we instruct the model to produce (see intent.ts's prompt).
export const RawExtractionSchema = z
  .object({
    needsClarification: z.boolean(),
    category: z.enum(CATEGORY_VALUES).nullable(),
    useCaseSummary: z.string().min(1),
    criteria: z.array(RawCriterionSchema),
    clarification: RawClarificationSchema.optional(),
  })
  .superRefine((val, ctx) => {
    // clarification is required exactly when needsClarification is true.
    if (val.needsClarification && !val.clarification) {
      ctx.addIssue({
        code: "custom",
        message: "clarification is required when needsClarification is true",
        path: ["clarification"],
      });
    }
  });

export type RawExtraction = z.infer<typeof RawExtractionSchema>;
