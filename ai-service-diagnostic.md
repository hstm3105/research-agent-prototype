# AI-Service Outage Diagnostic and Gemini Repair

## Observed Failure Sequence

The newest paused session, `tXCCh6hpti_F5Kur48H9G`, was persisted as `failed` at the **planning** phase with 8% lifecycle progress and the sentinel `AI_SERVICE_LIMIT`. It did not lose its user query or workspace state. A preceding historical session, `tOSXYbW2AXkjznzw_TEOy`, preserved the original built-in provider response: `412 Precondition Failed` with `your account has hit a usage exhausted`.

After OpenRouter was introduced, the adapter called OpenRouter first and then attempted the built-in provider. When both attempts failed, the code intentionally replaced their raw responses with `AI_PROVIDERS_UNAVAILABLE`, which the session layer stored as `AI_SERVICE_LIMIT`. This protected credentials and provider details, but made the combined outage non-actionable to the user and prevented retrospective recovery of the OpenRouter HTTP status because that detail was not persisted.

## Root Cause

The evidence confirms that the prior built-in provider was exhausted. The OpenRouter-first design still depended on that exhausted provider for fallback, and its original request path was not a reliable production recovery route. The public message was therefore correct—both available model paths had failed—but too generic to diagnose from the workspace alone.

## Repair

ResearchOS now uses the user-selected direct Gemini provider only. It sends structured requests to `models/gemini-3.5-flash-lite:generateContent` using `generationConfig.responseMimeType` and Gemini-compatible `responseSchema` rather than the incompatible `generationConfig.responseFormat` request that initially produced HTTP 400. `gemini-3.1-flash-lite` is attempted only if the primary model fails. The Gemini key was validated against the model catalog, a live structured-output request passed, and a live planning request produced the full structured two-step research plan.

If both Gemini model attempts fail, the application continues to preserve the user’s work and presents the existing non-technical recovery card without exposing API details.

## Durable Future Diagnostics

Research sessions now persist a server-only `providerDiagnosticsJson` record when both Gemini models fail. It contains only the provider name, model identifier, HTTP status or normalized error class, and failed fallback outcome. It never stores API keys, raw provider messages, prompts, or response bodies. The workspace continues to display the same concise preserved-work recovery message, while authorized server-side investigation can now reconstruct the exact Gemini failure sequence.
