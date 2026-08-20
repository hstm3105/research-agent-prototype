import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    addResearchCitations: vi.fn(),
    addResearchFindings: vi.fn(),
    addResearchSources: vi.fn(),
    addResearchStep: vi.fn(),
    getResearchSessionForUser: vi.fn(),
    replaceResearchSteps: vi.fn(),
    updateResearchSessionForUser: vi.fn(),
    updateResearchStep: vi.fn(),
    updateResearchStepDetails: vi.fn(),
  },
  llm: { invokeLLM: vi.fn(), listLLMModels: vi.fn() },
  search: { searchPublicWeb: vi.fn() },
}));

vi.mock("../db", () => mocks.db);
vi.mock("../_core/llm", () => mocks.llm);
vi.mock("./search", async importOriginal => ({ ...(await importOriginal<typeof import("./search")>()), ...mocks.search }));

import { applyPlanAdaptation, runResearchSession, shouldRequestClarification } from "./agent";
import { normalizeSearchPayload } from "./search";

describe("normalizeSearchPayload", () => {
  it("normalizes public video sources returned by the Manus Data API", () => {
    const results = normalizeSearchPayload({
      contents: [{
        type: "video",
        video: {
          title: "Research evidence explained",
          videoId: "abc123",
          descriptionSnippet: "A concise evidence excerpt.",
          author: { title: "Public Research Channel" },
        },
      }],
    });

    expect(results).toEqual([expect.objectContaining({
      title: "Research evidence explained",
      url: "https://www.youtube.com/watch?v=abc123",
      publisher: "Public Research Channel",
      excerpt: "A concise evidence excerpt.",
      retrievedAt: expect.any(Date),
    })]);
  });

  it("keeps attributable web results and removes duplicate or invalid URLs", () => {
    const results = normalizeSearchPayload({
      organic_results: [
        { title: "Primary source", link: "https://example.com/report", snippet: "A source excerpt." },
        { title: "Duplicate", link: "https://example.com/report", snippet: "Duplicate." },
        { title: "Unsafe", link: "javascript:alert(1)", snippet: "Ignored." },
      ],
    });

    expect(results).toEqual([expect.objectContaining({
      title: "Primary source",
      url: "https://example.com/report",
      publisher: "example.com",
      excerpt: "A source excerpt.",
      retrievedAt: expect.any(Date),
    })]);
  });
});

describe("applyPlanAdaptation", () => {
  const plan = [
    { id: "step-1", ordinal: 0, title: "Current evidence", description: "Find evidence.", searchQuery: "initial query" },
    { id: "step-2", ordinal: 1, title: "Original comparison", description: "Compare options.", searchQuery: "original comparison" },
  ];

  it("revises a pending step without changing the completed step", () => {
    const result = applyPlanAdaptation(plan, 0, {
      action: "revise",
      targetOrdinal: 1,
      title: "Evidence gap comparison",
      description: "Compare the uncovered implementation risks.",
      searchQuery: "implementation risks evidence",
    });

    expect(result.kind).toBe("revise");
    expect(result.plan[0]).toEqual(plan[0]);
    expect(result.plan[1]).toMatchObject({ title: "Evidence gap comparison", searchQuery: "implementation risks evidence" });
  });

  it("appends a distinct step only when capacity remains", () => {
    const result = applyPlanAdaptation(plan, 0, {
      action: "append",
      targetOrdinal: -1,
      title: "Regulatory context",
      description: "Research the missing regulatory context.",
      searchQuery: "regulatory context evidence",
    }, () => "step-3");

    expect(result.kind).toBe("append");
    expect(result.plan).toHaveLength(3);
    expect(result.plan[2]).toMatchObject({ id: "step-3", ordinal: 2 });
  });
});

describe("clarification policy", () => {
  it("does not block routine restaurant research for ordinary preference details", () => {
    expect(shouldRequestClarification(
      "Find me the best Italian restaurants in Jaipur",
      { requiresClarification: true, clarifyingQuestion: "Do you prefer vegetarian-only options or fine dining?" }
    )).toBe(false);
  });

  it("allows a clarification only when a materially constrained request is underspecified", () => {
    expect(shouldRequestClarification(
      "Legal requirements?",
      { requiresClarification: true, clarifyingQuestion: "Which jurisdiction applies?" }
    )).toBe(true);
  });
});

describe("runResearchSession adaptive-plan contract", () => {
  const longIntent = "Identify the best Italian restaurants in Jaipur, India, with current trustworthy picks suitable for dine-in; compare price level, vibe, vegetarian options, alcohol availability, and reservation details.";
  const source = {
    title: "Public source",
    url: "https://www.youtube.com/watch?v=source-1",
    publisher: "Public channel",
    excerpt: "A source excerpt.",
    retrievedAt: new Date("2026-08-21T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.getResearchSessionForUser.mockResolvedValue({ id: "session-1", query: "How should a team assess this change?", status: "draft" });
    mocks.llm.listLLMModels.mockResolvedValue({ data: [{ id: "gpt-5" }] });
    mocks.search.searchPublicWeb.mockResolvedValue([source]);
    mocks.llm.invokeLLM
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({
        title: "Assess the change",
        intent: longIntent,
        researchGoal: "Assess the decision using public evidence.",
        requiresClarification: false,
        clarifyingQuestion: "",
        outputFormat: "comparison",
        plan: [
          { title: "Current evidence", description: "Find the current evidence.", searchQuery: "current evidence" },
          { title: "Original comparison", description: "Compare initial options.", searchQuery: "original comparison" },
        ],
      }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({
        action: "revise",
        targetOrdinal: 1,
        title: "Evidence-gap comparison",
        description: "Compare the implementation risks revealed by source discovery.",
        searchQuery: "implementation risks public evidence",
      }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ findings: [{ title: "First finding", claim: "The first evidence claim.", evidence: "The source excerpt.", sourceUrls: [source.url] }] }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ findings: [{ title: "Second finding", claim: "The revised evidence claim.", evidence: "The source excerpt.", sourceUrls: [source.url] }] }) } }] });
  });

  it("persists and emits a revised pending plan after source discovery", async () => {
    const events: Array<Record<string, unknown>> = [];

    await runResearchSession({ sessionId: "session-1", userId: 1, emit: event => events.push(event) });

    const planEvents = events.filter(event => event.type === "plan");
    const activityEvents = events.filter(event => event.type === "activity");
    expect(planEvents).toHaveLength(2);
    expect(activityEvents.map(event => event.phase)).toEqual(expect.arrayContaining(["planning", "discovery", "analysis", "synthesis"]));
    expect((planEvents[1].plan as Array<{ title: string }>)[1].title).toBe("Evidence-gap comparison");
    expect(mocks.db.updateResearchStepDetails).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ title: "Evidence-gap comparison", searchQuery: "implementation risks public evidence" })
    );
    expect(mocks.db.updateResearchSessionForUser).toHaveBeenCalledWith(
      "session-1",
      1,
      expect.objectContaining({ planJson: expect.stringContaining("Evidence-gap comparison") })
    );
    expect(mocks.db.updateResearchSessionForUser).toHaveBeenCalledWith(
      "session-1",
      1,
      expect.objectContaining({ intent: longIntent })
    );
  });

  it("skips an empty-source step and completes the remaining session instead of failing", async () => {
    vi.clearAllMocks();
    mocks.db.getResearchSessionForUser.mockResolvedValue({ id: "session-2", query: "Explain a narrow topic", status: "draft" });
    mocks.llm.listLLMModels.mockResolvedValue({ data: [{ id: "gpt-5" }] });
    mocks.search.searchPublicWeb.mockResolvedValue([]);
    mocks.llm.invokeLLM.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({
      title: "Narrow topic",
      intent: "Explain a narrow topic with evidence.",
      researchGoal: "Explain the requested topic.",
      requiresClarification: false,
      clarifyingQuestion: "",
      outputFormat: "summary",
      plan: [{ title: "Unavailable evidence", description: "Check the narrow evidence set.", searchQuery: "unavailable source" }],
    }) } }] });
    const events: Array<Record<string, unknown>> = [];

    await runResearchSession({ sessionId: "session-2", userId: 1, emit: event => events.push(event) });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "step", status: "skipped" }),
      expect.objectContaining({ type: "activity", message: expect.stringContaining("Skipping this narrow step") }),
      expect.objectContaining({ type: "complete" }),
    ]));
    expect(mocks.db.updateResearchSessionForUser).toHaveBeenCalledWith("session-2", 1, expect.objectContaining({ status: "complete" }));
  });
});
