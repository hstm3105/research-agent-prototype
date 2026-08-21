import { nanoid } from "nanoid";
import {
  addResearchCitations,
  addResearchFindings,
  replaceResearchRecommendationOptions,
  addResearchStep,
  addResearchSources,
  getResearchSessionForUser,
  listResearchFindings,
  listResearchSources,
  listResearchSteps,
  replaceResearchSteps,
  updateResearchSessionForUser,
  updateResearchSourceQuality,
  updateResearchStep,
  updateResearchStepDetails,
} from "../db";
import { searchPublicWeb } from "./search";
import { searchLocalRecommendationPlaces } from "./places";
import { chooseResearchModel, invokeGroundedRecommendationResearch, invokeResearchLLM, providerAttemptsFromError, renderGroundedRecommendationMarkdown, type GroundedRecommendationSource } from "./llmProvider";
import { scoreResearchSource } from "./sourceQuality";
import type { AgentFinding, RecommendationBrief, RecommendationEvidence, RecommendationOption, ResearchIntent, ResearchPlanStep, ResearchProgressEvent } from "./types";

const outputFormatValues = ["report", "summary", "comparison", "timeline", "qa"] as const;

function parseJson<T>(value: unknown): T {
  const raw = Array.isArray(value) ? value.map(part => part.type === "text" ? part.text : "").join("") : value;
  if (typeof raw !== "string") throw new Error("The LLM returned an empty structured response");
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleaned) as T;
}

const intentSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    intent: { type: "string" },
    researchGoal: { type: "string" },
    requiresClarification: { type: "boolean" },
    clarifyingQuestion: { type: "string" },
    outputFormat: { type: "string", enum: [...outputFormatValues] },
    plan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          searchQuery: { type: "string" },
        },
        required: ["title", "description", "searchQuery"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "intent", "researchGoal", "requiresClarification", "clarifyingQuestion", "outputFormat", "plan"],
  additionalProperties: false,
};

const findingsSchema = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          claim: { type: "string" },
          evidence: { type: "string" },
          sourceUrls: { type: "array", items: { type: "string" } },
        },
        required: ["title", "claim", "evidence", "sourceUrls"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

const adaptationSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["none", "append", "revise"] },
    targetOrdinal: { type: "integer" },
    title: { type: "string" },
    description: { type: "string" },
    searchQuery: { type: "string" },
  },
  required: ["action", "targetOrdinal", "title", "description", "searchQuery"],
  additionalProperties: false,
};

export async function interpretResearchQuery(query: string, researchDepth: "quick" | "standard" | "deep" = "standard"): Promise<ResearchIntent> {
  const model = await chooseResearchModel();
  const response = await invokeResearchLLM({
    model,
    messages: [
      {
        role: "system",
        content: `You are a senior research lead. Default to action: make reasonable assumptions and proceed rather than asking for preferences. Ask one concise clarifying question only when the request is genuinely under-specified and the missing answer would materially change the research outcome, scope, jurisdiction, safety constraints, or deliverable. Never block routine recommendations, including restaurants, travel, products, or local services, for preferences such as cuisine variants, dietary preference, budget, neighborhood, atmosphere, or fine-versus-casual; research broadly and surface those trade-offs instead. When the user gives no preference, do not invent a restrictive default such as vegetarian-only, luxury-only, budget-only, or a single neighborhood; produce a balanced broad shortlist and label relevant options. Otherwise set requiresClarification to false and clarifyingQuestion to an empty string. Select the output format that best serves the task. The user selected ${researchDepth} research depth: ${researchDepth === "quick" ? "draft exactly 2 focused, high-yield research steps" : researchDepth === "deep" ? "draft exactly 5 thorough, non-overlapping research steps" : "draft exactly 3 balanced, non-overlapping research steps"}. Do not claim facts or cite sources in this planning stage.`,
      },
      { role: "user", content: query },
    ],
    response_format: { type: "json_schema", json_schema: { name: "research_intent", strict: true, schema: intentSchema } },
  });
  const intent = parseJson<ResearchIntent>(response.choices[0]?.message.content);
  if (!outputFormatValues.includes(intent.outputFormat) || !intent.plan.length) throw new Error("The proposed research plan was incomplete");
  const requiresClarification = shouldRequestClarification(query, intent);
  return { ...intent, requiresClarification, clarifyingQuestion: requiresClarification ? intent.clarifyingQuestion.trim() : "" };
}

export function shouldRequestClarification(query: string, intent: Pick<ResearchIntent, "requiresClarification" | "clarifyingQuestion">) {
  if (!intent.requiresClarification || !intent.clarifyingQuestion.trim()) return false;
  const normalizedQuery = query.toLowerCase();
  const routineRecommendation = /\b(restaurant|cafe|food|hotel|travel|trip|itinerary|product|service|gift|recipe)\b/.test(normalizedQuery);
  if (routineRecommendation) return false;
  const materiallyConstrained = /\b(legal|regulation|jurisdiction|medical|clinical|safety|security|compliance|contract|tax|investment|procurement)\b/.test(`${normalizedQuery} ${intent.clarifyingQuestion.toLowerCase()}`);
  return materiallyConstrained || normalizedQuery.trim().split(/\s+/).length < 4;
}

export function isRecommendationResearch(intent: Pick<ResearchIntent, "title" | "intent" | "researchGoal">) {
  return /\b(recommend|recommendation|shortlist|best\s+(?:cafes?|restaurants?|hotels?|places?|shops?|products?)|list\s+of|cafes?|restaurants?|hotels?|itinerary|where\s+to\s+(?:eat|stay|go)|aesthetic|cute)\b/i.test(`${intent.title} ${intent.intent} ${intent.researchGoal}`);
}

function isLocalVenueRecommendation(intent: Pick<ResearchIntent, "title" | "intent" | "researchGoal">) {
  return /\b(cafes?|restaurants?|bars?|bakeries|hotels?|venues?|shops?|stores?|salons?|spas?|gyms?|clinics?|places?\s+to\s+(?:eat|stay|visit)|where\s+to\s+(?:eat|stay|go))\b/i.test(`${intent.title} ${intent.intent} ${intent.researchGoal}`);
}

export function makePlanSteps(intent: ResearchIntent, researchDepth: "quick" | "standard" | "deep"): ResearchPlanStep[] {
  const planLength = researchDepth === "quick" ? 2 : researchDepth === "deep" ? 5 : 3;
  return intent.plan.slice(0, planLength).map((step, ordinal) => ({ ...step, id: nanoid(), ordinal }));
}

function readStoredPlan(value: string | null): ResearchPlanStep[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return parsed.every(step => step && typeof step.id === "string" && typeof step.title === "string" && typeof step.description === "string" && typeof step.searchQuery === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function sourceFallbackFindings(sources: Array<{ title: string; url: string; publisher: string | null; excerpt: string | null }>): AgentFinding[] {
  return sources.slice(0, 3).map(source => ({
    title: source.title,
    claim: source.excerpt || `${source.publisher || "The source"} provides a directly linked item relevant to this research step.`,
    evidence: `Source-backed excerpt from ${source.publisher || "the cited publisher"}.`,
    sourceUrls: [source.url],
  }));
}

type PlanAdaptation = {
  action: "none" | "append" | "revise";
  targetOrdinal: number;
  title: string;
  description: string;
  searchQuery: string;
};

export function applyPlanAdaptation(
  plan: ResearchPlanStep[],
  completedOrdinal: number,
  adaptation: PlanAdaptation,
  idFactory: () => string = nanoid
) {
  const hasDetails = adaptation.title.trim() && adaptation.description.trim() && adaptation.searchQuery.trim();
  if (adaptation.action === "none" || !hasDetails) return { kind: "none" as const, plan };
  if (adaptation.action === "append" && plan.length < 5) {
    const step: ResearchPlanStep = { id: idFactory(), ordinal: plan.length, title: adaptation.title, description: adaptation.description, searchQuery: adaptation.searchQuery };
    return { kind: "append" as const, plan: [...plan, step], step };
  }
  if (adaptation.action === "revise") {
    const targetIndex = plan.findIndex(step => step.ordinal === adaptation.targetOrdinal && step.ordinal > completedOrdinal);
    if (targetIndex >= 0) {
      const prior = plan[targetIndex];
      const step: ResearchPlanStep = { ...prior, title: adaptation.title, description: adaptation.description, searchQuery: adaptation.searchQuery };
      const revisedPlan = [...plan];
      revisedPlan[targetIndex] = step;
      return { kind: "revise" as const, plan: revisedPlan, step };
    }
  }
  return { kind: "none" as const, plan };
}

async function proposeAdaptiveChange(input: {
  researchGoal: string;
  completedStep: ResearchPlanStep;
  existingPlan: ResearchPlanStep[];
  sources: Array<{ title: string; url: string; publisher: string | null; excerpt: string | null }>;
}) {
  const model = await chooseResearchModel();
  const response = await invokeResearchLLM({
    model,
    messages: [
      { role: "system", content: "You are reviewing a live research plan after source retrieval. Either (1) revise one pending step if its search query no longer best fills the evidence gap, (2) append one distinct coverage step if a material gap is not addressed, or (3) choose none. Never change a completed step. For action=revise, targetOrdinal must identify a pending existing step; for append, use -1; for none, use -1 and empty strings." },
      { role: "user", content: JSON.stringify(input) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "research_plan_adaptation", strict: true, schema: adaptationSchema } },
  });
  return parseJson<PlanAdaptation>(response.choices[0]?.message.content);
}

function buildEvidenceDigest(intent: ResearchIntent, sources: Array<{ title: string; url: string; publisher: string | null; excerpt: string | null }>): string {
  const sourceLinks = sources.slice(0, 6).map((source, index) => `- **${source.title}** — ${source.excerpt || "Directly linked public evidence retained for this brief."} [Source ${index + 1}](${source.url})`).join("\n");
  return `## Answer\n\nThe research run retained directly attributable public evidence relevant to the question. A model-written synthesis was unavailable, so the evidence below is presented without extrapolating beyond the source excerpts.\n\n## Evidence collected\n\n${sourceLinks || "No attributable source excerpts were retained."}\n\n## Practical interpretation\n\nUse the linked source material to verify the underlying claims and decide whether the available evidence is sufficient for the requested conclusion.`;
}

function recommendationText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maxLength) : null;
}

function parseGroundedRecommendationBrief(value: string, groundedSources: GroundedRecommendationSource[]): RecommendationBrief | null {
  try {
    const parsed = parseJson<Partial<RecommendationBrief>>(value);
    const validUrls = new Set(groundedSources.map(source => source.url));
    const criteria = Array.isArray(parsed.criteria)
      ? parsed.criteria.map(item => recommendationText(item, 160)).filter((item): item is string => Boolean(item)).slice(0, 6)
      : [];
    const rawOptions = Array.isArray(parsed.options) ? parsed.options : [];
    const options = rawOptions.map((raw, index): RecommendationOption | null => {
      if (!raw || typeof raw !== "object") return null;
      const candidate = raw as Partial<RecommendationOption>;
      const rank = Number.isInteger(candidate.rank) && Number(candidate.rank) > 0 ? Number(candidate.rank) : index + 1;
      const name = recommendationText(candidate.name, 160);
      const summary = recommendationText(candidate.summary, 500);
      const strengths = Array.isArray(candidate.strengths) ? candidate.strengths.map(item => recommendationText(item, 280)).filter((item): item is string => Boolean(item)).slice(0, 4) : [];
      const caveats = Array.isArray(candidate.caveats) ? candidate.caveats.map(item => recommendationText(item, 280)).filter((item): item is string => Boolean(item)).slice(0, 4) : [];
      const evidence = (Array.isArray(candidate.evidence) ? candidate.evidence : []).map((item): RecommendationEvidence | null => {
        if (!item || typeof item !== "object") return null;
        const evidenceItem = item as Partial<RecommendationEvidence>;
        const claim = recommendationText(evidenceItem.claim, 420);
        const sourceUrls = Array.isArray(evidenceItem.sourceUrls)
          ? Array.from(new Set(evidenceItem.sourceUrls.filter((url): url is string => typeof url === "string" && validUrls.has(url))))
          : [];
        return claim && sourceUrls.length ? { claim, sourceUrls } : null;
      }).filter((item): item is RecommendationEvidence => Boolean(item)).slice(0, 4);
      return name && summary && strengths.length && evidence.length ? { rank, name, summary, strengths, caveats, evidence } : null;
    }).filter((item): item is RecommendationOption => Boolean(item)).sort((a, b) => a.rank - b.rank);
    const uniqueNames = new Set(options.map(option => option.name.toLocaleLowerCase()));
    const selectionAdvice = recommendationText(parsed.selectionAdvice, 700);
    if (criteria.length < 2 || options.length < 3 || uniqueNames.size < 3 || !selectionAdvice) return null;
    return { criteria, options: options.map((option, index) => ({ ...option, rank: index + 1 })), selectionAdvice };
  } catch {
    return null;
  }
}

function renderStructuredRecommendationMarkdown(brief: RecommendationBrief, sources: GroundedRecommendationSource[], sourceLabel = "Google Search grounding") {
  const options = brief.options.map(option => {
    const strengths = option.strengths.map(strength => `- ${strength}`).join("\n");
    const caveats = option.caveats.length ? option.caveats.map(caveat => `- ${caveat}`).join("\n") : "- No material caveat was verified in the retained evidence.";
    const evidence = option.evidence.map(item => `- ${item.claim} ${item.sourceUrls.map(url => `[Source](${url})`).join(" ")}`).join("\n");
    return `### ${option.rank}. ${option.name}\n\n${option.summary}\n\n**Why it fits**\n${strengths}\n\n**Evidence**\n${evidence}\n\n**Caveats**\n${caveats}`;
  }).join("\n\n");
  return renderGroundedRecommendationMarkdown(`## Recommended shortlist\n\n**Decision criteria:** ${brief.criteria.join(" · ")}\n\n${options}\n\n## How to choose\n\n${brief.selectionAdvice}\n\n## Evidence caveats\n\nThis shortlist includes only options with attributable ${sourceLabel}. Availability, hours, pricing, and venue conditions can change; verify the linked source material before acting.`, sources);
}

export async function synthesizeLocalPlaceRecommendation(intent: ResearchIntent, sources: GroundedRecommendationSource[]) {
  if (sources.length < 3) return null;
  const model = await chooseResearchModel();
  const response = await invokeResearchLLM({
    model,
    max_tokens: 1200,
    messages: [
      { role: "system", content: "You are a senior research IC preparing a decision-ready local recommendation shortlist from Google Maps Places evidence. Use only the supplied venue names, Google Maps URLs, addresses, ratings, review counts, and business-status excerpts. Never infer décor, menu, atmosphere, price, or opening hours unless the source excerpt states it. Return an empty options list if fewer than three distinct named venues are supplied." },
      { role: "user", content: JSON.stringify({ request: intent.researchGoal, sources, requiredResponse: { criteria: ["criterion"], options: [{ rank: 1, name: "venue", summary: "one source-supported sentence", strengths: ["source-supported strength"], caveats: ["qualified uncertainty"], evidence: [{ claim: "specific source-supported fact", sourceUrls: ["exact supplied Google Maps URL"] }] }], selectionAdvice: "how to choose" } }) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "maps_places_recommendation", strict: true, schema: {
      type: "object",
      properties: {
        criteria: { type: "array", items: { type: "string" } },
        options: { type: "array", items: { type: "object", properties: { rank: { type: "integer" }, name: { type: "string" }, summary: { type: "string" }, strengths: { type: "array", items: { type: "string" } }, caveats: { type: "array", items: { type: "string" } }, evidence: { type: "array", items: { type: "object", properties: { claim: { type: "string" }, sourceUrls: { type: "array", items: { type: "string" } } }, required: ["claim", "sourceUrls"], additionalProperties: false } } }, required: ["rank", "name", "summary", "strengths", "caveats", "evidence"], additionalProperties: false } },
        selectionAdvice: { type: "string" },
      },
      required: ["criteria", "options", "selectionAdvice"],
      additionalProperties: false,
    } } },
  });
  const content = response.choices[0]?.message.content;
  return parseGroundedRecommendationBrief(typeof content === "string" ? content : "", sources);
}

export async function synthesizeResearchBrief(input: {
  intent: ResearchIntent;
  findings: Array<{ title: string; claim: string; evidence: string; citationSourceIdsJson: string }>;
  sources: Array<{ id: string; title: string; url: string; publisher: string | null; excerpt: string | null }>;
}): Promise<{ output: string; groundedSources: GroundedRecommendationSource[]; recommendation?: RecommendationBrief; sourceAttribution?: string }> {
  const sourceMap = new Map(input.sources.map(source => [source.id, source]));
  const findings = input.findings.slice(0, 10).map(finding => ({
    title: finding.title,
    claim: finding.claim,
    evidence: finding.evidence,
    sources: (() => {
      try {
        return JSON.parse(finding.citationSourceIdsJson || "[]").map((id: string) => sourceMap.get(id)).filter(Boolean).map((source: { title: string; url: string }) => ({ title: source.title, url: source.url }));
      } catch {
        return [];
      }
    })(),
  }));
  const sources = Array.from(new Map(input.sources.map(source => [source.url, source])).values()).slice(0, 10).map(source => ({ title: source.title, url: source.url, publisher: source.publisher, excerpt: source.excerpt }));
  if (isRecommendationResearch(input.intent)) {
    let groundingUnavailable = false;
    try {
      const grounded = await invokeGroundedRecommendationResearch({
        request: `Act as a senior research IC delivering a decision-ready local recommendation brief. Request: ${input.intent.researchGoal}\n\nUse Google Search to find a diverse shortlist of at least three distinct, publicly verifiable named options when the evidence supports it. First infer the real decision criteria from the request. For each option, extract only source-supported details for atmosphere or design cue, area or location context when available, food/drink or experience focus, best use case, and caveats. Do not repeat the same venue, do not substitute generic categories for named options, and do not invent venue details. If fewer than three distinct named options are verifiable, return an empty options list.\n\nReturn ONLY valid JSON with this exact shape: {"criteria":["criterion"],"options":[{"rank":1,"name":"option name","summary":"one sentence","strengths":["source-supported strength"],"caveats":["source-supported caveat or qualified uncertainty"],"evidence":[{"claim":"specific source-supported fact","sourceUrls":["exact grounded citation URL"]}]}],"selectionAdvice":"how to choose among the options"}. Include at least two criteria, three options, one strength, and one source-linked evidence item for each option. In sourceUrls, use only the exact URLs provided by Google Search grounding.`,
      });
      const recommendation = grounded.sources.length >= 3 ? parseGroundedRecommendationBrief(grounded.output, grounded.sources) : null;
      if (recommendation) return { output: renderStructuredRecommendationMarkdown(recommendation, grounded.sources), groundedSources: grounded.sources, recommendation, sourceAttribution: "Gemini Google Search grounding" };
    } catch {
      groundingUnavailable = true;
    }
    if (isLocalVenueRecommendation(input.intent)) {
      try {
        const placeSources = await searchLocalRecommendationPlaces(input.intent.researchGoal);
        const mappedPlaceSources = placeSources.map(source => ({ title: source.title, url: source.url, publisher: source.publisher, excerpt: source.excerpt }));
        const recommendation = await synthesizeLocalPlaceRecommendation(input.intent, mappedPlaceSources);
        if (recommendation) return {
          output: renderStructuredRecommendationMarkdown(recommendation, mappedPlaceSources, "Google Maps Places evidence"),
          groundedSources: mappedPlaceSources,
          recommendation,
          sourceAttribution: "Google Maps Places evidence",
        };
      } catch {
        // Local venue evidence is optional; retain the strict no-overclaiming evidence gate below.
      }
    }
    return {
      output: `## Recommendation evidence gap\n\n${groundingUnavailable ? "Grounded public-web search is temporarily unavailable, and a local venue-evidence fallback could not verify a diverse shortlist right now. " : "The grounded search response did not contain enough attributable, diverse evidence. "}The available public evidence retains ${sources.length} distinct source${sources.length === 1 ? "" : "s"}, which is not enough to responsibly rank a multi-option shortlist. ResearchOS will not turn a thin source set into a broad recommendation. Use **Broaden scope** to retry this brief when public-search capacity is available.\n\n${buildEvidenceDigest(input.intent, sources)}`,
      groundedSources: [],
    };
  }
  try {
    const model = await chooseResearchModel();
    const response = await invokeResearchLLM({
      model,
      max_tokens: 900,
      messages: [
        { role: "system", content: "You are a senior research lead preparing the final decision-ready answer. Write a substantive Markdown brief that answers the research goal directly—not a process update or a source list. Include an `## Answer` heading, a balanced conclusion, the principal supporting and limiting evidence, and practical implications. Use only the supplied findings and source excerpts; do not invent facts or numbers. Cite each factual conclusion with direct Markdown links to the supplied source URLs. If evidence is weak or indirect, say so clearly." },
        { role: "user", content: JSON.stringify({ researchGoal: input.intent.researchGoal, requestedFormat: input.intent.outputFormat, findings, sources }) },
      ],
    });
    const output = String(response.choices[0]?.message.content || "").replace(/^```markdown\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
    if (output.length >= 180) return { output, groundedSources: [] };
  } catch {
    // The deterministic digest below keeps the completed workspace useful if final synthesis is temporarily unavailable.
  }
  const fallback = isRecommendationResearch(input.intent)
    ? `## Recommendation evidence gap\n\nThe available public evidence does not verify enough distinct named options for a defensible shortlist. Rather than overstate a single recommendation, this brief preserves the directly linked evidence below and recommends a broader retrieval pass.\n\n${buildEvidenceDigest(input.intent, sources)}`
    : buildEvidenceDigest(input.intent, sources);
  return { output: fallback, groundedSources: [] };
}

export async function synthesizeResearchOutput(input: Parameters<typeof synthesizeResearchBrief>[0]): Promise<string> {
  return (await synthesizeResearchBrief(input)).output;
}

function buildFinalOutput(intent: ResearchIntent, findingCount: number): string {
  const formatLabels: Record<ResearchIntent["outputFormat"], string> = {
    report: "Structured research brief",
    summary: "Executive summary",
    comparison: "Evidence-led comparison",
    timeline: "Evidence-led timeline",
    qa: "Research Q&A",
  };
  return `# ${intent.title}\n\n## ${formatLabels[intent.outputFormat]}\n\n**Research objective:** ${intent.researchGoal}\n\nThe attributed findings below were developed from live public-web sources. Each finding includes its own source links; use the references panel to inspect the original material.\n\n**Evidence collected:** ${findingCount} attributable findings across the completed research plan.`;
}

export function isAiServiceLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /AI_PROVIDERS_UNAVAILABLE|\b412\b|usage exhausted|rate limit|quota|resource exhausted/i.test(message);
}

export function toPublicResearchError(error: unknown) {
  if (isAiServiceLimitError(error)) {
    return "The AI service is temporarily unavailable. Your research workspace has been preserved and can be resumed.";
  }
  return error instanceof Error ? error.message : "Research execution failed";
}

function emit(emitEvent: (event: ResearchProgressEvent) => void, event: ResearchProgressEvent) {
  emitEvent(event);
}

export async function runResearchSession(input: {
  sessionId: string;
  userId: number;
  emit: (event: ResearchProgressEvent) => void;
}) {
  const session = await getResearchSessionForUser(input.sessionId, input.userId);
  if (!session) throw new Error("Research session not found");
  if (session.status === "complete") {
    emit(input.emit, { type: "complete", sessionId: input.sessionId });
    return;
  }

  const lastActivity = { current: null as { phase: "planning" | "discovery" | "analysis" | "synthesis"; progress: number; message: string } | null };
  const emitToClient = input.emit;
  input.emit = event => {
    if (event.type === "activity") lastActivity.current = { phase: event.phase, progress: event.progress, message: event.message };
    emitToClient(event);
  };

  try {
    const storedPlan = session.status === "failed" ? readStoredPlan(session.planJson) : null;
    const persistedPlan = storedPlan ?? [];
    const storedSteps = persistedPlan.length ? await listResearchSteps(session.id) : [];
    const completedStepIds = new Set(storedSteps.filter(step => step.status === "complete" || step.status === "skipped").map(step => step.id));
    const resumePlan = storedPlan?.filter(step => !completedStepIds.has(step.id)) ?? null;
    const isResuming = Boolean(storedPlan);
    let intent: ResearchIntent;
    let plan: ResearchPlanStep[];

    if (isResuming) {
      intent = {
        title: session.title,
        intent: session.intent || session.query,
        researchGoal: session.researchGoal || session.query,
        requiresClarification: false,
        clarifyingQuestion: "",
        outputFormat: session.outputFormat,
        plan: persistedPlan.map(({ id, ordinal, ...step }) => step),
      };
      plan = resumePlan ?? [];
      await updateResearchSessionForUser(session.id, input.userId, { status: "researching", errorMessage: null });
      emit(input.emit, { type: "activity", sessionId: session.id, phase: "planning", message: `Resuming ${plan.length} remaining research steps and preserving previously collected evidence.`, progress: 25 });
      emit(input.emit, { type: "intent", sessionId: session.id, intent });
      emit(input.emit, { type: "plan", sessionId: session.id, plan: persistedPlan });
    } else {
      await updateResearchSessionForUser(session.id, input.userId, { status: "planning", errorMessage: null });
      emit(input.emit, { type: "activity", sessionId: session.id, phase: "planning", message: "Interpreting the research objective and choosing the right evidence format.", progress: 8 });
      intent = await interpretResearchQuery(session.query, session.researchDepth);
      emit(input.emit, { type: "activity", sessionId: session.id, phase: "planning", message: "Research objective understood. Preparing the work plan.", progress: 18 });
      emit(input.emit, { type: "intent", sessionId: session.id, intent });

      if (intent.requiresClarification) {
      await updateResearchSessionForUser(session.id, input.userId, {
        title: intent.title,
        researchGoal: intent.researchGoal,
        intent: intent.intent,
        outputFormat: intent.outputFormat,
        status: "awaiting_clarification",
        clarifyingQuestion: intent.clarifyingQuestion || "What should the research prioritize?",
      });
      emit(input.emit, { type: "clarification", sessionId: session.id, question: intent.clarifyingQuestion || "What should the research prioritize?" });
      return;
      }

      plan = makePlanSteps(intent, session.researchDepth);
      await replaceResearchSteps(session.id, plan.map(step => ({
      id: step.id,
      sessionId: session.id,
      ordinal: step.ordinal,
      title: step.title,
      description: step.description,
      searchQuery: step.searchQuery,
      status: "pending",
      })));
      await updateResearchSessionForUser(session.id, input.userId, {
      title: intent.title,
      researchGoal: intent.researchGoal,
      intent: intent.intent,
      outputFormat: intent.outputFormat,
      status: "researching",
      clarifyingQuestion: null,
      planJson: JSON.stringify(plan),
      });
      emit(input.emit, { type: "plan", sessionId: session.id, plan });
      emit(input.emit, { type: "activity", sessionId: session.id, phase: "discovery", message: `Plan ready with ${plan.length} evidence steps. Beginning live source discovery.`, progress: 25 });
    }

    const existingFindings = isResuming ? await listResearchFindings(session.id) : [];
    const existingSources = isResuming ? await listResearchSources(session.id) : [];
    const seenSourceUrls = new Set(existingSources.map(source => source.url));
    let findingOrdinal = existingFindings.length;
    let adaptationCount = 0;
    for (const step of plan) {
      await updateResearchStep(step.id, { status: "active", startedAt: new Date() });
      emit(input.emit, { type: "step", sessionId: session.id, stepId: step.id, status: "active", title: step.title });
      emit(input.emit, { type: "activity", sessionId: session.id, phase: "discovery", message: `Searching public sources for: ${step.title}.`, progress: 28 + Math.round((step.ordinal / Math.max(plan.length, 1)) * 45) });
      const webSources = await searchPublicWeb(step.searchQuery);
      const novelWebSources = webSources.filter(source => {
        if (seenSourceUrls.has(source.url)) return false;
        seenSourceUrls.add(source.url);
        return true;
      });
      if (!novelWebSources.length) {
        await updateResearchStep(step.id, { status: "skipped", completedAt: new Date() });
        emit(input.emit, { type: "activity", sessionId: session.id, phase: "discovery", message: webSources.length ? `The search returned only sources already captured by earlier steps. Skipping duplicate evidence and continuing the broader plan.` : `No attributable sources were returned for ${step.title}. Skipping this narrow step and continuing the broader research plan.`, progress: 33 + Math.round(((step.ordinal + 1) / Math.max(plan.length, 1)) * 42) });
        emit(input.emit, { type: "step", sessionId: session.id, stepId: step.id, status: "skipped", title: step.title });
        continue;
      }
      const persistedSources = novelWebSources.map(source => {
        const quality = scoreResearchSource(source, step.searchQuery);
        return {
          id: nanoid(),
          sessionId: session.id,
          stepId: step.id,
          sourceType: "web" as const,
          ...source,
          qualityScore: quality.score,
          qualitySignalsJson: JSON.stringify(quality.signals),
          citationCount: 0,
        };
      });
      await addResearchSources(persistedSources);
      emit(input.emit, { type: "sources", sessionId: session.id, stepId: step.id, sources: persistedSources });
      emit(input.emit, { type: "activity", sessionId: session.id, phase: "analysis", message: `${persistedSources.length} attributable sources found. Evaluating the evidence for this step.`, progress: 35 + Math.round((step.ordinal / Math.max(plan.length, 1)) * 45) });

      if (adaptationCount < 2 && plan.some(candidate => candidate.ordinal > step.ordinal)) {
        try {
          const adaptation = await proposeAdaptiveChange({
            researchGoal: intent.researchGoal,
            completedStep: step,
            existingPlan: plan,
            sources: persistedSources.map(source => ({ title: source.title, url: source.url, publisher: source.publisher, excerpt: source.excerpt })),
          });
          const applied = applyPlanAdaptation(plan, step.ordinal, adaptation);
          if (applied.kind !== "none") {
            plan.splice(0, plan.length, ...applied.plan);
            adaptationCount += 1;
            if (applied.kind === "append") {
              await addResearchStep({
                id: applied.step.id,
                sessionId: session.id,
                ordinal: applied.step.ordinal,
                title: applied.step.title,
                description: applied.step.description,
                searchQuery: applied.step.searchQuery,
                status: "pending",
              });
            } else {
              await updateResearchStepDetails(applied.step.id, {
                title: applied.step.title,
                description: applied.step.description,
                searchQuery: applied.step.searchQuery,
              });
            }
            await updateResearchSessionForUser(session.id, input.userId, { planJson: JSON.stringify(plan) });
            emit(input.emit, { type: "plan", sessionId: session.id, plan });
          }
        } catch {
          // An optional adaptation must not prevent the original evidence plan from completing.
        }
      }

      const sourcePacket = persistedSources.map(source => ({ title: source.title, url: source.url, publisher: source.publisher, excerpt: source.excerpt })).filter(source => source.excerpt).slice(0, 8);
      let result: { findings: AgentFinding[] };
      try {
        const model = await chooseResearchModel();
        const analysis = await invokeResearchLLM({
          model,
          messages: [
            { role: "system", content: "You are a precise research analyst. Write only grounded findings using the supplied public sources. Every finding must name only source URLs from the source packet; do not use training knowledge as evidence. If the sources are insufficient, return an empty findings list rather than making an unsupported claim." },
            { role: "user", content: JSON.stringify({ researchGoal: intent.researchGoal, step: { title: step.title, description: step.description }, sources: sourcePacket }) },
          ],
          response_format: { type: "json_schema", json_schema: { name: "attributed_findings", strict: true, schema: findingsSchema } },
        });
        result = parseJson<{ findings: AgentFinding[] }>(analysis.choices[0]?.message.content);
      } catch {
        emit(input.emit, { type: "activity", sessionId: session.id, phase: "analysis", message: "Model synthesis is temporarily unavailable. Preserving direct source-backed excerpts and continuing the research plan.", progress: 40 + Math.round((step.ordinal / Math.max(plan.length, 1)) * 45) });
        result = { findings: sourceFallbackFindings(persistedSources) };
      }
      const sourceByUrl = new Map(persistedSources.map(source => [source.url, source]));
      const attributedFindings = result.findings
        .map(finding => ({ ...finding, citationSourceIds: Array.from(new Set(finding.sourceUrls.map(url => sourceByUrl.get(url)?.id).filter((id): id is string => Boolean(id)))) }))
        .filter(finding => finding.citationSourceIds.length > 0)
        .slice(0, 4);
      const safeFindings = attributedFindings.length > 0
        ? attributedFindings
        : sourceFallbackFindings(persistedSources).map(finding => ({
          ...finding,
          citationSourceIds: Array.from(new Set(finding.sourceUrls.map(url => sourceByUrl.get(url)?.id).filter((id): id is string => Boolean(id)))),
        })).filter(finding => finding.citationSourceIds.length > 0);
      if (!attributedFindings.length && safeFindings.length) {
        emit(input.emit, { type: "activity", sessionId: session.id, phase: "analysis", message: "The model returned no directly attributable claims. Preserving source-backed excerpts as the completed brief instead.", progress: 42 + Math.round((step.ordinal / Math.max(plan.length, 1)) * 45) });
      }
      const persistedFindings = safeFindings.map(finding => ({
        id: nanoid(),
        sessionId: session.id,
        stepId: step.id,
        ordinal: findingOrdinal++,
        title: finding.title,
        claim: finding.claim,
        evidence: finding.evidence,
        citationSourceIdsJson: JSON.stringify(finding.citationSourceIds),
      }));
      await addResearchFindings(persistedFindings);
      await addResearchCitations(persistedFindings.flatMap((finding, index) =>
        safeFindings[index].citationSourceIds.map(sourceId => ({
          id: nanoid(),
          findingId: finding.id,
          sourceId,
        }))
      ));
      const citationCounts = new Map<string, number>();
      safeFindings.flatMap(finding => finding.citationSourceIds).forEach(sourceId => citationCounts.set(sourceId, (citationCounts.get(sourceId) ?? 0) + 1));
      await updateResearchSourceQuality(persistedSources.map(source => {
        const citationCount = citationCounts.get(source.id) ?? 0;
        const quality = scoreResearchSource(source, step.searchQuery, citationCount);
        return { id: source.id, qualityScore: quality.score, qualitySignalsJson: JSON.stringify(quality.signals), citationCount };
      }));
      emit(input.emit, { type: "findings", sessionId: session.id, stepId: step.id, findings: safeFindings.map((finding, index) => ({ ...finding, id: persistedFindings[index].id })) });
      emit(input.emit, { type: "activity", sessionId: session.id, phase: "analysis", message: `${safeFindings.length} cited findings added from ${step.title}.`, progress: 43 + Math.round(((step.ordinal + 1) / Math.max(plan.length, 1)) * 42) });
      await updateResearchStep(step.id, { status: "complete", completedAt: new Date() });
      emit(input.emit, { type: "step", sessionId: session.id, stepId: step.id, status: "complete", title: step.title });
    }

    emit(input.emit, { type: "activity", sessionId: session.id, phase: "synthesis", message: "Synthesizing a decision-ready answer from the retained evidence.", progress: 92 });
    const [completedFindings, completedSources] = await Promise.all([listResearchFindings(session.id), listResearchSources(session.id)]);
    const finalBrief = await synthesizeResearchBrief({ intent, findings: completedFindings, sources: completedSources });
    const knownUrls = new Set(completedSources.map(source => source.url));
    const newGroundedSources = finalBrief.groundedSources.filter(source => !knownUrls.has(source.url));
    const persistedGroundedSources = newGroundedSources.map(source => ({
      id: nanoid(),
      sessionId: session.id,
      stepId: plan.at(-1)?.id ?? null,
      sourceType: "web" as const,
      title: source.title,
      url: source.url,
      publisher: source.publisher,
      excerpt: source.excerpt,
      qualityScore: 88,
      qualitySignalsJson: JSON.stringify([finalBrief.sourceAttribution ?? "Gemini Google Search grounded citation"]),
      citationCount: 1,
    }));
    if (newGroundedSources.length) {
      await addResearchSources(persistedGroundedSources);
    }
    const recommendation = finalBrief.recommendation;
    if (recommendation) {
      const sourceIdByUrl = new Map([...completedSources, ...persistedGroundedSources].map(source => [source.url, source.id]));
      await replaceResearchRecommendationOptions(session.id, recommendation.options.map(option => {
        const citationSourceIds = Array.from(new Set(option.evidence.flatMap(item =>
          item.sourceUrls.map(url => sourceIdByUrl.get(url)).filter((id): id is string => Boolean(id))
        )));
        return {
          id: nanoid(),
          sessionId: session.id,
          rank: option.rank,
          name: option.name,
          summary: option.summary,
          strengthsJson: JSON.stringify(option.strengths),
          caveatsJson: JSON.stringify(option.caveats),
          evidenceJson: JSON.stringify(option.evidence),
          citationSourceIdsJson: JSON.stringify(citationSourceIds),
          criteriaJson: JSON.stringify(recommendation.criteria),
          selectionAdvice: recommendation.selectionAdvice,
        };
      }));
    }
    await updateResearchSessionForUser(session.id, input.userId, {
      status: "complete",
      finalOutput: finalBrief.output,
      completedAt: new Date(),
    });
    emit(input.emit, { type: "activity", sessionId: session.id, phase: "synthesis", message: "Research complete. Your cited brief is ready.", progress: 100 });
    emit(input.emit, { type: "complete", sessionId: session.id });
  } catch (error) {
    const isAiLimit = isAiServiceLimitError(error);
    const message = toPublicResearchError(error);
    const savedSteps = await listResearchSteps(session.id);
    const activeStep = savedSteps.find(step => step.status === "active");
    const settledSteps = savedSteps.filter(step => step.status === "complete" || step.status === "skipped").length;
    const lifecyclePhase = lastActivity.current?.phase ?? (session.status === "planning" ? "planning" : activeStep ? "analysis" : "researching");
    const lifecycleProgress = lastActivity.current?.progress ?? (session.status === "planning" ? 18 : Math.min(90, 25 + Math.round((settledSteps / Math.max(savedSteps.length, 1)) * 65)));
    const lifecycleMessage = lastActivity.current?.message ?? (isAiLimit
      ? `Research safely paused during ${activeStep?.title || lifecyclePhase}. Collected work remains available to resume.`
      : message);
    await updateResearchSessionForUser(session.id, input.userId, {
      status: "failed",
      errorMessage: isAiLimit ? "AI_SERVICE_LIMIT" : message,
      lifecyclePhase,
      lifecycleProgress,
      lifecycleMessage,
      providerDiagnosticsJson: JSON.stringify(providerAttemptsFromError(error)),
    });
    emit(input.emit, { type: "error", sessionId: input.sessionId, message });
  }
}
