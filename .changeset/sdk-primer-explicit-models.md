---
"@nodaro/sdk": patch
---

README overhaul for agent-first onboarding: "LLM quick start" moved directly after the server quick start and split into a **universal primer** (reusable in any project; also published raw as `sdk-agent-primer.txt` with `curl | pbcopy` one-liners) and a separate **example project brief** ("animated postcard" — image shown immediately, live % progress via `onProgress`, cancel via `AbortSignal`). The primer names recommended models (`nano-banana-2`, `seedance-2-fast` @ 4s — the platform default) and links full model lists + runtime discovery. New "Connect via MCP" section with per-client connect badges, the Claude Code one-liner, and the MCP-delivered Skills (Film Director / Video Director). Credential cells now deep-link `app.nodaro.ai/settings/api` and `/settings/developer-apps`.
