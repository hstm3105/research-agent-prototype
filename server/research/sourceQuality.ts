export type SourceQuality = {
  score: number;
  label: "High evidence signal" | "Useful context" | "Limited signals";
  signals: string[];
};

type QualitySource = {
  title: string;
  url: string;
  publisher: string | null;
  excerpt: string | null;
};

const primaryEvidenceHosts = new Set([
  "who.int", "oecd.org", "worldbank.org", "imf.org", "un.org", "europa.eu", "gov.uk", "nih.gov", "nasa.gov", "arxiv.org",
]);

const establishedPublisherHosts = new Set([
  "reuters.com", "apnews.com", "bbc.com", "nature.com", "science.org", "nytimes.com", "ft.com", "economist.com", "youtube.com",
]);

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function queryTokens(query: string) {
  return Array.from(new Set(query.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])).slice(0, 12);
}

/**
 * Produces an explainable retrieval-quality heuristic from available source metadata.
 * It is a prioritization aid, not a claim that a source is factually correct.
 */
export function scoreResearchSource(source: QualitySource, searchQuery: string, citationCount = 0): SourceQuality {
  const signals: string[] = [];
  const host = domainOf(source.url);
  let score = 0;

  if (host) score += 6;
  if (source.publisher?.trim()) {
    score += 10;
    signals.push("Named publisher");
  }
  if (source.title.trim().length >= 16) score += 5;
  if (source.excerpt?.trim()) {
    score += source.excerpt.trim().length >= 90 ? 14 : 6;
    signals.push(source.excerpt.trim().length >= 90 ? "Substantive excerpt" : "Source excerpt");
  }

  if (/\.(gov|edu|ac\.[a-z]{2,})$/i.test(host) || primaryEvidenceHosts.has(host)) {
    score += 28;
    signals.push("Primary or institutional domain");
  } else if (establishedPublisherHosts.has(host)) {
    score += 14;
    signals.push("Recognized publisher domain");
  }

  const searchableText = `${source.title} ${source.publisher ?? ""} ${source.excerpt ?? ""}`.toLowerCase();
  const matchedTerms = queryTokens(searchQuery).filter(token => searchableText.includes(token));
  if (matchedTerms.length) {
    score += Math.min(18, matchedTerms.length * 6);
    signals.push(`${matchedTerms.length} query term${matchedTerms.length === 1 ? "" : "s"} matched`);
  }

  if (citationCount > 0) {
    score += Math.min(19, citationCount * 8);
    signals.push(`Cited by ${citationCount} finding${citationCount === 1 ? "" : "s"}`);
  }

  const normalized = Math.min(100, score);
  return {
    score: normalized,
    label: normalized >= 70 ? "High evidence signal" : normalized >= 45 ? "Useful context" : "Limited signals",
    signals,
  };
}
