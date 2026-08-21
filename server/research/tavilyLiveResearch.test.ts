import { describe, expect, it } from "vitest";
import { searchPublicWeb } from "./search";

const runLive = process.env.RUN_TAVILY_LIVE_TEST === "1";

describe.skipIf(!runLive)("live Tavily general-web research retrieval", () => {
  it("returns diverse, attributable public-web evidence for a non-local research query", async () => {
    const sources = await searchPublicWeb("evidence for and against a four-day workweek");

    expect(sources.length).toBeGreaterThanOrEqual(3);
    expect(new Set(sources.map(source => source.url)).size).toBeGreaterThanOrEqual(3);
    expect(sources.slice(0, 3)).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: expect.stringMatching(/^https?:\/\//), excerpt: expect.any(String) }),
    ]));
    expect(sources.some(source => source.publisher !== "YouTube")).toBe(true);
  }, 30_000);
});
