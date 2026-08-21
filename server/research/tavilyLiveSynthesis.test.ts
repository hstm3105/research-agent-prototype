import { describe, expect, it } from "vitest";
import { synthesizeResearchBrief } from "./agent";
import { searchPublicWeb } from "./search";

const runLive = process.env.RUN_TAVILY_SYNTHESIS_LIVE_TEST === "1";

describe.skipIf(!runLive)("live Tavily-to-Gemini general research synthesis", () => {
  it("creates a cited evidence-led brief for a non-local research question", async () => {
    const intent = {
      title: "Four-day workweek evidence",
      intent: "Assess the evidence for and against a four-day workweek",
      researchGoal: "Assess the evidence for and against a four-day workweek, including practical implications for employers.",
      requiresClarification: false,
      clarifyingQuestion: "",
      outputFormat: "report" as const,
      plan: [],
    };
    const retrieved = (await searchPublicWeb(intent.researchGoal)).slice(0, 4);
    const sources = retrieved.map((source, index) => ({ ...source, id: `tavily-${index}` }));
    const brief = await synthesizeResearchBrief({
      intent,
      sources,
      findings: sources.map(source => ({
        title: source.title,
        claim: source.excerpt ?? "The source provides evidence relevant to the research question.",
        evidence: `Directly retained public-web excerpt from ${source.publisher ?? "the source"}.`,
        citationSourceIdsJson: JSON.stringify([source.id]),
      })),
    });

    expect(brief.output).toContain("## Answer");
    expect(brief.output.length).toBeGreaterThanOrEqual(180);
    expect(brief.output).toMatch(/https?:\/\//);
  }, 45_000);
});
