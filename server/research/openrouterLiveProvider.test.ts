import { describe, expect, it } from "vitest";
import { invokeOpenRouter } from "./llmProvider";

describe("OpenRouter live provider", () => {
  const runLiveTest = process.env.RUN_OPENROUTER_LIVE_TEST === "1";

  it.skipIf(!runLiveTest)("returns a structured response from a live OpenRouter model", async () => {
    const response = await invokeOpenRouter({
      model: "openai/gpt-5.4-nano",
      messages: [
        { role: "system", content: "Return only the requested JSON object." },
        { role: "user", content: "Confirm the provider connection." },
      ],
      max_tokens: 64,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "provider_connection",
          strict: true,
          schema: {
            type: "object",
            properties: { connected: { type: "boolean" } },
            required: ["connected"],
            additionalProperties: false,
          },
        },
      },
    });

    expect(JSON.parse(response.choices[0]?.message.content as string)).toEqual({ connected: true });
  }, 30_000);
});
