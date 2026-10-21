---
"@nodaro/sdk": minor
---

`JobErrorHint` gains a third arm, `CreditsHint` (`{ kind: "credits", code }`, exported): a job that ran out of credits partway — a step that reserves its own credits, such as the video a Cast Swap or trend run dispatches, was refused — carries it on `error_hint`. The job is refunded; `code` is the refusal's code (`insufficient_credits`, or a plan or workspace cap such as `free_video_limit`). A trend run's `error.code` is then `credits`. Code that narrows `JobErrorHint` with a two-way `if`/`else` should check `kind` explicitly.
