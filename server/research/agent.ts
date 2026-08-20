import { nanoid } from "nanoid";
import {
  addResearchCitations,
  addResearchFindings,
  addResearchStep,
  addResearchSources,
  getResearchSessionForUser,
  listResearchFindings,
  listResearchSteps,
  replaceResearchSteps,
  updateResearchSessionForUser,
  updateResearchStep,
  updateResearchStepDetails,
} from "../db";
import { invokeLLM, listLLMModels } from "../_core/llm";
import { searchPublicWeb } from "./search";
import type { AgentFinding, ResearchIntent, ResearchPlanStep, ResearchProgressEvent } from "./types";

const outputFormatValues = ["report", "summary", "comparison", "timeline", "qa"] as const;

function parseJson<T>(value: unknown): T {
  const raw = Array.isArray(value) ? value.map(part => part.type === "text" ? part.text : "").join("") : value;
  if (typeof raw !== "string") throw new Error("The LLM returned an empty structured response");
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleaned) as T;
}

async function chooseResearchModel() {
  const models = await listLLMModels();
  return models.data.find(model => model.id === "gpt-5")?.id
    ?? models.data.find(model => /sonnet|gpt-5/i.test(model.id))?.id
    ?? models.data[0]?.id;
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
  const response = await invokeLLM({
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
  const response = await invokeLLM({
    model,
    messages: [
      { role: "system", content: "You are reviewing a live research plan after source retrieval. Either (1) revise one pending step if its search query no longer best fills the evidence gap, (2) append one distinct coverage step if a material gap is not addressed, or (3) choose none. Never change a completed step. For action=revise, targetOrdinal must identify a pending existing step; for append, use -1; for none, use -1 and empty strings." },
      { role: "user", content: JSON.stringify(input) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "research_plan_adaptation", strict: true, schema: adaptationSchema } },
  });
  return parseJson<PlanAdaptation>(response.choices[0]?.message.content);
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
    let findingOrdinal = existingFindings.length;
    let adaptationCount = 0;
    for (const step of plan) {
      await updateResearchStep(step.id, { status: "active", startedAt: new Date() });
      emit(input.emit, { type: "step", sessionId: session.id, stepId: step.id, status: "active", title: step.title });
      emit(input.emit, { type: "activity", sessionId: session.id, phase: "discovery", message: `Searching public sources for: ${step.title}.`, progress: 28 + Math.round((step.ordinal / Math.max(plan.length, 1)) * 45) });
      const webSources = await searchPublicWeb(step.searchQuery);
      if (!webSources.length) {
        await updateResearchStep(step.id, { status: "skipped", completedAt: new Date() });
        emit(input.emit, { type: "activity", sessionId: session.id, phase: "discovery", message: `No attributable sources were returned for ${step.title}. Skipping this narrow step and continuing the broader research plan.`, progress: 33 + Math.round(((step.ordinal + 1) / Math.max(plan.length, 1)) * 42) });
        emit(input.emit, { type: "step", sessionId: session.id, stepId: step.id, status: "skipped", title: step.title });
        continue;
      }
      const persistedSources = webSources.map(source => ({ id: nanoid(), sessionId: session.id, stepId: step.id, sourceType: "web" as const, ...source }));
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
        const analysis = await invokeLLM({
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
      const safeFindings = result.findings
        .map(finding => ({ ...finding, citationSourceIds: Array.from(new Set(finding.sourceUrls.map(url => sourceByUrl.get(url)?.id).filter((id): id is string => Boolean(id)))) }))
        .filter(finding => finding.citationSourceIds.length > 0)
        .slice(0, 4);
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
      emit(input.emit, { type: "findings", sessionId: session.id, stepId: step.id, findings: safeFindings.map((finding, index) => ({ ...finding, id: persistedFindings[index].id })) });
      emit(input.emit, { type: "activity", sessionId: session.id, phase: "analysis", message: `${safeFindings.length} cited findings added from ${step.title}.`, progress: 43 + Math.round(((step.ordinal + 1) / Math.max(plan.length, 1)) * 42) });
      await updateResearchStep(step.id, { status: "complete", completedAt: new Date() });
      emit(input.emit, { type: "step", sessionId: session.id, stepId: step.id, status: "complete", title: step.title });
    }

    emit(input.emit, { type: "activity", sessionId: session.id, phase: "synthesis", message: "Synthesizing the final cited research brief.", progress: 92 });
    await updateResearchSessionForUser(session.id, input.userId, {
      status: "complete",
      finalOutput: buildFinalOutput(intent, findingOrdinal),
      completedAt: new Date(),
    });
    emit(input.emit, { type: "activity", sessionId: session.id, phase: "synthesis", message: "Research complete. Your cited brief is ready.", progress: 100 });
    emit(input.emit, { type: "complete", sessionId: session.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research execution failed";
    await updateResearchSessionForUser(session.id, input.userId, { status: "failed", errorMessage: message });
    emit(input.emit, { type: "error", sessionId: input.sessionId, message });
  }
}
