---
"@nodaro/client": minor
---

Add `client.collect.run(...)` for programmatically running the Collect fan-in node — pick the best of N generations, concatenate survivors, majority-vote, merge JSON, etc. Mirrors the new MCP `collect` tool. Six strategies: `pick-best-llm`, `concat`, `first-non-empty`, `count`, `vote`, `merge-json`.
