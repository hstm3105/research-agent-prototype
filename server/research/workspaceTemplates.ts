import type { DecisionArtifact } from "./types";

export type GoogleDocTemplate = {
  title: string;
  body: string;
};

export type GoogleSheetTemplate = {
  title: string;
  sheets: Array<{ name: string; rows: string[][] }>;
};

export type GoogleSlidesTemplate = {
  title: string;
  slides: Array<{ title: string; subtitle?: string; bullets: string[]; sourceUrls: string[] }>;
};

function prose(value: string) {
  return value.replace(/^#{1,6}\s+/gm, "").replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)").trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildGoogleDocTemplate(artifact: DecisionArtifact): GoogleDocTemplate {
  const options = artifact.recommendedOptions.map(option => {
    const evidence = option.evidence.map(item => `- ${item.claim}${item.sourceUrls.length ? ` (${item.sourceUrls.join(", ")})` : ""}`).join("\n");
    return `### ${option.rank}. ${option.name}\n${option.summary}\n\n**Why it fits**\n${option.strengths.map(item => `- ${item}`).join("\n")}\n\n**Caveats**\n${option.caveats.map(item => `- ${item}`).join("\n") || "- No material caveat was retained."}\n\n**Evidence**\n${evidence || "- No source-linked evidence was retained."}`;
  }).join("\n\n");
  const findingRows = artifact.findings.map((finding, index) => `### ${index + 1}. ${finding.title}\n${finding.claim}\n\n> Evidence: ${finding.evidence}\n\nSources: ${finding.sourceUrls.join(", ") || "No retained source link"}`).join("\n\n");
  const sources = artifact.sources.map((source, index) => `${index + 1}. ${source.title}${source.publisher ? ` — ${source.publisher}` : ""}\n   ${source.url}`).join("\n");
  return {
    title: `${artifact.title} — Decision Brief`,
    body: `# ${artifact.title}\n\n## Decision question\n${artifact.researchGoal}\n\n## Executive synthesis\n${prose(artifact.finalSynthesis)}\n\n${artifact.decisionCriteria.length ? `## Decision criteria\n${artifact.decisionCriteria.map(item => `- ${item}`).join("\n")}\n\n` : ""}${options ? `## Recommended options\n${options}\n\n` : ""}${artifact.selectionAdvice ? `## Recommendation\n${artifact.selectionAdvice}\n\n` : ""}## Evidence matrix\n${findingRows || "No individual findings were retained."}\n\n${artifact.evidenceGaps.length ? `## Evidence gaps\n${artifact.evidenceGaps.map(item => `- ${item}`).join("\n")}\n\n` : ""}## Next actions\n${artifact.nextActions.map(item => `- ${item}`).join("\n")}\n\n## Source ledger\n${sources || "No attributable public sources were retained."}\n`,
  };
}

export function buildGoogleSheetTemplate(artifact: DecisionArtifact): GoogleSheetTemplate {
  const optionRows = artifact.recommendedOptions.length
    ? artifact.recommendedOptions.map(option => [String(option.rank), option.name, option.summary, option.strengths.join(" · "), option.caveats.join(" · "), option.evidence.flatMap(item => item.sourceUrls).join(" · ")])
    : [["", "No structured recommendation retained", "", "", "", ""]];
  return {
    title: `${artifact.title} — Evidence Matrix`,
    sheets: [
      { name: "Decision brief", rows: [["Field", "Value"], ["Research goal", artifact.researchGoal], ["Decision criteria", artifact.decisionCriteria.join(" · ")], ["Recommendation", artifact.selectionAdvice ?? "No structured recommendation retained"], ["Evidence gaps", artifact.evidenceGaps.join(" · ") || "None identified"], ["Next actions", artifact.nextActions.join(" · ")]] },
      { name: "Options", rows: [["Rank", "Option", "Summary", "Strengths", "Caveats", "Evidence URLs"], ...optionRows] },
      { name: "Evidence matrix", rows: [["Finding", "Claim", "Evidence", "Source URLs"], ...artifact.findings.map(finding => [finding.title, finding.claim, finding.evidence, finding.sourceUrls.join(" · ")])] },
      { name: "Source ledger", rows: [["Source", "Publisher", "Excerpt", "URL", "Quality score", "Citation count"], ...artifact.sources.map(source => [source.title, source.publisher ?? "", source.excerpt ?? "", source.url, String(source.qualityScore ?? ""), String(source.citationCount ?? "")])] },
    ],
  };
}

export function buildGoogleSlidesTemplate(artifact: DecisionArtifact): GoogleSlidesTemplate {
  const sourceUrls = artifact.sources.map(source => source.url);
  const recommendationBullets = artifact.recommendedOptions.length
    ? artifact.recommendedOptions.map(option => `${option.rank}. ${option.name} — ${option.summary}`)
    : artifact.findings.slice(0, 4).map(finding => `${finding.title}: ${finding.claim}`);
  return {
    title: `${artifact.title} — Decision Review`,
    slides: [
      { title: artifact.title, subtitle: artifact.researchGoal, bullets: ["Evidence-led decision brief", `Generated ${new Date(artifact.generatedAt).toLocaleDateString()}`], sourceUrls: [] },
      { title: "Decision framing", bullets: artifact.decisionCriteria.length ? artifact.decisionCriteria : ["No explicit decision criteria were retained."], sourceUrls: [] },
      { title: "What the evidence suggests", bullets: artifact.findings.slice(0, 4).map(finding => finding.claim), sourceUrls: unique(artifact.findings.flatMap(finding => finding.sourceUrls)) },
      { title: "Options and recommendation", bullets: recommendationBullets, sourceUrls: unique(artifact.recommendedOptions.flatMap(option => option.evidence.flatMap(item => item.sourceUrls))) },
      { title: "Risks, gaps, and next actions", bullets: [...artifact.evidenceGaps, ...artifact.nextActions], sourceUrls: [] },
      { title: "Source appendix", bullets: artifact.sources.map(source => `${source.title}${source.publisher ? ` — ${source.publisher}` : ""}`), sourceUrls },
    ],
  };
}
