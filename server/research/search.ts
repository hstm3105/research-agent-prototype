import { callDataApi } from "../_core/dataApi";
import { ENV } from "../_core/env";
import type { NormalizedSearchSource } from "./types";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asUrl(value: unknown): string | null {
  const candidate = textOf(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function findResultArrays(value: unknown, depth = 0): RecordValue[][] {
  if (depth > 4 || !isRecord(value)) return [];
  const arrays: RecordValue[][] = [];
  for (const [key, child] of Object.entries(value)) {
    if (!Array.isArray(child)) {
      arrays.push(...findResultArrays(child, depth + 1));
      continue;
    }
    const records = child.filter(isRecord);
    if (records.length && /result|item|organic|web|article|news|value/i.test(key)) arrays.push(records);
  }
  return arrays;
}

export function normalizeSearchPayload(payload: unknown): NormalizedSearchSource[] {
  const retrievedAt = new Date();
  const contentItems = isRecord(payload) && Array.isArray(payload.contents) ? payload.contents.filter(isRecord) : [];
  const videoSources = contentItems.flatMap(item => {
    const video = isRecord(item.video) ? item.video : null;
    if (!video) return [];
    const videoId = textOf(video.videoId);
    if (!videoId) return [];
    const author = isRecord(video.author) ? video.author : null;
    return [{
      title: textOf(video.title) ?? "Untitled video source",
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      publisher: textOf(author?.title) ?? "YouTube",
      excerpt: textOf(video.descriptionSnippet),
      retrievedAt,
    }];
  });
  if (videoSources.length) return videoSources.slice(0, 8);

  const arrays = findResultArrays(payload);
  const seen = new Set<string>();
  const sources: NormalizedSearchSource[] = [];
  for (const record of arrays.flat()) {
    const url = asUrl(record.url ?? record.link ?? record.href ?? record.website ?? record.sourceUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const publisher = textOf(record.publisher ?? record.source ?? record.siteName ?? record.domain) ?? (() => {
      try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
    })();
    sources.push({
      title: textOf(record.title ?? record.name ?? record.headline) ?? publisher ?? "Untitled source",
      url,
      publisher,
      excerpt: textOf(record.snippet ?? record.description ?? record.content ?? record.text ?? record.highlight),
      retrievedAt,
    });
  }
  return sources.slice(0, 8);
}

type TavilySearchResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    raw_content?: string;
  }>;
};

function publisherFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Public web";
  }
}

export async function searchTavilyWeb(query: string): Promise<NormalizedSearchSource[]> {
  if (!ENV.tavilyApiKey) throw new Error("Tavily search is not configured");
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ENV.tavilyApiKey}` },
    body: JSON.stringify({
      query,
      topic: "general",
      search_depth: "basic",
      max_results: 8,
      include_answer: false,
      include_raw_content: false,
    }),
  });
  if (!response.ok) throw new Error(`Tavily search failed with HTTP ${response.status}`);
  const payload = await response.json() as TavilySearchResponse;
  const seen = new Set<string>();
  const retrievedAt = new Date();
  return (payload.results ?? []).flatMap(result => {
    const url = asUrl(result.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const excerpt = textOf(result.content) ?? textOf(result.raw_content);
    return [{
      title: textOf(result.title) ?? publisherFromUrl(url),
      url,
      publisher: publisherFromUrl(url),
      excerpt,
      retrievedAt,
    }];
  }).slice(0, 8);
}

export async function searchPublicWeb(query: string): Promise<NormalizedSearchSource[]> {
  try {
    const tavilySources = await searchTavilyWeb(query);
    if (tavilySources.length) return tavilySources;
  } catch {
    // Retain the pre-existing public video adapter only as a bounded backup when the general-web provider is unavailable.
  }
  const payload = await callDataApi("Youtube/search", { query: { q: query } });
  return normalizeSearchPayload(payload);
}
