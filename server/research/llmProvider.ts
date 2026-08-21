import type { InvokeParams, InvokeResult, MessageContent, ResponseFormat } from "../_core/llm";
import { reserveProviderRequest } from "../db";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_RESEARCH_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"] as const;
export const GEMINI_SAFE_RPM = 10;
export const GEMINI_MIN_REQUEST_INTERVAL_MS = Math.ceil(60_000 / GEMINI_SAFE_RPM);
const GEMINI_MAX_QUEUE_WAIT_MS = 18_000;
const GEMINI_429_COOLDOWN_MS = 60_000;
const inMemoryProviderSchedule = new Map<string, number>();

export type GeminiProviderAttempt = {
  provider: "gemini";
  model: string;
  outcome: "failed";
  errorClass: string;
  httpStatus?: number;
};

export type GroundedRecommendationSource = {
  title: string;
  url: string;
  publisher: string | null;
  excerpt: string | null;
};

export class ResearchProviderUnavailableError extends Error {
  constructor(readonly attempts: GeminiProviderAttempt[]) {
    super("AI_PROVIDERS_UNAVAILABLE");
  }
}

export class GeminiRateLimitQueueError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("Gemini rate-limit queue is at capacity");
  }
}

function wait(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function isGemini429(error: unknown) {
  return /Gemini invoke failed:\s*429\b/i.test(error instanceof Error ? error.message : String(error ?? ""));
}

async function waitForGeminiRequestSlot(model: string) {
  const reservation = await reserveGeminiRequest({ providerKey: `gemini:${model}`, minIntervalMs: GEMINI_MIN_REQUEST_INTERVAL_MS, maxQueueWaitMs: GEMINI_MAX_QUEUE_WAIT_MS });
  if (reservation.accepted === false || reservation.delayMs > GEMINI_MAX_QUEUE_WAIT_MS) throw new GeminiRateLimitQueueError(reservation.delayMs);
  if (reservation.delayMs) await wait(reservation.delayMs);
}

async function applyGemini429Cooldown(model: string) {
  await reserveGeminiRequest({ providerKey: `gemini:${model}`, minIntervalMs: GEMINI_429_COOLDOWN_MS });
}

async function reserveGeminiRequest(input: { providerKey: string; minIntervalMs: number; maxQueueWaitMs?: number }) {
  try {
    return await reserveProviderRequest(input);
  } catch {
    const nowMs = Date.now();
    const scheduledAtMs = Math.max(nowMs, inMemoryProviderSchedule.get(input.providerKey) ?? 0);
    const delayMs = Math.max(0, scheduledAtMs - nowMs);
    if (input.maxQueueWaitMs !== undefined && delayMs > input.maxQueueWaitMs) return { scheduledAtMs, delayMs, accepted: false as const };
    inMemoryProviderSchedule.set(input.providerKey, scheduledAtMs + input.minIntervalMs);
    return { scheduledAtMs, delayMs, accepted: true as const };
  }
}

function geminiApiKey() {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

function textFromContent(content: MessageContent | MessageContent[]): string {
  const parts = Array.isArray(content) ? content : [content];
  return parts.map(part => typeof part === "string" ? part : part.type === "text" ? part.text : JSON.stringify(part)).join("\n");
}

function responseFormatFor(params: InvokeParams): ResponseFormat | undefined {
  if (params.response_format) return params.response_format;
  if (params.responseFormat) return params.responseFormat;
  const schema = params.outputSchema || params.output_schema;
  return schema ? { type: "json_schema", json_schema: schema } : undefined;
}

function toGeminiResponseSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toGeminiResponseSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "additionalProperties" && key !== "$schema")
      .map(([key, entry]) => [key, toGeminiResponseSchema(entry)])
  );
}

function toGeminiRequest(params: InvokeParams) {
  const systemText = params.messages.filter(message => message.role === "system").map(message => textFromContent(message.content)).join("\n\n");
  const contents = params.messages.filter(message => message.role !== "system").map(message => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: textFromContent(message.content) }],
  }));
  const responseFormat = responseFormatFor(params);
  const generationConfig: Record<string, unknown> = {
    ...(params.max_tokens ?? params.maxTokens ? { maxOutputTokens: params.max_tokens ?? params.maxTokens } : {}),
    ...(responseFormat?.type === "json_schema" ? {
      responseMimeType: "application/json",
      responseSchema: toGeminiResponseSchema(responseFormat.json_schema.schema),
    } : responseFormat?.type === "json_object" ? {
      responseMimeType: "application/json",
    } : {}),
  };

  return {
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    contents,
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  };
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
};

type GroundingAnnotation = { type?: string; url?: string; title?: string };
type GroundedInteractionResponse = {
  output_text?: string;
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; annotations?: GroundingAnnotation[] }> }>;
};

function groundedSourcesFromPayload(payload: GroundedInteractionResponse): GroundedRecommendationSource[] {
  const annotations = payload.steps?.flatMap(step => step.content?.flatMap(content => content.annotations ?? []) ?? []) ?? [];
  const byUrl = new Map<string, GroundedRecommendationSource>();
  for (const annotation of annotations) {
    if (annotation.type && annotation.type !== "url_citation") continue;
    if (!annotation.url || !/^https?:\/\//i.test(annotation.url)) continue;
    let publisher: string | null = null;
    try { publisher = new URL(annotation.url).hostname.replace(/^www\./, ""); } catch { /* invalid citations are ignored */ }
    byUrl.set(annotation.url, {
      title: (annotation.title || publisher || "Grounded web source").slice(0, 500),
      url: annotation.url,
      publisher,
      excerpt: "Gemini Google Search grounding citation retained for this recommendation brief.",
    });
  }
  return Array.from(byUrl.values());
}

export function renderGroundedRecommendationMarkdown(text: string, sources: GroundedRecommendationSource[]): string {
  const sourceList = sources.map(source => `- [${source.title}](${source.url})`).join("\n");
  return sourceList ? `${text.trim()}\n\n### Grounded sources\n${sourceList}` : text.trim();
}

export async function chooseResearchModel() {
  return GEMINI_RESEARCH_MODELS[0];
}

export async function invokeGemini(params: InvokeParams, model: string): Promise<InvokeResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  for (let attempt = 0; attempt < 1; attempt += 1) {
    await waitForGeminiRequestSlot(model);
    const response = await fetch(`${GEMINI_BASE_URL}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(toGeminiRequest(params)),
    });
    if (!response.ok) {
      const error = new Error(`Gemini invoke failed: ${response.status} ${response.statusText} – ${await response.text()}`);
      if (response.status === 429) {
        await applyGemini429Cooldown(model);
      }
      throw error;
    }
    const payload = await response.json() as GeminiResponse;
    const candidate = payload.candidates?.[0];
    const content = candidate?.content?.parts?.map(part => part.text ?? "").join("") || "";
    if (!content) throw new Error("Gemini returned an empty response");
    return {
      id: `gemini-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: candidate?.finishReason ?? "stop" }],
      usage: payload.usageMetadata ? {
        prompt_tokens: payload.usageMetadata.promptTokenCount ?? 0,
        completion_tokens: payload.usageMetadata.candidatesTokenCount ?? 0,
        total_tokens: payload.usageMetadata.totalTokenCount ?? 0,
      } : undefined,
    };
  }
  throw new Error("Gemini invoke failed");
}

/** Uses Gemini Google Search grounding to widen public-web evidence for local recommendations and shortlists. */
export async function invokeGroundedRecommendationResearch(input: { request: string }): Promise<{ output: string; sources: GroundedRecommendationSource[] }> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const attempts: GeminiProviderAttempt[] = [];
  for (const model of GEMINI_RESEARCH_MODELS) {
    try {
      for (let attempt = 0; attempt < 1; attempt += 1) {
        await waitForGeminiRequestSlot(model);
        const response = await fetch(`${GEMINI_BASE_URL}/interactions`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ model, input: input.request, tools: [{ type: "google_search" }] }),
        });
        if (!response.ok) {
          const error = new Error(`Gemini invoke failed: ${response.status} ${response.statusText} – ${await response.text()}`);
          if (response.status === 429) {
            await applyGemini429Cooldown(model);
          }
          throw error;
        }
        const payload = await response.json() as GroundedInteractionResponse;
        const rawOutput = payload.output_text || payload.steps?.flatMap(step => step.content ?? []).filter(content => content.type === "text").map(content => content.text || "").join("\n") || "";
        if (!rawOutput.trim()) throw new Error("Gemini returned an empty grounded response");
        const sources = groundedSourcesFromPayload(payload);
        return { output: rawOutput.trim(), sources };
      }
    } catch (error) {
      attempts.push(toAttempt(model, error));
      if (isGemini429(error) || error instanceof GeminiRateLimitQueueError) break;
    }
  }
  throw new ResearchProviderUnavailableError(attempts);
}

function toAttempt(model: string, error: unknown): GeminiProviderAttempt {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const statusMatch = message.match(/Gemini invoke failed:\s*(\d{3})/i);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;
  return {
    provider: "gemini",
    model,
    outcome: "failed",
    errorClass: httpStatus ? `http_${httpStatus}` : /empty response/i.test(message) ? "empty_response" : "network_or_runtime_error",
    ...(httpStatus ? { httpStatus } : {}),
  };
}

export function providerAttemptsFromError(error: unknown): GeminiProviderAttempt[] {
  return error instanceof ResearchProviderUnavailableError ? error.attempts : [];
}

/** Uses the requested Gemini Flash-Lite models only, with ordered model fallback. */
export async function invokeResearchLLM(params: InvokeParams): Promise<InvokeResult> {
  const attempts: GeminiProviderAttempt[] = [];
  for (const model of GEMINI_RESEARCH_MODELS) {
    try {
      return await invokeGemini({ ...params, model }, model);
    } catch (error) {
      attempts.push(toAttempt(model, error));
      if (isGemini429(error) || error instanceof GeminiRateLimitQueueError) break;
      // The secondary Gemini model is a purposeful fallback for non-rate-limit provider failures.
    }
  }
  throw new ResearchProviderUnavailableError(attempts);
}
