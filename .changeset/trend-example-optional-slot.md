---
"@nodaro/sdk": patch
---

Trends: document that an example may have no pictures for an optional slot (no key in `TrendExample.slots`). A run that leaves that slot empty with that example keeps it as in the original (`fromExample: false`) instead of being refused with `missing_slot`.
