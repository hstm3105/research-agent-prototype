import { describe, expect, it } from "vitest";
import { invokeGroundedRecommendationResearch, providerAttemptsFromError } from "./llmProvider";

const enabled = process.env.RUN_GEMINI_LIVE_TEST === "1";

describe.skipIf(!enabled)("live Gemini grounded recommendation research", () => {
  it("returns a multi-source decision-ready Jaipur café shortlist", async () => {
    const result = await invokeGroundedRecommendationResearch({
      request: "Find cute and aesthetic cafes in Jaipur. Return ONLY valid JSON with criteria, options, and selectionAdvice. Include at least three distinct named cafes when the evidence supports it. Each option needs rank, name, summary, strengths, caveats, and evidence entries containing a specific claim plus exact grounded sourceUrls.",
    }).catch(error => {
      throw new Error(`Grounded recommendation unavailable: ${JSON.stringify(providerAttemptsFromError(error))}`);
    });

    expect(() => JSON.parse(result.output)).not.toThrow();
    expect(JSON.parse(result.output)).toMatchObject({ criteria: expect.any(Array), options: expect.any(Array), selectionAdvice: expect.any(String) });
    expect(result.sources.length).toBeGreaterThanOrEqual(3);
  }, 45_000);
});
