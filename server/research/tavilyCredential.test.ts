import { describe, expect, it } from "vitest";

describe("Tavily credential", () => {
  it("authenticates a minimal server-side search request", async () => {
    const apiKey = process.env.TAVILY_API_KEY;
    expect(apiKey).toBeTruthy();

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: "Tavily API", search_depth: "fast", max_results: 1 }),
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as { results?: Array<{ url?: string }> };
    expect(payload.results?.[0]?.url).toMatch(/^https?:\/\//);
  }, 30_000);
});
