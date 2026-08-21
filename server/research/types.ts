export type OutputFormat = "report" | "summary" | "comparison" | "timeline" | "qa";
export type SessionStatus = "draft" | "awaiting_clarification" | "planning" | "researching" | "complete" | "failed";

export type ResearchPlanStep = {
  id: string;
  ordinal: number;
  title: string;
  description: string;
  searchQuery: string;
};

export type ResearchIntent = {
  title: string;
  intent: string;
  researchGoal: string;
  requiresClarification: boolean;
  clarifyingQuestion: string;
  outputFormat: OutputFormat;
  plan: Array<Omit<ResearchPlanStep, "id" | "ordinal">>;
};

export type NormalizedSearchSource = {
  title: string;
  url: string;
  publisher: string | null;
  excerpt: string | null;
  qualityScore?: number;
  qualitySignalsJson?: string | null;
  citationCount?: number;
  retrievedAt: Date;
};

export type AgentFinding = {
  title: string;
  claim: string;
  evidence: string;
  sourceUrls: string[];
};

export type ResearchProgressEvent =
  | { type: "connected"; sessionId: string }
  | { type: "activity"; sessionId: string; phase: "planning" | "discovery" | "analysis" | "synthesis"; message: string; progress: number }
  | { type: "intent"; sessionId: string; intent: ResearchIntent }
  | { type: "clarification"; sessionId: string; question: string }
  | { type: "plan"; sessionId: string; plan: ResearchPlanStep[] }
  | { type: "step"; sessionId: string; stepId: string; status: "active" | "complete" | "skipped" | "failed"; title: string }
  | { type: "sources"; sessionId: string; stepId: string; sources: Array<NormalizedSearchSource & { id: string }> }
  | { type: "findings"; sessionId: string; stepId: string; findings: Array<AgentFinding & { id: string; citationSourceIds: string[] }> }
  | { type: "complete"; sessionId: string }
  | { type: "error"; sessionId: string; message: string };
