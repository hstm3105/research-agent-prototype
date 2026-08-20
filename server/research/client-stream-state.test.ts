import { describe, expect, it } from "vitest";
import { applyClarificationTransition, beginClarificationResume } from "../../client/src/lib/researchStreamState";

describe("active research workspace stream state", () => {
  it("exposes a streamed clarification immediately without waiting for session reload", () => {
    const transition = applyClarificationTransition({ clarification: null, message: null, activities: [] }, "Which jurisdiction applies?", 100);

    expect(transition.clarification).toEqual({ question: "Which jurisdiction applies?" });
    expect(transition.message).toContain("one decision");
    expect(transition.activities[0]).toMatchObject({ phase: "planning", progress: 20 });
    expect(transition.shouldInvalidateSession).toBe(true);
    expect(transition.shouldCloseStream).toBe(true);
  });

  it("clears active clarification state and reopens research after a successful submission", () => {
    const transition = beginClarificationResume({ clarification: { question: "Which jurisdiction applies?" }, message: "The agent needs one decision before continuing.", activities: [] }, 200);

    expect(transition.clarification).toBeNull();
    expect(transition.message).toContain("Resuming");
    expect(transition.shouldInvalidateSession).toBe(true);
    expect(transition.shouldOpenStream).toBe(true);
  });
});
