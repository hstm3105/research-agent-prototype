import { describe, expect, it } from "vitest";
import { searchLocalRecommendationPlaces } from "./places";

const runLive = process.env.RUN_MAPS_LIVE_TEST === "1";

describe.skipIf(!runLive)("live Google Maps Places recommendation fallback", () => {
  it("retrieves a diverse set of named Jaipur café candidates with attributable Maps links", async () => {
    const places = await searchLocalRecommendationPlaces("cute and aesthetic cafes in Jaipur");

    expect(places.length).toBeGreaterThanOrEqual(3);
    expect(new Set(places.map(place => place.title.toLowerCase())).size).toBeGreaterThanOrEqual(3);
    expect(places.slice(0, 3)).toEqual(expect.arrayContaining([
      expect.objectContaining({ publisher: "Google Maps", url: expect.stringContaining("google.com/maps/search") }),
    ]));
  }, 30_000);
});
