---
"@nodaro/sdk": patch
---

`jobs.list()` — `ListJobsPage.data` documents what the endpoint has always been
free to do and now regularly does: a page may hold fewer than `limit` rows —
even none — and still carry a `next`. The server pages off the last row the
database returned, then drops the inner jobs of component-node runs from that
page, so a page whose rows were all component jobs comes back empty with a live
cursor. Page on `next`, never on `data.length`. JSDoc only; no runtime or type
change.
