import { describe, expect, it } from "vitest";
import { getResearchSessionForUser } from "../db";
import { runResearchSession } from "./agent";

describe("Gemini live research resume", () => {
  const sessionId = process.env.LIVE_GEMINI_RESUME_SESSION_ID;
  const userId = Number(process.env.LIVE_GEMINI_RESUME_USER_ID);
  const runLiveTest = process.env.RUN_GEMINI_LIVE_TEST === "1" && Boolean(sessionId) && Number.isInteger(userId);

  it.skipIf(!runLiveTest)("advances a preserved session beyond planning into evidence execution", async () => {
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    await runResearchSession({
      sessionId: sessionId!,
      userId,
      emit: event => events.push(event),
    });

    const session = await getResearchSessionForUser(sessionId!, userId);
    expect(events.some(event => event.type === "step" && ["active", "complete", "skipped"].includes(String(event.status)))).toBe(true);
    expect(events.some(event => event.type === "source" || event.type === "finding" || event.type === "complete")).toBe(true);
    expect(events.some(event => event.type === "failure")).toBe(false);
    expect(session?.status).toBe("complete");
  }, 120_000);
});
