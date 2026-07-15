---
"@nodaro/shared": minor
---

New `LLM_TEXT_INPUT_MAX` (100,000) — the input ceiling for LLM text-generation nodes (Generate Text / llm-chat, AI Writer, Generate Script). Their `systemPrompt` / `userInput` / `prompt` fields were capped at a flat 10,000 chars, which falsely blocked pasting a long document to summarize or rewrite; LLM contexts are far larger (Claude 200K / GPT 128K+ / Gemini 1M tokens), so the routes now accept up to 100K input chars (output stays bounded by each route's `maxTokens`).
