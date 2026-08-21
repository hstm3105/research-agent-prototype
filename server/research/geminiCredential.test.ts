import { describe, expect, it } from "vitest";

describe("Gemini credential", () => {
  it("authenticates to the Gemini model catalog", async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    expect(apiKey?.trim()).toBeTruthy();

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": apiKey! },
    });

    expect(response.ok).toBe(true);
    const payload = await response.json() as { models?: Array<{ name?: string }> };
    expect(payload.models?.some(model => model.name === "models/gemini-3.5-flash-lite")).toBe(true);
    expect(payload.models?.some(model => model.name === "models/gemini-3.1-flash-lite")).toBe(true);
  }, 20_000);
});
