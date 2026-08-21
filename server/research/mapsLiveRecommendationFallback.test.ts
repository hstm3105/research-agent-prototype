import { describe, expect, it } from "vitest";
import { synthesizeLocalPlaceRecommendation } from "./agent";
import { searchLocalRecommendationPlaces } from "./places";

const runLive = process.env.RUN_MAPS_RECOMMENDATION_LIVE_TEST === "1";

describe.skipIf(!runLive)("live Maps-first local recommendation synthesis", () => {
  it("builds a structured Jaipur café shortlist without invoking Gemini Search grounding", async () => {
    const intent = {
      title: "Cute and aesthetic cafés in Jaipur",
      intent: "Recommend a diverse local café shortlist",
      researchGoal: "Find three cute and aesthetic cafés in Jaipur and explain how to choose among them.",
      requiresClarification: false,
      clarifyingQuestion: "",
      outputFormat: "comparison" as const,
      plan: [],
    };
    const places = await searchLocalRecommendationPlaces(intent.researchGoal);
    const sources = places.map(place => ({ title: place.title, url: place.url, publisher: place.publisher, excerpt: place.excerpt }));
    const shortlist = await synthesizeLocalPlaceRecommendation(intent, sources);

    expect(shortlist?.options).toHaveLength(3);
    expect(shortlist?.criteria.length).toBeGreaterThanOrEqual(2);
    expect(shortlist?.options.every(option => option.evidence.every(item => item.sourceUrls.every(url => sources.some(source => source.url === url))))).toBe(true);
  }, 45_000);
});
