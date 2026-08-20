import { describe, expect, it } from "vitest";
import { researchSessions } from "../../drizzle/schema";

describe("research-session intent storage", () => {
  it("uses unrestricted text for detailed research interpretations", () => {
    const detailedIntent = "Identify the best Italian restaurants in Jaipur, India, with current trustworthy picks suitable for dine-in; compare price level, vibe, vegetarian options, alcohol availability, and reservation details.";

    expect(detailedIntent.length).toBeGreaterThan(80);
    expect(researchSessions.intent.getSQLType()).toBe("text");
  });
});
