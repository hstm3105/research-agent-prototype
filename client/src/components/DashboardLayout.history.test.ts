import { describe, expect, it } from "vitest";
import { filterResearchSessions, getResearchDepthLabel, type ResearchSessionNavItem } from "./DashboardLayout";

const sessions: ResearchSessionNavItem[] = [
  { id: "quick-1", title: "Battery policy brief", status: "complete", researchDepth: "quick", updatedAt: new Date() },
  { id: "deep-1", title: "Grid storage diligence", status: "researching", researchDepth: "deep", updatedAt: new Date() },
  { id: "standard-1", title: "Team collaboration summary", status: "complete", researchDepth: "standard", updatedAt: new Date() },
];

describe("session history helpers", () => {
  it("filters by title, status, or selected research depth", () => {
    expect(filterResearchSessions(sessions, "grid").map(session => session.id)).toEqual(["deep-1"]);
    expect(filterResearchSessions(sessions, "complete").map(session => session.id)).toEqual(["quick-1", "standard-1"]);
    expect(filterResearchSessions(sessions, "deep").map(session => session.id)).toEqual(["deep-1"]);
  });

  it("uses concise accessible labels for each depth", () => {
    expect(getResearchDepthLabel("quick")).toBe("Quick");
    expect(getResearchDepthLabel("standard")).toBe("Standard");
    expect(getResearchDepthLabel("deep")).toBe("Deep");
  });
});
