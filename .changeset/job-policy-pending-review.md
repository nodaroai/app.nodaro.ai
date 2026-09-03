---
"@nodaro/sdk": minor
"@nodaro/shared": patch
"@nodaro/cli": patch
---

`pending_review` — a job a deployment's job policy held for human review.

**`@nodaro/sdk`**

- `JobStatus` gains `"pending_review"`. It is **in-flight, not terminal**: the
  output exists, the credit reservation stays `"reserved"`, and a human decides
  whether it is released. It resolves to `completed` (approved), `failed`
  (rejected) or `cancelled`. Only appears on deployments that register a job
  policy. A `switch` over `JobStatus` that must stay exhaustive needs a new arm.
- `JobErrorHint` becomes a **discriminated union** on `kind`:
  `SafetyBlockHint` (`kind: "safety-block"` — the provider's own filter, the
  previous single shape, unchanged) `| PolicyBlockHint` (`kind: "policy-block"`,
  carrying `policyId`, a user-safe `reason` and `hookPoint: "request" | "result"`).
  Code that read `error_hint.class` without first narrowing on `kind` now needs
  the check. `JobErrorHint`, `SafetyBlockHint`, `PolicyBlockHint` and
  `CreditStatus` are exported by name for the first time — they were reachable
  from `Job` / `JobStatusResult` but not nameable, so narrowing or annotating
  against them was impossible.
- New `JobHeldError` (`code: "job_held"`, `status: 0`, carries `jobId`).
  `nodes.runAndWait` / `nodes.runMany` throw it on the **first** `pending_review`
  tick instead of polling out `maxMs` (~15 min by default) and then reporting a
  `JobTimeoutError` that misdescribes what happened. It does **not** cancel the
  job — re-fetch with `jobs.get(jobId)` later, or surface "awaiting review" and
  poll `jobs.getStatus()` yourself. Do not re-run the request: a duplicate would
  be held too.
- New `JobBlockedError` (`code: "job_blocked"`, `status: 422`), thrown by
  `throwFromResponse` when a job policy refuses a request before it runs — no
  job created, nothing reserved, nothing charged. Selected by `code`, so any
  other 422 stays a plain `NodaroError`. `message` is the policy's user-safe
  text; show it as-is.

**`@nodaro/shared`**

`EXECUTION_DATA_KEYS` and `TRANSIENT_RUNTIME_KEYS` both gain
`jobAwaitingReview` — the editor's per-tick "this node's result is under
review" flag. Transient, so a flip into review neither marks a passive tab
dirty nor is captured by a node preset or the save payload.

**`@nodaro/cli`**

`--watch` stops on `pending_review`, prints
`awaiting review (a human decision is pending; not a failure)` and exits **3**
(documented beside 0 / 2 / 130 in `docs/cli.md`) instead of polling until the
process is killed. As with `failed` and `cancelled`, `--json` prints the
payload and returns rather than setting the exit code.
