import { describe, expect, it } from "vitest";
import { renderMarkdownExport, renderPrintHtmlExport } from "./export";

const source = {
  id: "source-1",
  sessionId: "session-1",
  stepId: "step-1",
  sourceType: "web",
  title: "Public evidence source",
  url: "https://example.com/evidence",
  publisher: "Example Institute",
  excerpt: "Evidence excerpt.",
  retrievedAt: new Date(),
};

const exportData = {
  session: { id: "session-1", title: "Research title", query: "Research query", researchGoal: "Assess the evidence.", status: "complete" },
  findings: [{ id: "finding-1", title: "Attributed finding", claim: "A supported claim.", evidence: "The source states this.", ordinal: 0 }],
  sources: [source],
  citations: [{ id: "citation-1", findingId: "finding-1", sourceId: "source-1" }],
} as never;

describe("research exports", () => {
  it("renders per-finding Markdown citations and a reference list", () => {
    const markdown = renderMarkdownExport(exportData);
    expect(markdown).toContain("A supported claim. [1](https://example.com/evidence)");
    expect(markdown).toContain("## References");
    expect(markdown).toContain("Public evidence source");
  });

  it("renders a self-contained print-ready HTML report with linked citations", () => {
    const html = renderPrintHtmlExport(exportData);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="https://example.com/evidence"');
    expect(html).toContain("Print this page to PDF");
  });
});
