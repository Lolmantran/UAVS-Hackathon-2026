// Throwaway script exercising parseExtractionOutput against hand-crafted fake model-output
// strings — no GEMINI_API_KEY needed since it never calls the network. Run with:
//   npx tsx src/scripts/test-extraction-parsing.ts
import { parseExtractionOutput, type ParseOutcome } from "../extraction/intent.js";

const cases: Array<{
  name: string;
  raw: string;
  expectOk: boolean;
  /** Extra check run only when parsing succeeded as expected; return an error string to fail. */
  assert?: (outcome: Extract<ParseOutcome, { ok: true }>) => string | null;
}> = [
  {
    name: "valid: ok result with mandatory + preferred criteria",
    raw: JSON.stringify({
      needsClarification: false,
      category: "electronics",
      itemType: "earbuds",
      useCaseSummary: "Wants wireless earbuds with ANC under a strict budget.",
      criteria: [
        {
          attribute: "price_cap",
          description: "Price must be under $200 AUD",
          importance: "mandatory",
          rawPhrase: "under $200 AUD",
        },
        {
          attribute: "noise_cancellation",
          description: "Must have active noise cancellation",
          importance: "mandatory",
          rawPhrase: "with ANC",
        },
        {
          attribute: "form_factor",
          description: "Prefers a foldable design",
          importance: "preferred",
          rawPhrase: "preferably foldable",
        },
      ],
    }),
    expectOk: true,
  },
  {
    name: "valid: needs_clarification result with clarification present",
    raw: JSON.stringify({
      needsClarification: true,
      category: "clothing",
      itemType: "pants",
      useCaseSummary: "Wants pants to go with a specific shirt.",
      criteria: [
        {
          attribute: "pairs_with",
          description: "Should pair with the referenced shirt",
          importance: "mandatory",
          rawPhrase: "go with this shirt",
        },
      ],
      clarification: {
        question: "What fit and length are you looking for (e.g. slim chinos vs. relaxed trousers)?",
        reason: "No fit, material, or length preference was stated, and it materially changes which pants match.",
      },
    }),
    expectOk: true,
  },
  {
    name: "malformed: truncated/invalid JSON",
    raw: '{ "needsClarification": false, "category": "skincare", "useCaseSummary": "oily skin" ',
    expectOk: false,
  },
  {
    name: "invalid shape: missing required field (rawPhrase) on a criterion",
    raw: JSON.stringify({
      needsClarification: false,
      category: "home-goods",
      itemType: "pan set",
      useCaseSummary: "Wants a non-stick pan set.",
      criteria: [
        {
          attribute: "material",
          description: "Non-stick coating required",
          importance: "mandatory",
          // rawPhrase intentionally omitted
        },
      ],
    }),
    expectOk: false,
  },
  {
    name: "invalid: needsClarification true but clarification omitted",
    raw: JSON.stringify({
      needsClarification: true,
      category: null,
      itemType: "pants",
      useCaseSummary: "Wants pants to go with a specific shirt.",
      criteria: [],
    }),
    expectOk: false,
  },
  {
    name: "invalid shape: itemType missing entirely",
    raw: JSON.stringify({
      needsClarification: false,
      category: "clothing",
      useCaseSummary: "Wants a purple t-shirt.",
      criteria: [],
    }),
    expectOk: false,
  },
  {
    name: "valid: needsClarification false but model sends an empty clarification placeholder anyway",
    raw: JSON.stringify({
      needsClarification: false,
      category: "clothing",
      itemType: "t-shirt",
      useCaseSummary: "Find a men's t-shirt similar to the reference image.",
      criteria: [
        { attribute: "department", description: "For men", importance: "mandatory", rawPhrase: "men's" },
      ],
      clarification: { question: "", reason: "" },
    }),
    expectOk: true,
  },
  {
    name: "invalid: needsClarification true but clarification present with empty strings",
    raw: JSON.stringify({
      needsClarification: true,
      category: "clothing",
      itemType: "t-shirt",
      useCaseSummary: "Find a t-shirt.",
      criteria: [],
      clarification: { question: "", reason: "" },
    }),
    expectOk: false,
  },
  {
    name: "valid: model redundantly adds an item_type-like criterion — dedup drops it, itemType field wins",
    raw: JSON.stringify({
      needsClarification: false,
      category: "clothing",
      itemType: "t-shirt",
      useCaseSummary: "Wants something similar to the reference image.",
      criteria: [
        {
          attribute: "garment_type",
          description: "Short-sleeve t-shirt with a crew neck",
          importance: "mandatory",
          rawPhrase: "similar products",
        },
        {
          attribute: "color",
          description: "Purple",
          importance: "preferred",
          rawPhrase: "similar products",
        },
      ],
    }),
    expectOk: true,
    assert: (outcome) => {
      const intent = outcome.result.status === "ok" ? outcome.result.intent : outcome.result.partialIntent;
      if (intent.criteria.length !== 2) {
        return `expected exactly 2 criteria (synthesized item_type + color), got ${intent.criteria.length}: ${JSON.stringify(intent.criteria)}`;
      }
      const [first, second] = intent.criteria;
      if (first.attribute !== "item_type" || first.description !== "t-shirt") {
        return `expected criteria[0] = synthesized item_type "t-shirt", got ${JSON.stringify(first)}`;
      }
      if (second.attribute !== "color") {
        return `expected criteria[1] = the color criterion, got ${JSON.stringify(second)}`;
      }
      if (intent.criteria.some((c) => c.attribute === "garment_type")) {
        return `model's redundant "garment_type" criterion was not deduped out`;
      }
      return null;
    },
  },
];

let failures = 0;
for (const c of cases) {
  const outcome = parseExtractionOutput(c.raw);
  let pass = outcome.ok === c.expectOk;
  let assertError: string | null = null;
  if (pass && outcome.ok && c.assert) {
    assertError = c.assert(outcome);
    if (assertError) pass = false;
  }

  console.log(`${pass ? "PASS" : "FAIL"} - ${c.name}`);
  if (!pass) {
    failures++;
    if (assertError) {
      console.log("  assertion failed:", assertError);
    } else {
      console.log("  expected ok =", c.expectOk, "got:", JSON.stringify(outcome));
    }
  } else if (!outcome.ok) {
    console.log("  (correctly rejected) error:", outcome.error.slice(0, 200));
  } else {
    console.log("  (correctly parsed) status:", outcome.result.status);
  }
}

if (failures > 0) {
  console.error(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
