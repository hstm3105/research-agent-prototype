import { makeRequest, type PlacesSearchResult } from "../_core/map";
import type { NormalizedSearchSource } from "./types";

function mapPlaceUrl(input: { name: string; address: string; placeId: string }) {
  const query = `${input.name}, ${input.address}`.trim();
  return input.placeId
    ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(input.placeId)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function placeExcerpt(place: PlacesSearchResult["results"][number]) {
  const details = [place.formatted_address];
  if (typeof place.rating === "number") {
    const count = typeof place.user_ratings_total === "number" ? ` from ${place.user_ratings_total.toLocaleString()} Google Maps ratings` : " on Google Maps";
    details.push(`Listed Google Maps rating: ${place.rating.toFixed(1)}${count}`);
  }
  if (place.business_status) details.push(`Business status: ${place.business_status.replace(/_/g, " ").toLowerCase()}`);
  return details.join(". ");
}

/** Retrieves named local venues through the platform-authenticated Google Maps Places proxy. */
export async function searchLocalRecommendationPlaces(query: string): Promise<NormalizedSearchSource[]> {
  const response = await makeRequest<PlacesSearchResult>("/maps/api/place/textsearch/json", { query });
  if (response.status !== "OK" && response.status !== "ZERO_RESULTS") throw new Error(`Google Maps Places search returned ${response.status}`);
  const retrievedAt = new Date();
  const seenPlaceIds = new Set<string>();
  return response.results
    .filter(place => Boolean(place.name && place.place_id && !seenPlaceIds.has(place.place_id)))
    .slice(0, 8)
    .map(place => {
      seenPlaceIds.add(place.place_id);
      return {
        title: place.name,
        url: mapPlaceUrl({ name: place.name, address: place.formatted_address, placeId: place.place_id }),
        publisher: "Google Maps",
        excerpt: placeExcerpt(place),
        retrievedAt,
      };
    });
}
