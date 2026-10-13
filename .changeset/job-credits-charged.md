---
"@nodaro/sdk": minor
---

`Job.credits_charged` (`client.jobs.get()` / `client.jobs.list()`): what a job actually cost once its credit hold settled. It can be lower than `credits` — the amount held when the job was accepted, which never changes — because some jobs hold more than they end up using and the rest goes back to the balance; it is `0` when the hold was refunded and `null` while the job is still running. Sum `credits_charged` to total spend. Additive.
