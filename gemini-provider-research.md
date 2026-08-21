# Gemini Provider Integration Notes

Google’s Gemini REST documentation specifies `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with the server-side API key in the `x-goog-api-key` header. Structured output is configured through `generationConfig.responseFormat.text`, using `mimeType: "application/json"` and a JSON Schema. The production model catalog lists `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` as stable endpoints. ResearchOS will use the 3.5 Flash-Lite model first and the 3.1 Flash-Lite model only when the primary Gemini model is unavailable.

Sources: [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [Gemini models](https://ai.google.dev/gemini-api/docs/models), and [Gemini API changelog](https://ai.google.dev/gemini-api/docs/changelog).
