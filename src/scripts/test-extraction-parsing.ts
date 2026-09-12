// Throwaway script exercising parseExtractionOutput against hand-crafted fake model-output
// strings — no GEMINI_API_KEY needed since it never calls the network. Run with:
//   npx tsx src/scripts/test-extraction-parsing.ts
import { parseExtractionOutput } from "../extraction/intent.js";

const cases: Array<{ name: string; raw: string; expectOk: boolean }> = [
  {
    name: "valid: ok result with mandatory + preferred criteria",
    raw: JSON.stringify({
      needsClarification: false,
      category: "electronics",
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
      useCaseSummary: "Wants pants to go with a specific shirt.",
      criteria: [],
    }),
    expectOk: false,
  },
];

let failures = 0;
for (const c of cases) {
  const outcome = parseExtractionOutput(c.raw);
  const pass = outcome.ok === c.expectOk;
  console.log(`${pass ? "PASS" : "FAIL"} - ${c.name}`);
  if (!pass) {
    failures++;
    console.log("  expected ok =", c.expectOk, "got:", JSON.stringify(outcome));
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
