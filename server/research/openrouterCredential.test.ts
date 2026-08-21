import { describe, expect, it } from "vitest";

describe("OpenRouter credential", () => {
  it("authenticates to the OpenRouter model catalog", async () => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    expect(apiKey).toMatch(/^sk-or-v1-/);

    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(response.ok).toBe(true);
    const payload = await response.json() as { data?: unknown[] };
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data?.length).toBeGreaterThan(0);
  }, 20_000);
});
