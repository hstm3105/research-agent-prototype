import { nanoid } from "nanoid";
import type { ResearchCitation, ResearchFinding, ResearchSession, ResearchSource } from "../../drizzle/schema";
import {
  createResearchExport,
  getResearchSessionForUser,
  listResearchCitations,
  listResearchFindings,
  listResearchSources,
} from "../db";
import { storagePut } from "../storage";

type ExportFormat = "markdown" | "html";

type ExportData = {
  session: ResearchSession;
  findings: ResearchFinding[];
  sources: ResearchSource[];
  citations: ResearchCitation[];
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function citationMap(data: ExportData) {
  const sourceMap = new Map(data.sources.map(source => [source.id, source]));
  const byFinding = new Map<string, ResearchSource[]>();
  for (const citation of data.citations) {
    const source = sourceMap.get(citation.sourceId);
    if (!source) continue;
    byFinding.set(citation.findingId, [...(byFinding.get(citation.findingId) ?? []), source]);
  }
  return byFinding;
}

function sourceIndex(data: ExportData) {
  return new Map(data.sources.map((source, index) => [source.id, index + 1]));
}

export function renderMarkdownExport(data: ExportData) {
  const citations = citationMap(data);
  const indexes = sourceIndex(data);
  const heading = data.session.title || "Research brief";
  const objective = data.session.researchGoal || data.session.query;
  const findings = data.findings.map((finding, index) => {
    const links = (citations.get(finding.id) ?? []).map(source => `[${indexes.get(source.id)}](${source.url})`).join(" ");
    return `### ${index + 1}. ${finding.title}\n\n${finding.claim}${links ? ` ${links}` : ""}\n\n> **Evidence:** ${finding.evidence}`;
  }).join("\n\n");
  const references = data.sources.map((source, index) => `[${index + 1}] **${source.title}**${source.publisher ? ` — ${source.publisher}` : ""}. ${source.url}`).join("\n\n");
  return `# ${heading}\n\n## Research objective\n\n${objective}\n\n## Findings\n\n${findings || "No attributable findings were retained for this session."}\n\n## References\n\n${references || "No live public sources were retained for this session."}\n`;
}

export function renderPrintHtmlExport(data: ExportData) {
  const citations = citationMap(data);
  const indexes = sourceIndex(data);
  const findings = data.findings.map((finding, index) => {
    const links = (citations.get(finding.id) ?? []).map(source => `<a class="citation" href="${escapeHtml(source.url)}">[${indexes.get(source.id)}]</a>`).join(" ");
    return `<article class="finding"><div class="finding-number">${index + 1}</div><div><h3>${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.claim)} ${links}</p><blockquote>${escapeHtml(finding.evidence)}</blockquote></div></article>`;
  }).join("\n");
  const references = data.sources.map((source, index) => `<li><span class="reference-number">[${index + 1}]</span><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a>${source.publisher ? `<span> · ${escapeHtml(source.publisher)}</span>` : ""}</li>`).join("\n");
  const title = escapeHtml(data.session.title || "Research brief");
  const objective = escapeHtml(data.session.researchGoal || data.session.query);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
@page { size: A4; margin: 18mm; } * { box-sizing: border-box; } body { margin: 0; color: #16282a; background: #fbfaf3; font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.65; } main { max-width: 760px; margin: 0 auto; } .eyebrow { color: #177067; font: 700 8pt monospace; letter-spacing: .16em; text-transform: uppercase; } h1,h2,h3 { color: #102d2d; } h1 { margin: 8px 0 16px; font-family: Georgia,serif; font-size: 34pt; letter-spacing: -.03em; line-height: 1.05; } h2 { margin: 38px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #d9dfd3; font: 700 9pt monospace; letter-spacing: .13em; text-transform: uppercase; } h3 { margin: 0 0 7px; font-size: 13pt; } .objective { padding: 18px 20px; border-left: 4px solid #177067; background: #edf4ee; } .finding { display: grid; grid-template-columns: 30px 1fr; gap: 14px; margin: 0 0 24px; break-inside: avoid; } .finding-number { display: grid; width: 25px; height: 25px; place-items: center; border-radius: 50%; color: #177067; background: #d8efe8; font: 700 9pt monospace; } p { margin: 0; } blockquote { margin: 10px 0 0; padding-left: 12px; border-left: 2px solid #e7bc68; color: #526262; font-size: 10pt; } .citation { display: inline-block; margin-left: 2px; padding: 0 4px; border-radius: 3px; color: #17645d; background: #d8efe8; font: 700 8pt monospace; text-decoration: none; } ol { padding-left: 0; list-style: none; } li { margin: 0 0 9px; padding-left: 33px; position: relative; font-size: 9.5pt; } .reference-number { position: absolute; left: 0; color: #177067; font-family: monospace; } a { color: #17645d; } footer { margin-top: 44px; padding-top: 12px; border-top: 1px solid #d9dfd3; color: #6a7877; font: 8pt monospace; }
</style></head><body><main><p class="eyebrow">ResearchOS · Cited research brief</p><h1>${title}</h1><section class="objective"><strong>Research objective</strong><br>${objective}</section><h2>Findings</h2>${findings || "<p>No attributable findings were retained for this session.</p>"}<h2>References</h2><ol>${references || "<li>No live public sources were retained for this session.</li>"}</ol><footer>Generated from the saved research session. Print this page to PDF for a portable report.</footer></main></body></html>`;
}

export async function generateResearchExport(input: { sessionId: string; userId: number; format: ExportFormat }) {
  const session = await getResearchSessionForUser(input.sessionId, input.userId);
  if (!session) throw new Error("Research session not found");
  if (session.status !== "complete") throw new Error("Exports are available after research is complete");
  const [findings, sources] = await Promise.all([listResearchFindings(session.id), listResearchSources(session.id)]);
  const citations = await listResearchCitations(findings.map(finding => finding.id));
  const data: ExportData = { session, findings, sources, citations };
  const content = input.format === "markdown" ? renderMarkdownExport(data) : renderPrintHtmlExport(data);
  const extension = input.format === "markdown" ? "md" : "html";
  const contentType = input.format === "markdown" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8";
  const exportId = nanoid();
  const { key, url } = await storagePut(
    `research-exports/${input.userId}/${session.id}/${exportId}.${extension}`,
    Buffer.from(content, "utf-8"),
    contentType
  );
  await createResearchExport({ id: exportId, sessionId: session.id, format: input.format, storageKey: key, storageUrl: url });
  return { id: exportId, format: input.format, storageKey: key, storageUrl: url };
}
