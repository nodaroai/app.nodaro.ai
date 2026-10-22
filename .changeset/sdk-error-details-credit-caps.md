---
"@nodaro/sdk": minor
---

Errors keep more of the server's answer. Every `NodaroError` now carries `details`: the error envelope's fields other than `code` and `message`, as sent (a trend refusal's `slot`, a publish refusal's `reasons`, a validation error's `issues`, …), so a caller can act on them without an SDK release.

A 402 keeps its own code (a behaviour change). `InsufficientCreditsError.code` now carries the server's code — the 402 envelope's `error.code` — instead of always `insufficient_credits` (for example `free_video_limit`, `insufficient_app_credits`), and a spending cap someone else set — `budget_exceeded` (a workspace's budget), `member_cap_exceeded` (your cap in a workspace), `user_allowance_exceeded` (a deployment's per-user allowance) — is the new `CreditCapExceededError`, a subclass of `InsufficientCreditsError` (so existing `instanceof` catches still catch it). `CREDIT_CAP_CODES` and the `CreditCapCode` type are exported. An allowance's `remaining` is read as `available`. Code that compared `err.code === "insufficient_credits"` to mean "any 402" should check `err instanceof InsufficientCreditsError` instead.
