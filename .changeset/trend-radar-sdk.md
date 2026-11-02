---
"@nodaro/sdk": minor
---

Trend Radar: `client.trendRadar` (`@nodaro/sdk/trend-radar`) — the candidate trends the daily radar run found on Nodaro Cloud, and an admin's decisions on them: `summary()`, `candidates()`, `candidate(id)`, `approve(id)` (creates a draft trend), `watch(id)`, `reject(id, { reason })`, `settings()`, `updateSettings(patch)`, `run()`. Every method answers a signed-in admin session only; an API key or an app token gets `ForbiddenError`.
