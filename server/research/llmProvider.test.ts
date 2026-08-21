import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseResearchModel, GEMINI_RESEARCH_MODELS, invokeGroundedRecommendationResearch, invokeResearchLLM, providerAttemptsFromError } from "./llmProvider";

const originalFetch = global.fetch;
const originalApiKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  global.fetch = originalFetch;
  process.env.GEMINI_API_KEY = originalApiKey;
});

describe("Gemini research provider", () => {
  it("uses gemini-3.5-flash-lite with Gemini structured-output request shaping", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6 },
    }), { status: 200 })) as typeof fetch;

    expect(await chooseResearchModel()).toBe("gemini-3.5-flash-lite");
    await invokeResearchLLM({
      messages: [{ role: "system", content: "Return JSON." }, { role: "user", content: "Confirm connection." }],
      response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: { type: "object", properties: {}, additionalProperties: false } } },
    });

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(init.headers).toMatchObject({ "x-goog-api-key": "test-key" });
    expect(JSON.parse(init.body)).toMatchObject({
      systemInstruction: { parts: [{ text: "Return JSON." }] },
      contents: [{ role: "user", parts: [{ text: "Confirm connection." }] }],
      generationConfig: { responseMimeType: "application/json" },
    });
    expect(JSON.parse(init.body).generationConfig.responseSchema).not.toHaveProperty("additionalProperties");
  });

  it("uses gemini-3.1-flash-lite when the primary Gemini model is unavailable", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503, statusText: "Service Unavailable" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "fallback" }] }, finishReason: "STOP" }] }), { status: 200 })) as typeof fetch;

    const result = await invokeResearchLLM({ messages: [{ role: "user", content: "Continue research." }] });

    expect(result.model).toBe("gemini-3.1-flash-lite");
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toContain(GEMINI_RESEARCH_MODELS[1]);
  });

  it("emits the preserved-work sentinel if both requested Gemini models fail", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503, statusText: "Service Unavailable" }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503, statusText: "Service Unavailable" })) as typeof fetch;

    const failure = await invokeResearchLLM({ messages: [{ role: "user", content: "Continue research." }] }).catch(error => error);
    expect(failure).toHaveProperty("message", "AI_PROVIDERS_UNAVAILABLE");
    expect(providerAttemptsFromError(failure)).toEqual([
      { provider: "gemini", model: "gemini-3.5-flash-lite", outcome: "failed", errorClass: "http_503", httpStatus: 503 },
      { provider: "gemini", model: "gemini-3.1-flash-lite", outcome: "failed", errorClass: "http_503", httpStatus: 503 },
    ]);
  });

  it("uses Gemini Google Search grounding and retains citation sources for recommendation research", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: "{\"criteria\":[\"atmosphere\"],\"options\":[]}",
      steps: [{ type: "model_output", content: [{ type: "text", text: "{\"criteria\":[\"atmosphere\"],\"options\":[]}", annotations: [{ type: "url_citation", title: "Cafe guide", url: "https://example.org/cafes", start_index: 0, end_index: 20 }] }] }],
    }), { status: 200 })) as typeof fetch;

    const result = await invokeGroundedRecommendationResearch({ request: "Find aesthetic cafes in Jaipur." });

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(JSON.parse(init.body)).toMatchObject({ model: "gemini-3.5-flash-lite", tools: [{ type: "google_search" }] });
    expect(result.output).toContain("\"criteria\"");
    expect(result.sources).toEqual([expect.objectContaining({ title: "Cafe guide", url: "https://example.org/cafes" })]);
  });
});
