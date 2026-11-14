---
"@nodaro/shared": patch
---

GPT-6.1 Terra's registry notes: the input its aggregator adds to every call is now counted at the ceiling it has been seen at, the same with or without an effort, so the model stays priced the same at every effort (not `effortPriced`). No API change.
