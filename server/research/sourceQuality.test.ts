import { describe, expect, it } from "vitest";
import { scoreResearchSource } from "./sourceQuality";

describe("scoreResearchSource", () => {
  it("prioritizes available institutional evidence signals above sparse generic metadata", () => {
    const institutional = scoreResearchSource({
      title: "National evidence review on four-day workweek pilots",
      url: "https://www.gov.uk/research/four-day-workweek",
      publisher: "UK Government",
      excerpt: "A detailed review of programme results, methodology, and implementation considerations for employers.",
    }, "four day workweek evidence review", 2);
    const sparse = scoreResearchSource({
      title: "Workweek discussion",
      url: "https://example.com/post",
      publisher: null,
      excerpt: null,
    }, "four day workweek evidence review");

    expect(institutional.score).toBeGreaterThan(sparse.score);
    expect(institutional.label).toBe("High evidence signal");
    expect(institutional.signals).toEqual(expect.arrayContaining(["Primary or institutional domain", "Cited by 2 findings"]));
  });

  it("keeps the score explainable and caps it at one hundred", () => {
    const quality = scoreResearchSource({
      title: "Detailed institutional evidence review for a four-day workweek pilot",
      url: "https://nih.gov/evidence/four-day-workweek",
      publisher: "National Institutes of Health",
      excerpt: "A substantive excerpt that describes evidence, limitations, methods, outcomes, and the decision context in detail.",
    }, "four day workweek evidence review outcomes", 8);

    expect(quality.score).toBeLessThanOrEqual(100);
    expect(quality.signals.length).toBeGreaterThan(2);
  });
});
