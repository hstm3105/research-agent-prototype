import type { DecisionArtifact, DecisionArtifactFinding, DecisionArtifactSource, OutputFormat, RecommendationBrief } from "./types";

type ArtifactInput = {
  title: string;
  researchGoal: string;
  outputFormat: OutputFormat;
  finalSynthesis: string | null;
  findings: Array<{ id: string; title: string; claim: string; evidence: string; citationSourceIdsJson: string }>;
  sources: DecisionArtifactSource[];
  recommendation?: RecommendationBrief | null;
};

function parseSourceIds(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? Array.from(new Set(parsed.filter((id): id is string => typeof id === "string"))) : [];
  } catch {
    return [];
  }
}

function sourceTraceabilityGaps(findings: DecisionArtifactFinding[], sources: DecisionArtifactSource[]) {
  const gaps: string[] = [];
  if (!sources.length) gaps.push("No attributable public sources were retained for this research run.");
  if (!findings.length) gaps.push("No individually cited findings were retained; review the source ledger before relying on the synthesis.");
  if (findings.some(finding => !finding.sourceIds.length)) gaps.push("At least one finding has no resolvable retained source link.");
  return gaps;
}

function nextActions(input: Pick<ArtifactInput, "recommendation" | "findings" | "sources">, gaps: string[]) {
  if (gaps.length) return ["Review the evidence gaps before acting on the research output.", "Use Broaden Scope to retrieve complementary sources before making a high-consequence decision."];
  if (input.recommendation?.options.length) return ["Select the preferred option against the stated decision criteria.", "Verify current availability, price, and operating conditions with the cited sources before committing."];
  if (input.findings.length) return ["Review the evidence matrix and identify the decision owner, threshold, and next validation step.", "Share the linked sources with stakeholders for challenge and sign-off."];
  return ["Review the retained sources and define the next evidence-gathering step."];
}

/**
 * Produces one structured, auditable representation of a completed research session.
 * Export renderers consume this object rather than re-synthesizing the underlying research.
 */
export function buildDecisionArtifact(input: ArtifactInput): DecisionArtifact {
  const sourceById = new Map(input.sources.map(source => [source.id, source]));
  const findings = input.findings.map<DecisionArtifactFinding>(finding => {
    const sourceIds = parseSourceIds(finding.citationSourceIdsJson).filter(id => sourceById.has(id));
    return {
      id: finding.id,
      title: finding.title,
      claim: finding.claim,
      evidence: finding.evidence,
      sourceIds,
      sourceUrls: sourceIds.map(id => sourceById.get(id)?.url).filter((url): url is string => Boolean(url)),
    };
  });
  const evidenceGaps = sourceTraceabilityGaps(findings, input.sources);
  return {
    version: 1,
    title: input.title,
    researchGoal: input.researchGoal,
    outputFormat: input.outputFormat,
    finalSynthesis: input.finalSynthesis?.trim() || "No final synthesis was retained for this research run.",
    decisionCriteria: input.recommendation?.criteria ?? [],
    recommendedOptions: input.recommendation?.options ?? [],
    selectionAdvice: input.recommendation?.selectionAdvice ?? null,
    findings,
    sources: input.sources,
    evidenceGaps,
    nextActions: nextActions(input, evidenceGaps),
    generatedAt: new Date().toISOString(),
  };
}
