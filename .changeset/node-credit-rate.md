---
"@nodaro/sdk": patch
---

Node descriptors carry a per-unit rate where a node is charged per unit of its own measure: `NodeDescriptor.creditRate` (`NodeCreditRate`: `identifier`, `unit`, `creditsPerUnit`, `minUnits`, `rounding: "ceil-run-total"`, `note`) on `client.nodes.list()` / `get()`. Speaker Frames is the first: its `creditCost` stays `"per-1000-frames"`, and `creditRate.creditsPerUnit` is the exact charged credits of one block of 1,000 sampled frames — a run is charged `ceil(blocks × creditsPerUnit)` once. Nothing to change in an existing app; the field is absent when talking to a server from before it, and on editions without credits.
