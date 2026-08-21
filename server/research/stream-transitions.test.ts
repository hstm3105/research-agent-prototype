import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    addResearchCitations: vi.fn(),
    addResearchFindings: vi.fn(),
    addResearchSources: vi.fn(),
    addResearchStep: vi.fn(),
    getResearchSessionForUser: vi.fn(),
    listResearchFindings: vi.fn(),
    listResearchSources: vi.fn(),
    listResearchSteps: vi.fn(),
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
vi.mock("./llmProvider", () => ({
  invokeResearchLLM: mocks.llm.invokeLLM,
  chooseResearchModel: async () => "gemini-3.5-flash-lite",
  providerAttemptsFromError: () => [],
}));
vi.mock("./search", () => mocks.search);

import { runResearchSession } from "./agent";

describe("research stream transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.llm.listLLMModels.mockResolvedValue({ data: [{ id: "gpt-5" }] });
    mocks.db.listResearchFindings.mockResolvedValue([]);
    mocks.db.listResearchSources.mockResolvedValue([]);
    mocks.db.listResearchSteps.mockResolvedValue([]);
  });

  it("emits a clarification event immediately after persisting a material clarification state", async () => {
    mocks.db.getResearchSessionForUser.mockResolvedValue({ id: "legal-1", query: "Legal requirements?", status: "draft" });
    mocks.llm.invokeLLM.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({
      title: "Legal requirements",
      intent: "Assess the legal requirements.",
      researchGoal: "Identify applicable legal requirements.",
      requiresClarification: true,
      clarifyingQuestion: "Which jurisdiction applies?",
      outputFormat: "report",
      plan: [{ title: "Legal scan", description: "Review legal sources.", searchQuery: "legal requirements" }],
    }) } }] });
    const events: Array<Record<string, unknown>> = [];

    await runResearchSession({ sessionId: "legal-1", userId: 1, emit: event => events.push(event) });

    expect(mocks.db.updateResearchSessionForUser).toHaveBeenCalledWith("legal-1", 1, expect.objectContaining({ status: "awaiting_clarification", clarifyingQuestion: "Which jurisdiction applies?" }));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "intent" }),
      expect.objectContaining({ type: "clarification", question: "Which jurisdiction applies?" }),
    ]));
  });

  it("resumes a saved failed plan without reparsing the query before generating the final answer", async () => {
    const storedPlan = [{ id: "resume-step", ordinal: 0, title: "Saved evidence step", description: "Continue the saved plan.", searchQuery: "saved evidence" }];
    mocks.db.getResearchSessionForUser.mockResolvedValue({
      id: "resume-1",
      query: "Continue the saved work",
      title: "Saved research",
      researchGoal: "Complete the saved research objective.",
      intent: "Saved interpretation.",
      outputFormat: "summary",
      planJson: JSON.stringify(storedPlan),
      status: "failed",
    });
    mocks.search.searchPublicWeb.mockResolvedValue([]);
    const events: Array<Record<string, unknown>> = [];

    await runResearchSession({ sessionId: "resume-1", userId: 1, emit: event => events.push(event) });

    expect(mocks.llm.invokeLLM).toHaveBeenCalledTimes(1);
    expect(mocks.llm.invokeLLM).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining("Complete the saved research objective") })]),
    }));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "activity", message: expect.stringContaining("Resuming") }),
      expect.objectContaining({ type: "plan", plan: storedPlan }),
      expect.objectContaining({ type: "step", status: "skipped" }),
      expect.objectContaining({ type: "complete" }),
    ]));
  });
});
