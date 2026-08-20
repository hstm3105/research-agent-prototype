import { nanoid } from "nanoid";
import {
  addResearchCitations,
  addResearchFindings,
  addResearchStep,
  addResearchSources,
  getResearchSessionForUser,
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

export async function interpretResearchQuery(query: string): Promise<ResearchIntent> {
  const model = await chooseResearchModel();
  const response = await invokeLLM({
    model,
    messages: [
      {
        role: "system",
        content: "You are a senior research lead. Interpret the request before researching. Ask one concise clarifying question only if a missing decision would materially change the research. Otherwise state an empty string. Select the output format that best serves the task. Draft 3 to 5 sequential web-research steps, with specific non-overlapping search queries. Do not claim facts or cite sources in this planning stage.",
      },
      { role: "user", content: query },
    ],
    response_format: { type: "json_schema", json_schema: { name: "research_intent", strict: true, schema: intentSchema } },
  });
  const intent = parseJson<ResearchIntent>(response.choices[0]?.message.content);
  if (!outputFormatValues.includes(intent.outputFormat) || !intent.plan.length) throw new Error("The proposed research plan was incomplete");
  return intent;
}

function makePlanSteps(intent: ResearchIntent): ResearchPlanStep[] {
  return intent.plan.slice(0, 5).map((step, ordinal) => ({ ...step, id: nanoid(), ordinal }));
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
    await updateResearchSessionForUser(session.id, input.userId, { status: "planning", errorMessage: null });
    const intent = await interpretResearchQuery(session.query);
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

    const plan = makePlanSteps(intent);
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

    let findingOrdinal = 0;
    let adaptationCount = 0;
    for (const step of plan) {
      await updateResearchStep(step.id, { status: "active", startedAt: new Date() });
      emit(input.emit, { type: "step", sessionId: session.id, stepId: step.id, status: "active", title: step.title });
      const webSources = await searchPublicWeb(step.searchQuery);
      const persistedSources = webSources.map(source => ({ id: nanoid(), sessionId: session.id, stepId: step.id, sourceType: "web" as const, ...source }));
      await addResearchSources(persistedSources);
      emit(input.emit, { type: "sources", sessionId: session.id, stepId: step.id, sources: persistedSources });

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

      const model = await chooseResearchModel();
      const sourcePacket = persistedSources.map(source => ({ title: source.title, url: source.url, publisher: source.publisher, excerpt: source.excerpt })).filter(source => source.excerpt).slice(0, 8);
      const analysis = await invokeLLM({
        model,
        messages: [
          { role: "system", content: "You are a precise research analyst. Write only grounded findings using the supplied public sources. Every finding must name only source URLs from the source packet; do not use training knowledge as evidence. If the sources are insufficient, return an empty findings list rather than making an unsupported claim." },
          { role: "user", content: JSON.stringify({ researchGoal: intent.researchGoal, step: { title: step.title, description: step.description }, sources: sourcePacket }) },
        ],
        response_format: { type: "json_schema", json_schema: { name: "attributed_findings", strict: true, schema: findingsSchema } },
      });
      const result = parseJson<{ findings: AgentFinding[] }>(analysis.choices[0]?.message.content);
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
      await updateResearchStep(step.id, { status: "complete", completedAt: new Date() });
      emit(input.emit, { type: "step", sessionId: session.id, stepId: step.id, status: "complete", title: step.title });
    }

    await updateResearchSessionForUser(session.id, input.userId, {
      status: "complete",
      finalOutput: buildFinalOutput(intent, findingOrdinal),
      completedAt: new Date(),
    });
    emit(input.emit, { type: "complete", sessionId: session.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research execution failed";
    await updateResearchSessionForUser(session.id, input.userId, { status: "failed", errorMessage: message });
    emit(input.emit, { type: "error", sessionId: input.sessionId, message });
  }
}
