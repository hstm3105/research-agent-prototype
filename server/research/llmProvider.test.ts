import { afterEach, describe, expect, it, vi } from "vitest";

const builtin = vi.hoisted(() => ({ invokeLLM: vi.fn(), listLLMModels: vi.fn() }));
vi.mock("../_core/llm", () => builtin);

import { chooseResearchModel, clearOpenRouterModelCacheForTests, invokeResearchLLM } from "./llmProvider";

const originalFetch = global.fetch;
const originalApiKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  global.fetch = originalFetch;
  process.env.OPENROUTER_API_KEY = originalApiKey;
  builtin.invokeLLM.mockReset();
  builtin.listLLMModels.mockReset();
  clearOpenRouterModelCacheForTests();
});

describe("OpenRouter research provider", () => {
  it("selects a current preferred model and requires structured-output support for schema calls", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "openai/gpt-5.5", supported_parameters: ["structured_outputs"] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "chat-1", created: 1, model: "openai/gpt-5.5", choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] }), { status: 200 })) as typeof fetch;

    expect(await chooseResearchModel()).toBe("openai/gpt-5.5");
    await invokeResearchLLM({ model: "openai/gpt-5.5", messages: [{ role: "system", content: "Return JSON." }], response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: { type: "object", properties: {}, additionalProperties: false } } } });

    const request = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(request[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(request[1].body)).toMatchObject({ model: "openai/gpt-5.5", provider: { require_parameters: true }, response_format: { type: "json_schema" } });
  });

  it("falls back to the built-in provider if the OpenRouter request is unavailable", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    global.fetch = vi.fn().mockResolvedValue(new Response("maintenance", { status: 503, statusText: "Service Unavailable" })) as typeof fetch;
    builtin.invokeLLM.mockResolvedValue({ id: "builtin-1", created: 1, model: "gpt-5", choices: [{ index: 0, message: { role: "assistant", content: "fallback" }, finish_reason: "stop" }] });

    const result = await invokeResearchLLM({ model: "openai/gpt-5.5", messages: [{ role: "user", content: "Continue research." }] });

    expect(result.choices[0].message.content).toBe("fallback");
    expect(builtin.invokeLLM).toHaveBeenCalledOnce();
  });

  it("uses a sentinel rather than raw provider errors when neither provider is available", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    global.fetch = vi.fn().mockResolvedValue(new Response("maintenance", { status: 503, statusText: "Service Unavailable" })) as typeof fetch;
    builtin.invokeLLM.mockRejectedValue(new Error("Built-in provider internal detail"));

    await expect(invokeResearchLLM({ model: "openai/gpt-5.5", messages: [{ role: "user", content: "Continue research." }] })).rejects.toThrow("AI_PROVIDERS_UNAVAILABLE");
  });
});
