---
"@nodaro/sdk": minor
---

Trends: support trends that hide their original clip. On such a trend, `TrendCard.original` and `TrendDetail.original` are the trend's first example, `examples` starts from its second example, and the original clip is never sent. A run's `example` (`TrendRunRequest.example`, `TrendRun.example`) numbers the examples as the trend page lists them; `TrendRun.example` is now optional, absent when a run of such a trend used the example shown as its original.
