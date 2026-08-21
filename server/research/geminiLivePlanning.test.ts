import { describe, expect, it } from "vitest";
import { interpretResearchQuery } from "./agent";

describe("Gemini live research planning", () => {
  const runLiveTest = process.env.RUN_GEMINI_LIVE_TEST === "1";

  it.skipIf(!runLiveTest)("interprets a research brief with a structured actionable plan", async () => {
    const intent = await interpretResearchQuery("Compare the evidence for a four-day workweek.", "quick");

    expect(intent.title).toBeTruthy();
    expect(intent.researchGoal).toBeTruthy();
    expect(intent.plan).toHaveLength(2);
    expect(intent.plan.every(step => step.title && step.description && step.searchQuery)).toBe(true);
  }, 45_000);
});
