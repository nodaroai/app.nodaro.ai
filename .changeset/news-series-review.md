---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Review fixes for the Telegram feed and Collections series:

- `@nodaro/shared`: `planFeedEmission(posts, since, limit, pageMaxId?)` — when nothing readable lies above the position but the page rendered further (posts with neither text nor media), the position moves past them instead of re-reading the same page every tick; `COLLECTION_EVICT_MAX_PER_WRITE` (100) bounds how many records one write past the cap may evict.
- `@nodaro/prompts`: the empty-input skip rule decides on a node's CORE text — prompt pre/post text alone is not something to send — and `generate-image` joins `TEXT_REQUIRED_NODE_TYPES`: when the text it was wired produced nothing this run, an empty prompt is skipped rather than drawn.
