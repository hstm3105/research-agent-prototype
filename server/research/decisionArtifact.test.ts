import { describe, expect, it } from "vitest";
import { buildDecisionArtifact } from "./decisionArtifact";

describe("decision artifact", () => {
  it("preserves decision structure and resolvable source traceability without resynthesizing research", () => {
    const artifact = buildDecisionArtifact({
      title: "Vendor shortlist",
      researchGoal: "Choose a research platform.",
      outputFormat: "comparison",
      finalSynthesis: "## Answer\n\nOption A is the best fit for a structured evidence workflow.",
      sources: [
        { id: "source-a", title: "Primary documentation", url: "https://example.org/docs", publisher: "Example", excerpt: "Direct documentation.", qualityScore: 82, citationCount: 2 },
      ],
      findings: [{ id: "finding-a", title: "Evidence coverage", claim: "Option A supports source traceability.", evidence: "The documentation describes linked references.", citationSourceIdsJson: '["source-a","missing"]' }],
      recommendation: {
        criteria: ["Traceability", "Workflow fit"],
        options: [{ rank: 1, name: "Option A", summary: "Source-traceable choice.", strengths: ["Linked evidence"], caveats: ["Verify commercial terms."], evidence: [{ claim: "References are linked.", sourceUrls: ["https://example.org/docs"] }] }],
        selectionAdvice: "Choose Option A when traceability is the deciding criterion.",
      },
    });

    expect(artifact.decisionCriteria).toEqual(["Traceability", "Workflow fit"]);
    expect(artifact.findings[0].sourceIds).toEqual(["source-a"]);
    expect(artifact.findings[0].sourceUrls).toEqual(["https://example.org/docs"]);
    expect(artifact.nextActions).toContain("Select the preferred option against the stated decision criteria.");
    expect(artifact.evidenceGaps).toEqual([]);
  });

  it("exposes missing evidence as a decision constraint", () => {
    const artifact = buildDecisionArtifact({ title: "Sparse brief", researchGoal: "Assess a decision.", outputFormat: "report", finalSynthesis: null, sources: [], findings: [] });

    expect(artifact.evidenceGaps).toContain("No attributable public sources were retained for this research run.");
    expect(artifact.nextActions[0]).toContain("Review the evidence gaps");
  });
});
