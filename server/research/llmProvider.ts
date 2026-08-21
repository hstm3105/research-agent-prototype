import { invokeLLM, listLLMModels, type InvokeParams, type InvokeResult } from "../_core/llm";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL_PREFERENCES = ["openai/gpt-5.5", "openai/gpt-5.4-mini", "openai/gpt-5.4-nano"];
const MODEL_CACHE_MS = 5 * 60 * 1000;

type OpenRouterModel = { id: string; supported_parameters?: string[] };
let cachedOpenRouterModel: { value: string; expiresAt: number } | null = null;

function openRouterApiKey() {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

function hasStructuredResponse(params: InvokeParams) {
  return params.response_format?.type === "json_schema" || params.responseFormat?.type === "json_schema" || Boolean(params.outputSchema || params.output_schema);
}

function responseFormatFor(params: InvokeParams) {
  if (params.response_format) return params.response_format;
  if (params.responseFormat) return params.responseFormat;
  const schema = params.outputSchema || params.output_schema;
  return schema ? { type: "json_schema" as const, json_schema: schema } : undefined;
}

export async function chooseResearchModel(): Promise<string | undefined> {
  const apiKey = openRouterApiKey();
  if (!apiKey) {
    const builtinModels = await listLLMModels();
    return builtinModels.data.find(model => model.id === "gpt-5")?.id
      ?? builtinModels.data.find(model => /sonnet|gpt-5/i.test(model.id))?.id
      ?? builtinModels.data[0]?.id;
  }

  if (cachedOpenRouterModel && cachedOpenRouterModel.expiresAt > Date.now()) return cachedOpenRouterModel.value;
  const response = await fetch(`${OPENROUTER_BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`OpenRouter model discovery failed: ${response.status} ${response.statusText}`);
  const payload = await response.json() as { data?: OpenRouterModel[] };
  const models = Array.isArray(payload.data) ? payload.data : [];
  const available = new Set(models.map(model => model.id));
  const preferred = OPENROUTER_MODEL_PREFERENCES.find(model => available.has(model));
  const structured = models.find(model => !model.id.includes(":batch") && model.supported_parameters?.includes("structured_outputs"))?.id;
  const selected = preferred ?? structured ?? models.find(model => !model.id.includes(":batch"))?.id;
  if (!selected) throw new Error("OpenRouter returned no available chat models");
  cachedOpenRouterModel = { value: selected, expiresAt: Date.now() + MODEL_CACHE_MS };
  return selected;
}

export async function invokeOpenRouter(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = openRouterApiKey();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  const model = params.model ?? await chooseResearchModel();
  const responseFormat = responseFormatFor(params);
  const payload: Record<string, unknown> = {
    model,
    messages: params.messages,
    ...(params.tools?.length ? { tools: params.tools } : {}),
    ...(params.toolChoice || params.tool_choice ? { tool_choice: params.toolChoice || params.tool_choice } : {}),
    ...(params.max_tokens ?? params.maxTokens ? { max_tokens: params.max_tokens ?? params.maxTokens } : {}),
    ...(params.thinking ? { thinking: params.thinking } : {}),
    ...(params.reasoning ? { reasoning: params.reasoning } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(hasStructuredResponse(params) ? { provider: { require_parameters: true } } : {}),
  };
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenRouter invoke failed: ${response.status} ${response.statusText} – ${detail}`);
  }
  return await response.json() as InvokeResult;
}

/** Uses OpenRouter as the primary research provider and retains Manus for resilience. */
export async function invokeResearchLLM(params: InvokeParams): Promise<InvokeResult> {
  if (!openRouterApiKey()) return invokeLLM(params);
  try {
    return await invokeOpenRouter(params);
  } catch (openRouterError) {
    try {
      return await invokeLLM(params);
    } catch {
      throw new Error("AI_PROVIDERS_UNAVAILABLE");
    }
  }
}

export function clearOpenRouterModelCacheForTests() {
  cachedOpenRouterModel = null;
}
