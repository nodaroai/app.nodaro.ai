---
"@nodaro/sdk": patch
---

`client.trends.estimate()` / `run()` document `409 trend_unavailable`: the trend's setup is out of date, so it cannot run until it is updated and a retry gets the same answer (it was a `503`). It arrives as a `NodaroError` with `status` 409 and `code` `"trend_unavailable"`.
