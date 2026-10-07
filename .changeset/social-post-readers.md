---
"@nodaro/shared": minor
---

Add the vocabulary of the Read Inspiration and Read Competitor nodes, which output posts the way Social Search does:

- `INSPIRATION_READ_NODE_TYPE`, `COMPETITOR_READ_NODE_TYPE`, `SOCIAL_POST_READER_NODE_TYPES` and `isSocialPostReaderNodeType`;
- the period a node reads, `SOCIAL_READ_PERIODS` (`window`: the last N hours or days; `day`: one calendar day, `SOCIAL_READ_DAY_PATTERN`), with `SOCIAL_READ_WINDOW_HOURS_MAX` (720) and `SOCIAL_READ_WINDOW_DAYS_MAX` (365);
- `SOCIAL_READ_LIMIT_MAX` (100) and `SOCIAL_READ_DEFAULT_LIMIT` (20) posts per run;
- `COMPETITOR_READ_ROLES`: a brand's own posts (`own`), the posts about it (`about`), or both (`all`).
