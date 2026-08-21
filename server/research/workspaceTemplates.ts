import type { DecisionArtifact } from "./types";

export type GoogleDocBlock = {
  text: string;
  kind: "title" | "subtitle" | "heading" | "subheading" | "body" | "bullet" | "quote" | "sourceLink";
  link?: string;
};

export type GoogleDocTemplate = {
  title: string;
  /** Retained as an auditable plain-text representation; exports use semantic blocks below. */
  body: string;
  blocks: GoogleDocBlock[];
};

export type GoogleSheetTab = {
  name: string;
  rows: string[][];
  columnWidths: number[];
  wrapColumns: number[];
};

export type GoogleSheetTemplate = {
  title: string;
  sheets: GoogleSheetTab[];
};

export type GoogleSlidesTemplate = {
  title: string;
  slides: Array<{
    title: string;
    subtitle?: string;
    bullets: string[];
    sourceUrls: string[];
    layout: "cover" | "content" | "appendix";
  }>;
};

function prose(value: string) {
  return value.replace(/^#{1,6}\s+/gm, "").replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)").trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function hyperlinkFormula(url?: string, label = "Open source") {
  if (!url) return "";
  return `=HYPERLINK("${url.replace(/"/g, '""')}","${label}")`;
}

function sourceLabel(source: DecisionArtifact["sources"][number]) {
  return `${source.title}${source.publisher ? ` — ${source.publisher}` : ""}`;
}

export function buildGoogleDocTemplate(artifact: DecisionArtifact): GoogleDocTemplate {
  const options = artifact.recommendedOptions.map(option => {
    const evidence = option.evidence.map(item => `- ${item.claim}${item.sourceUrls.length ? ` (${item.sourceUrls.join(", ")})` : ""}`).join("\n");
    return `### ${option.rank}. ${option.name}\n${option.summary}\n\n**Why it fits**\n${option.strengths.map(item => `- ${item}`).join("\n")}\n\n**Caveats**\n${option.caveats.map(item => `- ${item}`).join("\n") || "- No material caveat was retained."}\n\n**Evidence**\n${evidence || "- No source-linked evidence was retained."}`;
  }).join("\n\n");
  const findingRows = artifact.findings.map((finding, index) => `### ${index + 1}. ${finding.title}\n${finding.claim}\n\n> Evidence: ${finding.evidence}\n\nSources: ${finding.sourceUrls.join(", ") || "No retained source link"}`).join("\n\n");
  const sources = artifact.sources.map((source, index) => `${index + 1}. ${sourceLabel(source)}\n   ${source.url}`).join("\n");
  const blocks: GoogleDocBlock[] = [];
  const add = (kind: GoogleDocBlock["kind"], text: string, link?: string) => {
    if (text.trim()) blocks.push({ kind, text, link });
  };

  add("title", artifact.title);
  add("subtitle", "Decision brief · ResearchOS evidence workspace");
  add("heading", "Decision question");
  add("body", artifact.researchGoal);
  add("heading", "Executive synthesis");
  add("quote", prose(artifact.finalSynthesis));

  if (artifact.decisionCriteria.length) {
    add("heading", "Decision criteria");
    artifact.decisionCriteria.forEach(item => add("bullet", item));
  }
  if (artifact.recommendedOptions.length) {
    add("heading", "Recommended options");
    artifact.recommendedOptions.forEach(option => {
      add("subheading", `${option.rank}. ${option.name}`);
      add("body", option.summary);
      add("subheading", "Why it fits");
      (option.strengths.length ? option.strengths : ["No structured strengths were retained."]).forEach(item => add("bullet", item));
      add("subheading", "Caveats");
      (option.caveats.length ? option.caveats : ["No material caveat was retained."]).forEach(item => add("bullet", item));
      add("subheading", "Evidence");
      if (option.evidence.length) option.evidence.forEach(item => add("bullet", item.claim));
      else add("bullet", "No source-linked evidence was retained.");
    });
  }
  if (artifact.selectionAdvice) {
    add("heading", "Recommendation");
    add("quote", artifact.selectionAdvice);
  }
  add("heading", "Evidence matrix");
  if (artifact.findings.length) {
    artifact.findings.forEach((finding, index) => {
      add("subheading", `${index + 1}. ${finding.title}`);
      add("body", finding.claim);
      add("quote", `Evidence: ${finding.evidence}`);
      finding.sourceUrls.forEach(url => add("sourceLink", url, url));
    });
  } else add("body", "No individual findings were retained.");
  if (artifact.evidenceGaps.length) {
    add("heading", "Evidence gaps");
    artifact.evidenceGaps.forEach(item => add("bullet", item));
  }
  add("heading", "Next actions");
  artifact.nextActions.forEach(item => add("bullet", item));
  add("heading", "Source ledger");
  if (artifact.sources.length) {
    artifact.sources.forEach((source, index) => {
      add("subheading", `${index + 1}. ${sourceLabel(source)}`);
      if (source.excerpt) add("body", source.excerpt);
      add("sourceLink", source.url, source.url);
    });
  } else add("body", "No attributable public sources were retained.");

  return {
    title: `${artifact.title} — Decision Brief`,
    body: `# ${artifact.title}\n\n## Decision question\n${artifact.researchGoal}\n\n## Executive synthesis\n${prose(artifact.finalSynthesis)}\n\n${artifact.decisionCriteria.length ? `## Decision criteria\n${artifact.decisionCriteria.map(item => `- ${item}`).join("\n")}\n\n` : ""}${options ? `## Recommended options\n${options}\n\n` : ""}${artifact.selectionAdvice ? `## Recommendation\n${artifact.selectionAdvice}\n\n` : ""}## Evidence matrix\n${findingRows || "No individual findings were retained."}\n\n${artifact.evidenceGaps.length ? `## Evidence gaps\n${artifact.evidenceGaps.map(item => `- ${item}`).join("\n")}\n\n` : ""}## Next actions\n${artifact.nextActions.map(item => `- ${item}`).join("\n")}\n\n## Source ledger\n${sources || "No attributable public sources were retained."}\n`,
    blocks,
  };
}

export function buildGoogleSheetTemplate(artifact: DecisionArtifact): GoogleSheetTemplate {
  const optionRows = artifact.recommendedOptions.length
    ? artifact.recommendedOptions.map(option => {
      const sourceUrls = option.evidence.flatMap(item => item.sourceUrls);
      return [String(option.rank), option.name, option.summary, option.strengths.join(" · "), option.caveats.join(" · "), sourceUrls.join(" · "), hyperlinkFormula(sourceUrls[0], "Open primary source")];
    })
    : [["", "No structured recommendation retained", "", "", "", "", ""]];
  return {
    title: `${artifact.title} — Evidence Matrix`,
    sheets: [
      { name: "Decision brief", rows: [["Field", "Value"], ["Research goal", artifact.researchGoal], ["Decision criteria", artifact.decisionCriteria.join(" · ")], ["Recommendation", artifact.selectionAdvice ?? "No structured recommendation retained"], ["Evidence gaps", artifact.evidenceGaps.join(" · ") || "None identified"], ["Next actions", artifact.nextActions.join(" · ")]], columnWidths: [190, 640], wrapColumns: [0, 1] },
      { name: "Options", rows: [["Rank", "Option", "Summary", "Strengths", "Caveats", "Evidence URLs", "Source"], ...optionRows], columnWidths: [70, 190, 340, 280, 250, 360, 165], wrapColumns: [1, 2, 3, 4, 5, 6] },
      { name: "Evidence matrix", rows: [["Finding", "Claim", "Evidence", "Source URLs", "Source"], ...artifact.findings.map(finding => [finding.title, finding.claim, finding.evidence, finding.sourceUrls.join(" · "), hyperlinkFormula(finding.sourceUrls[0])])], columnWidths: [220, 350, 350, 360, 165], wrapColumns: [0, 1, 2, 3, 4] },
      { name: "Source ledger", rows: [["Source", "Publisher", "Excerpt", "URL", "Quality score", "Citation count", "Open"], ...artifact.sources.map(source => [source.title, source.publisher ?? "", source.excerpt ?? "", source.url, String(source.qualityScore ?? ""), String(source.citationCount ?? ""), hyperlinkFormula(source.url)])], columnWidths: [250, 160, 380, 360, 110, 120, 120], wrapColumns: [0, 1, 2, 3, 6] },
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
      { title: artifact.title, subtitle: artifact.researchGoal, bullets: ["Evidence-led decision brief", `Generated ${new Date(artifact.generatedAt).toLocaleDateString()}`], sourceUrls: [], layout: "cover" },
      { title: "Decision framing", bullets: artifact.decisionCriteria.length ? artifact.decisionCriteria : ["No explicit decision criteria were retained."], sourceUrls: [], layout: "content" },
      { title: "What the evidence suggests", bullets: artifact.findings.slice(0, 4).map(finding => finding.claim), sourceUrls: unique(artifact.findings.flatMap(finding => finding.sourceUrls)), layout: "content" },
      { title: "Options and recommendation", bullets: recommendationBullets, sourceUrls: unique(artifact.recommendedOptions.flatMap(option => option.evidence.flatMap(item => item.sourceUrls))), layout: "content" },
      { title: "Risks, gaps, and next actions", bullets: [...artifact.evidenceGaps, ...artifact.nextActions], sourceUrls: [], layout: "content" },
      { title: "Source appendix", bullets: artifact.sources.map(source => `${sourceLabel(source)}\n${source.url}`), sourceUrls, layout: "appendix" },
    ],
  };
}
