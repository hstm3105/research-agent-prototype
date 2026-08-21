import { describe, expect, it } from "vitest";
import { getResearchSessionForUser } from "../db";
import { runResearchSession } from "./agent";

describe("Gemini live synthesis repair", () => {
  const sessionId = process.env.LIVE_GEMINI_SYNTHESIS_SESSION_ID;
  const userId = Number(process.env.LIVE_GEMINI_RESUME_USER_ID);
  const runLiveTest = process.env.RUN_GEMINI_LIVE_TEST === "1" && Boolean(sessionId) && Number.isInteger(userId);

  it.skipIf(!runLiveTest)("persists a substantive final answer for a source-rich completed plan", async () => {
    await runResearchSession({ sessionId: sessionId!, userId, emit: () => undefined });

    const session = await getResearchSessionForUser(sessionId!, userId);
    expect(session?.status).toBe("complete");
    expect(session?.finalOutput).toContain("## Answer");
    expect(session?.finalOutput?.length).toBeGreaterThan(180);
  }, 90_000);
});
