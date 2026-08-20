import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  createResearchSession: vi.fn(),
  getResearchSessionForUser: vi.fn(),
  listResearchCitations: vi.fn(),
  listResearchExports: vi.fn(),
  listResearchFindings: vi.fn(),
  listResearchSessionsForUser: vi.fn(),
  listResearchSources: vi.fn(),
  listResearchSteps: vi.fn(),
  updateResearchSessionForUser: vi.fn(),
}));

vi.mock("../db", () => db);

import { researchRouter } from "./research";

describe("researchRouter.get", () => {
  it("retrieves a session only through the authenticated user scope", async () => {
    db.getResearchSessionForUser.mockResolvedValue({ id: "session-123", userId: 42 });
    db.listResearchSteps.mockResolvedValue([]);
    db.listResearchSources.mockResolvedValue([]);
    db.listResearchFindings.mockResolvedValue([]);
    db.listResearchExports.mockResolvedValue([]);
    db.listResearchCitations.mockResolvedValue([]);

    const caller = researchRouter.createCaller({ user: { id: 42 } } as never);
    const result = await caller.get({ sessionId: "session-123" });

    expect(result?.session.id).toBe("session-123");
    expect(db.getResearchSessionForUser).toHaveBeenCalledWith("session-123", 42);
    expect(db.listResearchCitations).toHaveBeenCalledWith([]);
  });
});
