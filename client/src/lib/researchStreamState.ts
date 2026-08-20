export type ResearchActivity = { phase: string; message: string; progress: number; timestamp: number };
export type StreamUiState = {
  clarification: { question: string } | null;
  message: string | null;
  activities: ResearchActivity[];
};

export function appendResearchActivity(activities: ResearchActivity[], activity: Omit<ResearchActivity, "timestamp">, timestamp = Date.now()) {
  return [...activities, { ...activity, timestamp }].slice(-8);
}

export function applyClarificationTransition(state: StreamUiState, question: string, timestamp = Date.now()) {
  return {
    clarification: { question },
    message: "The agent needs one decision before continuing.",
    activities: appendResearchActivity(state.activities, { phase: "planning", message: "One material decision is needed before continuing research.", progress: 20 }, timestamp),
    shouldInvalidateSession: true,
    shouldCloseStream: true,
  };
}

export function beginClarificationResume(state: StreamUiState, timestamp = Date.now()) {
  return {
    clarification: null,
    message: "Clarification saved. Resuming the research plan.",
    activities: appendResearchActivity(state.activities, { phase: "planning", message: "Clarification saved. Resuming the research plan.", progress: 22 }, timestamp),
    shouldInvalidateSession: true,
    shouldOpenStream: true,
  };
}
