import { describe, expect, it } from "vitest";
import { invokeGemini } from "./llmProvider";

describe("Gemini live provider", () => {
  const runLiveTest = process.env.RUN_GEMINI_LIVE_TEST === "1";

  it.skipIf(!runLiveTest)("returns structured JSON from gemini-3.5-flash-lite", async () => {
    const response = await invokeGemini({
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
    }, "gemini-3.5-flash-lite");

    expect(JSON.parse(response.choices[0]?.message.content as string)).toEqual({ connected: true });
  }, 30_000);
});
