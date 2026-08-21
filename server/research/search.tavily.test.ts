import { afterEach, describe, expect, it, vi } from "vitest";
import { searchTavilyWeb } from "./search";

describe("Tavily public-web retrieval", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("normalizes attributable, distinct public-web results for research citation", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [
      { title: "Primary source", url: "https://example.org/report", content: "A relevant source excerpt." },
      { title: "Duplicate", url: "https://example.org/report", content: "Duplicate excerpt." },
      { title: "Unsafe", url: "javascript:alert(1)", content: "Ignored." },
    ] }), { status: 200 }));

    const sources = await searchTavilyWeb("research topic");

    expect(sources).toEqual([expect.objectContaining({
      title: "Primary source",
      url: "https://example.org/report",
      publisher: "example.org",
      excerpt: "A relevant source excerpt.",
      retrievedAt: expect.any(Date),
    })]);
    expect(global.fetch).toHaveBeenCalledWith("https://api.tavily.com/search", expect.objectContaining({ method: "POST" }));
  });
});
