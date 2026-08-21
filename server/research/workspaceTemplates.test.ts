import { describe, expect, it } from "vitest";
import { buildDecisionArtifact } from "./decisionArtifact";
import { buildGoogleDocTemplate, buildGoogleSheetTemplate, buildGoogleSlidesTemplate } from "./workspaceTemplates";

function artifact() {
  return buildDecisionArtifact({
    title: "Decision brief",
    researchGoal: "Choose an evidence-led platform.",
    outputFormat: "comparison",
    finalSynthesis: "## Answer\n\nChoose Option A when source traceability is decisive.",
    sources: [{ id: "source-a", title: "Primary source", url: "https://example.org/source", publisher: "Example", excerpt: "A direct source excerpt." }],
    findings: [{ id: "finding-a", title: "Traceability", claim: "Option A retains linked evidence.", evidence: "Documentation describes source links.", citationSourceIdsJson: '["source-a"]' }],
    recommendation: { criteria: ["Traceability", "Workflow fit"], options: [{ rank: 1, name: "Option A", summary: "Evidence-led choice.", strengths: ["Linked sources"], caveats: ["Verify pricing."], evidence: [{ claim: "Sources are retained.", sourceUrls: ["https://example.org/source"] }] }], selectionAdvice: "Select Option A for auditable research." },
  });
}

describe("Google Workspace export templates", () => {
  it("renders a Docs-ready decision brief with retained source links", () => {
    const doc = buildGoogleDocTemplate(artifact());
    expect(doc.body).toContain("## Evidence matrix");
    expect(doc.body).toContain("https://example.org/source");
    expect(doc.body).toContain("Select Option A for auditable research.");
    expect(doc.blocks[0]).toMatchObject({ kind: "title", text: "Decision brief" });
    expect(doc.blocks.some(block => block.kind === "heading" && block.text === "Executive synthesis")).toBe(true);
    expect(doc.blocks.some(block => block.kind === "bullet" && block.text === "Traceability")).toBe(true);
    expect(doc.blocks.some(block => block.kind === "sourceLink" && block.link === "https://example.org/source")).toBe(true);
  });

  it("renders a Sheets-ready evidence ledger and option comparison", () => {
    const sheet = buildGoogleSheetTemplate(artifact());
    expect(sheet.sheets.map(tab => tab.name)).toEqual(["Decision brief", "Options", "Evidence matrix", "Source ledger"]);
    expect(sheet.sheets[3].rows[1]).toContain("https://example.org/source");
    expect(sheet.sheets.every(tab => tab.columnWidths.length === tab.rows[0]?.length)).toBe(true);
    expect(sheet.sheets[2].rows[1]?.[4]).toContain("HYPERLINK");
  });

  it("renders a Slides-ready narrative with an auditable source appendix", () => {
    const slides = buildGoogleSlidesTemplate(artifact());
    expect(slides.slides.map(slide => slide.title)).toContain("Source appendix");
    expect(slides.slides.find(slide => slide.title === "Options and recommendation")?.sourceUrls).toContain("https://example.org/source");
    expect(slides.slides[0]?.layout).toBe("cover");
    expect(slides.slides.find(slide => slide.title === "Source appendix")?.layout).toBe("appendix");
  });
});
