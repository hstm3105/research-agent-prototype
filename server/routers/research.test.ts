import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  createResearchSession: vi.fn(),
  createResearchShareLink: vi.fn(),
  getActiveResearchShareLinkByTokenHash: vi.fn(),
  getResearchSessionForUser: vi.fn(),
  listResearchCitations: vi.fn(),
  listResearchExports: vi.fn(),
  listResearchFindings: vi.fn(),
  listResearchShareLinksForUser: vi.fn(),
  listResearchSessionsForUser: vi.fn(),
  listResearchSources: vi.fn(),
  listResearchSteps: vi.fn(),
  revokeResearchShareLinkForUser: vi.fn(),
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
    db.listResearchShareLinksForUser.mockResolvedValue([]);

    const caller = researchRouter.createCaller({ user: { id: 42 } } as never);
    const result = await caller.get({ sessionId: "session-123" });

    expect(result?.session.id).toBe("session-123");
    expect(db.getResearchSessionForUser).toHaveBeenCalledWith("session-123", 42);
    expect(db.listResearchCitations).toHaveBeenCalledWith([]);
  });
});

describe("researchRouter extensions", () => {
  it("creates a complementary broaden-scope session only from a completed owner session", async () => {
    db.getResearchSessionForUser.mockResolvedValue({ id: "session-123", userId: 42, status: "complete", title: "Existing brief", query: "Assess the workweek", researchDepth: "standard" });
    db.listResearchSources.mockResolvedValue([{ title: "Existing source" }]);
    db.createResearchSession.mockResolvedValue({ id: "broader-456" });

    const caller = researchRouter.createCaller({ user: { id: 42 } } as never);
    const result = await caller.broaden({ sessionId: "session-123" });

    expect(result).toEqual({ id: "broader-456" });
    expect(db.createResearchSession).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      researchDepth: "standard",
      broadenedFromSessionId: "session-123",
      query: expect.stringContaining("complementary pass"),
    }));
  });

  it("creates a tokenized share link for a completed owner brief and does not return its stored hash", async () => {
    db.getResearchSessionForUser.mockResolvedValue({ id: "session-123", userId: 42, status: "complete" });
    const caller = researchRouter.createCaller({ user: { id: 42 } } as never);

    const result = await caller.createShareLink({ sessionId: "session-123" });

    expect(result?.token).toMatch(/^[A-Za-z0-9_-]{36}$/);
    expect(db.createResearchShareLink).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-123",
      ownerId: 42,
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect((db.createResearchShareLink.mock.calls[0][0] as { tokenHash: string }).tokenHash).not.toBe(result?.token);
  });

  it("returns no public content after a share token has been revoked or is unknown", async () => {
    db.getActiveResearchShareLinkByTokenHash.mockResolvedValue(null);
    const caller = researchRouter.createCaller({ user: null } as never);

    await expect(caller.sharedBrief({ token: "valid-length-token-for-unavailable-brief" })).resolves.toBeNull();
  });

  it("returns a completed evidence bundle through an active read-only share token", async () => {
    db.getActiveResearchShareLinkByTokenHash.mockResolvedValue({ sessionId: "session-123", ownerId: 42, createdAt: new Date("2026-08-21T00:00:00.000Z") });
    db.getResearchSessionForUser.mockResolvedValue({ id: "session-123", userId: 42, status: "complete", title: "Shared research", query: "Assess the evidence", researchGoal: "Assess the evidence", outputFormat: "report", finalOutput: "# Shared research", completedAt: new Date("2026-08-21T00:00:00.000Z") });
    db.listResearchSteps.mockResolvedValue([]);
    db.listResearchSources.mockResolvedValue([]);
    db.listResearchFindings.mockResolvedValue([]);
    db.listResearchCitations.mockResolvedValue([]);
    const caller = researchRouter.createCaller({ user: null } as never);

    const result = await caller.sharedBrief({ token: "valid-length-token-for-active-shared-brief" });

    expect(result?.session).toMatchObject({ id: "session-123", title: "Shared research", finalOutput: "# Shared research" });
    expect(result?.sources).toEqual([]);
    expect(result).not.toHaveProperty("shareLinks");
  });
});
