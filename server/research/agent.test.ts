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
    replaceResearchRecommendationOptions: vi.fn(),
    replaceResearchSteps: vi.fn(),
    updateResearchSessionForUser: vi.fn(),
    updateResearchSourceQuality: vi.fn(),
    updateResearchStep: vi.fn(),
    updateResearchStepDetails: vi.fn(),
  },
  llm: { invokeLLM: vi.fn(), invokeGrounded: vi.fn(), listLLMModels: vi.fn() },
  search: { searchPublicWeb: vi.fn() },
  places: { searchLocalRecommendationPlaces: vi.fn() },
}));

vi.mock("../db", () => mocks.db);
vi.mock("../_core/llm", () => mocks.llm);
vi.mock("./llmProvider", () => ({
  invokeResearchLLM: mocks.llm.invokeLLM,
  invokeGroundedRecommendationResearch: mocks.llm.invokeGrounded,
  renderGroundedRecommendationMarkdown: (text: string, sources: Array<{ title: string; url: string }>) => `${text}\n${sources.map(source => source.url).join("\n")}`,
  providerAttemptsFromError: (error: unknown) => error && typeof error === "object" && "attempts" in error ? (error as { attempts: unknown[] }).attempts : [],
  chooseResearchModel: async () => {
    const models = await mocks.llm.listLLMModels();
    return models.data.find((model: { id: string }) => model.id === "gpt-5")?.id ?? models.data[0]?.id;
  },
}));
vi.mock("./search", async importOriginal => ({ ...(await importOriginal<typeof import("./search")>()), ...mocks.search }));
vi.mock("./places", () => mocks.places);

import { applyPlanAdaptation, isAiServiceLimitError, isRecommendationResearch, makePlanSteps, runResearchSession, shouldRequestClarification, synthesizeLocalPlaceRecommendation, synthesizeResearchBrief, synthesizeResearchOutput, toPublicResearchError } from "./agent";
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

describe("AI service limit recovery", () => {
  it("recognizes limit responses and replaces raw provider details", () => {
    const providerError = new Error('LLM invoke failed: 412 Precondition Failed — {"code":9,"message":"account usage exhausted"}');

    expect(isAiServiceLimitError(providerError)).toBe(true);
    expect(toPublicResearchError(providerError)).toBe("The AI service is temporarily unavailable. Your research workspace has been preserved and can be resumed.");
  });

  it("routes dual-provider outages into the existing preserved-work recovery message", () => {
    const providerOutage = new Error("AI_PROVIDERS_UNAVAILABLE");

    expect(isAiServiceLimitError(providerOutage)).toBe(true);
    expect(toPublicResearchError(providerOutage)).toBe("The AI service is temporarily unavailable. Your research workspace has been preserved and can be resumed.");
  });
});

describe("final research synthesis", () => {
  it("returns a substantive Gemini-written answer with direct source links", async () => {
    mocks.llm.listLLMModels.mockResolvedValue({ data: [{ id: "gpt-5" }] });
    mocks.llm.invokeLLM.mockReset().mockResolvedValue({ choices: [{ message: { content: "## Answer\n\nA four-day workweek can improve wellbeing in suitable settings, but implementation constraints should be tested first. [Evidence](https://example.org/evidence)" } }] });

    const output = await synthesizeResearchOutput({
      intent: { title: "Workweek evidence", intent: "Assess policy", researchGoal: "Assess the four-day workweek.", requiresClarification: false, clarifyingQuestion: "", outputFormat: "comparison", plan: [] },
      findings: [{ title: "Pilot evidence", claim: "Pilot evidence supports wellbeing gains.", evidence: "Reported by the source.", citationSourceIdsJson: JSON.stringify(["source-1"]) }],
      sources: [{ id: "source-1", title: "Evidence", url: "https://example.org/evidence", publisher: "Research institute", excerpt: "Pilot programs reported wellbeing gains." }],
    });

    expect(output).toContain("## Answer");
    expect(output).toContain("https://example.org/evidence");
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

describe("research depth plan sizing", () => {
  const intent = {
    title: "Depth test",
    intent: "Test plan sizing.",
    researchGoal: "Test each depth.",
    requiresClarification: false,
    clarifyingQuestion: "",
    outputFormat: "summary" as const,
    plan: Array.from({ length: 5 }, (_, index) => ({ title: `Step ${index + 1}`, description: "Research this lens.", searchQuery: `query ${index + 1}` })),
  };

  it("uses two focused steps for a quick summary and five for a deep dive", () => {
    expect(makePlanSteps(intent, "quick")).toHaveLength(2);
    expect(makePlanSteps(intent, "standard")).toHaveLength(3);
    expect(makePlanSteps(intent, "deep")).toHaveLength(5);
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
    mocks.db.listResearchFindings.mockResolvedValue([]);
    mocks.db.listResearchSources.mockResolvedValue([]);
    mocks.db.listResearchSteps.mockResolvedValue([]);
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
    mocks.llm.invokeLLM.mockReset().mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({
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

  it("persists source-backed fallback findings when model claims cannot be matched to retained sources", async () => {
    vi.clearAllMocks();
    mocks.db.getResearchSessionForUser.mockResolvedValue({ id: "session-source-fallback", query: "Summarize the evidence", status: "draft" });
    mocks.db.listResearchSteps.mockResolvedValue([]);
    mocks.llm.listLLMModels.mockResolvedValue({ data: [{ id: "gpt-5" }] });
    mocks.search.searchPublicWeb.mockResolvedValue([source]);
    mocks.llm.invokeLLM.mockReset()
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({
        title: "Source-backed brief",
        intent: "Summarize retained evidence.",
        researchGoal: "Produce a source-backed summary.",
        requiresClarification: false,
        clarifyingQuestion: "",
        outputFormat: "summary",
        plan: [{ title: "Evidence check", description: "Collect attributable evidence.", searchQuery: "evidence" }],
      }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ findings: [{ title: "Unmatched claim", claim: "This URL is not retained.", evidence: "Unsupported.", sourceUrls: ["https://other.example/unmatched"] }] }) } }] });

    await runResearchSession({ sessionId: "session-source-fallback", userId: 1, emit: vi.fn() });

    expect(mocks.db.addResearchFindings).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ title: source.title, citationSourceIdsJson: expect.any(String) }),
    ]));
  });

  it("uses grounded evidence to produce a validated multi-option recommendation shortlist", async () => {
    mocks.llm.invokeGrounded.mockResolvedValue({ output: JSON.stringify({ criteria: ["aesthetic atmosphere", "visit occasion"], options: [
      { rank: 1, name: "Cafe One", summary: "Garden setting for a relaxed daytime visit.", strengths: ["Garden ambience"], caveats: ["Confirm current opening hours."], evidence: [{ claim: "The guide describes a garden setting.", sourceUrls: ["https://example.org/one"] }] },
      { rank: 2, name: "Cafe Two", summary: "Heritage character for a more atmospheric stop.", strengths: ["Heritage interiors"], caveats: ["Verify current menu details."], evidence: [{ claim: "The review highlights heritage interiors.", sourceUrls: ["https://example.org/two"] }] },
      { rank: 3, name: "Cafe Three", summary: "Coffee-focused option for a shorter visit.", strengths: ["Coffee focus"], caveats: ["Check seating availability."], evidence: [{ claim: "The source presents it as coffee-focused.", sourceUrls: ["https://example.org/three"] }] },
    ], selectionAdvice: "Choose Cafe One for a relaxed daytime setting, Cafe Two for heritage character, or Cafe Three for a coffee-first visit." }), sources: [
      { title: "Cafe One review", url: "https://example.org/one", publisher: "example.org", excerpt: "Grounded citation." },
      { title: "Cafe Two review", url: "https://example.org/two", publisher: "example.org", excerpt: "Grounded citation." },
      { title: "Cafe Three review", url: "https://example.org/three", publisher: "example.org", excerpt: "Grounded citation." },
    ] });
    const intent = { title: "Cute cafes", intent: "Recommend aesthetic cafes", researchGoal: "Find a shortlist of cute and aesthetic cafes in Jaipur.", requiresClarification: false, clarifyingQuestion: "", outputFormat: "comparison" as const, plan: [] };

    const brief = await synthesizeResearchBrief({ intent, findings: [], sources: [] });

    expect(isRecommendationResearch(intent)).toBe(true);
    expect(brief.output).toContain("Cafe Three");
    expect(brief.recommendation?.options).toHaveLength(3);
    expect(brief.groundedSources).toHaveLength(3);
    expect(mocks.llm.invokeGrounded).toHaveBeenCalledWith(expect.objectContaining({ request: expect.stringContaining("Return ONLY valid JSON") }));
  });

  it("uses Google Maps Places evidence when Google Search grounding is unavailable for a local shortlist", async () => {
    vi.clearAllMocks();
    mocks.llm.invokeGrounded.mockReset();
    mocks.llm.listLLMModels.mockReset().mockResolvedValue({ data: [{ id: "gpt-5" }] });
    const placeSources = ["one", "two", "three"].map(name => ({
      title: `Cafe ${name}`,
      url: `https://www.google.com/maps/search/?api=1&query_place_id=${name}`,
      publisher: "Google Maps",
      excerpt: `Jaipur. Listed Google Maps rating: 4.5 from 100 Google Maps ratings.`,
    }));
    mocks.places.searchLocalRecommendationPlaces.mockReset().mockResolvedValue(placeSources);
    mocks.llm.invokeLLM.mockReset().mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ criteria: ["location", "Google Maps rating"], options: placeSources.map((source, index) => ({
      rank: index + 1,
      name: source.title,
      summary: `A named Jaipur venue retained from Google Maps Places evidence.`,
      strengths: ["Listed Google Maps rating: 4.5 from 100 Google Maps ratings."],
      caveats: ["Confirm current hours and venue experience directly before visiting."],
      evidence: [{ claim: `Google Maps retains this named Jaipur venue with a listed rating.`, sourceUrls: [source.url] }],
    })), selectionAdvice: "Choose by preferred location and verify current venue details before visiting." }) } }] });
    const intent = { title: "Cute cafes", intent: "Recommend aesthetic cafes", researchGoal: "Find a shortlist of cute and aesthetic cafes in Jaipur.", requiresClarification: false, clarifyingQuestion: "", outputFormat: "comparison" as const, plan: [] };

    const directRecommendation = await synthesizeLocalPlaceRecommendation(intent, placeSources);
    const brief = await synthesizeResearchBrief({ intent, findings: [], sources: [] });

    expect(directRecommendation?.options).toHaveLength(3);
    expect(brief.output).toContain("Google Maps Places evidence");
    expect(brief.recommendation?.options).toHaveLength(3);
    expect(brief.groundedSources).toHaveLength(3);
    expect(mocks.places.searchLocalRecommendationPlaces).toHaveBeenCalledWith(intent.researchGoal);
    expect(mocks.llm.invokeGrounded).not.toHaveBeenCalled();
  });

  it("persists each validated recommendation option with resolved source citations", async () => {
    vi.clearAllMocks();
    mocks.db.getResearchSessionForUser.mockResolvedValue({ id: "session-recommendation", query: "Find cute cafes in Jaipur", status: "draft", researchDepth: "standard" });
    mocks.db.listResearchFindings.mockResolvedValue([]);
    mocks.db.listResearchSources.mockResolvedValue([]);
    mocks.db.listResearchSteps.mockResolvedValue([]);
    mocks.llm.listLLMModels.mockResolvedValue({ data: [{ id: "gpt-5" }] });
    mocks.search.searchPublicWeb.mockResolvedValue([source]);
    mocks.llm.invokeLLM.mockReset()
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ title: "Cute cafes", intent: "Recommend cafes", researchGoal: "Find cute cafes in Jaipur.", requiresClarification: false, clarifyingQuestion: "", outputFormat: "comparison", plan: [{ title: "Venue evidence", description: "Find attributable venue evidence.", searchQuery: "cute cafes Jaipur" }] }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ findings: [{ title: "Local source", claim: "A local source was retained.", evidence: "A source excerpt.", sourceUrls: [source.url] }] }) } }] });
    mocks.llm.invokeGrounded.mockResolvedValue({ output: JSON.stringify({ criteria: ["aesthetic atmosphere", "visit occasion"], options: [
      { rank: 1, name: "Cafe One", summary: "A garden-style daytime choice.", strengths: ["Garden ambience"], caveats: ["Confirm current hours."], evidence: [{ claim: "A guide identifies a garden setting.", sourceUrls: ["https://example.org/one"] }] },
      { rank: 2, name: "Cafe Two", summary: "A heritage-style option.", strengths: ["Heritage interiors"], caveats: ["Confirm menu details."], evidence: [{ claim: "A review identifies heritage interiors.", sourceUrls: ["https://example.org/two"] }] },
      { rank: 3, name: "Cafe Three", summary: "A coffee-first option.", strengths: ["Coffee focus"], caveats: ["Confirm seating availability."], evidence: [{ claim: "A review identifies a coffee focus.", sourceUrls: ["https://example.org/three"] }] },
    ], selectionAdvice: "Choose by desired ambience and visit purpose." }), sources: [
      { title: "Cafe One review", url: "https://example.org/one", publisher: "example.org", excerpt: "Grounded citation." },
      { title: "Cafe Two review", url: "https://example.org/two", publisher: "example.org", excerpt: "Grounded citation." },
      { title: "Cafe Three review", url: "https://example.org/three", publisher: "example.org", excerpt: "Grounded citation." },
    ] });

    await runResearchSession({ sessionId: "session-recommendation", userId: 1, emit: vi.fn() });

    expect(mocks.db.replaceResearchRecommendationOptions).toHaveBeenCalledWith("session-recommendation", expect.arrayContaining([
      expect.objectContaining({ rank: 1, name: "Cafe One", criteriaJson: expect.stringContaining("aesthetic atmosphere"), citationSourceIdsJson: expect.stringMatching(/^\[.+\]$/) }),
      expect.objectContaining({ rank: 3, name: "Cafe Three" }),
    ]));
  });

  it("flags a one-source recommendation as insufficient evidence instead of overclaiming", async () => {
    mocks.llm.invokeGrounded.mockRejectedValueOnce(new Error("grounding unavailable"));
    const intent = { title: "Cute cafes", intent: "Recommend aesthetic cafes", researchGoal: "Find a shortlist of cute and aesthetic cafes in Jaipur.", requiresClarification: false, clarifyingQuestion: "", outputFormat: "comparison" as const, plan: [] };

    const brief = await synthesizeResearchBrief({ intent, findings: [], sources: [{ id: "source-1", title: "Single cafe video", url: "https://example.org/video", publisher: "Example", excerpt: "One option only." }] });

    expect(brief.output).toContain("Recommendation evidence gap");
    expect(brief.output).toContain("not enough to responsibly rank");
  });

  it("does not promote multiple thin snippets into an ungrounded ranked shortlist", async () => {
    mocks.llm.invokeGrounded.mockRejectedValueOnce(new Error("grounding unavailable"));
    const intent = { title: "Cute cafes", intent: "Recommend aesthetic cafes", researchGoal: "Find a shortlist of cute and aesthetic cafes in Jaipur.", requiresClarification: false, clarifyingQuestion: "", outputFormat: "comparison" as const, plan: [] };

    const brief = await synthesizeResearchBrief({ intent, findings: [], sources: [
      { id: "source-1", title: "Cafe video one", url: "https://example.org/one", publisher: "Example", excerpt: "A generic top-cafes video." },
      { id: "source-2", title: "Cafe video two", url: "https://example.org/two", publisher: "Example", excerpt: "Another generic list." },
      { id: "source-3", title: "Cafe video three", url: "https://example.org/three", publisher: "Example", excerpt: "A third general mention." },
    ] });

    expect(brief.output).toContain("Grounded public-web search is temporarily unavailable");
    expect(brief.output).toContain("Recommendation evidence gap");
  });

  it("persists the actual last emitted activity when an AI limit interrupts planning", async () => {
    vi.clearAllMocks();
    mocks.db.getResearchSessionForUser.mockResolvedValue({ id: "session-limit", query: "Research a topic", status: "draft" });
    mocks.db.listResearchSteps.mockResolvedValue([]);
    mocks.llm.listLLMModels.mockReset().mockResolvedValue({ data: [{ id: "gpt-5" }] });
    mocks.llm.invokeLLM.mockReset().mockRejectedValueOnce(new Error("LLM invoke failed: 412 usage exhausted"));

    await runResearchSession({ sessionId: "session-limit", userId: 1, emit: vi.fn() });

    expect(mocks.db.updateResearchSessionForUser).toHaveBeenLastCalledWith(
      "session-limit",
      1,
      expect.objectContaining({
        status: "failed",
        errorMessage: "AI_SERVICE_LIMIT",
        lifecyclePhase: "planning",
        lifecycleProgress: 8,
        lifecycleMessage: "Interpreting the research objective and choosing the right evidence format.",
      })
    );
  });

  it("persists safe Gemini attempts while preserving the generic recovery state", async () => {
    vi.clearAllMocks();
    mocks.db.getResearchSessionForUser.mockResolvedValue({ id: "session-dual-outage", query: "Research a topic", status: "draft" });
    mocks.db.listResearchSteps.mockResolvedValue([]);
    mocks.llm.listLLMModels.mockReset().mockResolvedValue({ data: [{ id: "gpt-5" }] });
    const outage = Object.assign(new Error("AI_PROVIDERS_UNAVAILABLE"), {
      attempts: [
        { provider: "gemini", model: "gemini-3.5-flash-lite", outcome: "failed", errorClass: "http_429", httpStatus: 429 },
        { provider: "gemini", model: "gemini-3.1-flash-lite", outcome: "failed", errorClass: "http_429", httpStatus: 429 },
      ],
    });
    mocks.llm.invokeLLM.mockReset().mockRejectedValueOnce(outage);

    await runResearchSession({ sessionId: "session-dual-outage", userId: 1, emit: vi.fn() });

    expect(mocks.db.updateResearchSessionForUser).toHaveBeenLastCalledWith(
      "session-dual-outage",
      1,
      expect.objectContaining({
        status: "failed",
        errorMessage: "AI_SERVICE_LIMIT",
        lifecyclePhase: "planning",
        lifecycleProgress: 8,
        lifecycleMessage: "Interpreting the research objective and choosing the right evidence format.",
        providerDiagnosticsJson: JSON.stringify(outage.attempts),
      })
    );
  });
});
