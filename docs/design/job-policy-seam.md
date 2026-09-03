# Job Policy Seam — Design Note

**Date:** 2026-09-03
**Status:** Implemented

## Summary

Some deployments must judge what they generate. Not "filter the picker" (that is
the [catalog pack seam](./catalog-pack-seam.md)) and not "fold a clause into every
prompt" (that is the prompt policy, `docs/deployment.md`), but: *decide whether
this generation may run at all, and whether its output may be published.*

The **job policy seam** makes that decision a registration. A deployment
registers one policy object at its composition root; the platform asks it at two
chokepoints in a job's life and applies the verdict itself — including the money
and the storage consequences, which a deployment must not have to re-implement
and must not be able to get wrong.

With **no** policy registered the platform is byte-identical to stock: the
funnels return allow before calling anything and before writing anything, so an
install that does not use the seam does not even acquire the audit table as a
dependency.

## The two hook points

Everything the platform generates is a **job** row. Two moments matter, and they
matter for different reasons.

| | **Request** | **Result** |
|---|---|---|
| Chokepoint | `lib/insert-job.ts` — the single funnel every job-creating route, orchestrator node, pipeline stage and plugin passes through | the completion funnels: `workers/shared.ts :: markJobCompleted` and `lib/job-finalize.ts :: finalizeJobWithMedia` |
| Asked | before the row exists and before credits are reserved | after the output is written to storage, before the completion write, the asset row and the credit commit |
| Verdicts | `allow`, `block` | `allow`, `flag`, `block`, `hold` |
| Why here | a block leaves **nothing** to unwind: no row, no reservation, no queue entry, no refund | the last moment at which nothing is published — the asset row, the gallery, `output_data` and every downstream node read what happens after this point |

Choosing the *insert* funnel rather than worker pickup is the load-bearing
decision on the request side. At pickup a row already exists and a reservation
has already been taken, so every block becomes a refund, a status transition and
a queue entry to clean up — three chances to be wrong about money. At insert the
answer is a 422 and an absence.

**What the request gate can see is stated, not hidden.** Jobs created by a
route, the MCP server, the SDK, the CLI or the browser extension — and the
children a pipeline stage creates — arrive at the funnel with their full input,
so the request gate can judge content. Jobs a workflow run or an app run creates
for its nodes do not: the orchestrator inserts a provenance-only row (`{ type,
node_id }` plus the provenance columns) and attaches the real payload in a
separate update after the insert. For those the request gate can gate by user,
source, node type or rate, but it **cannot judge content** — `inputData` in the
request context is documented as "may be a placeholder for orchestrated
children; check `workflowExecutionId`". The result gate is the enforcement
point for orchestrated jobs, which is exactly why it is fail-closed too.

Both funnels are covered by totality tests that fail the build if a new job
insert, completion or failure write is added outside them — the same discipline
the prompt-policy and upload-policy totality tests apply to their own coverage.

## The policy object

One registration, two optional checks, mirroring the upload-policy registry:

```ts
interface JobPolicy {
  readonly id: string
  checkRequest?(ctx: JobRequestContext): JobRequestVerdict | Promise<JobRequestVerdict>
  checkResult?(ctx: JobResultContext): JobResultVerdict | Promise<JobResultVerdict>
}

type JobRequestVerdict =
  | { verdict: "allow" }
  | { verdict: "block"; reason: string; userMessage?: string }

type JobResultVerdict =
  | { verdict: "allow" }
  | { verdict: "flag";  reason: string; labels?: readonly string[] }
  | { verdict: "block"; reason: string; userMessage?: string }
  | { verdict: "hold";  reason: string }
```

A block carries **two** strings on purpose. `reason` is machine text and goes
to the audit row; `userMessage` (defaulting to `reason`) is what the user sees
— in the 422 body and in `error_hint.reason`. A moderation label that reads
like a classifier's output must never be the sentence a person is shown.

The result context hands the policy `outputs[]` — every `http(s)` URL found in
the job's `output_data`, each with the storage key when the object is the
platform's own — plus `mediaKind`, `holdEligible` (below) and which funnel is
asking. A policy never re-implements URL extraction, and a media job that
arrives with zero outputs is visible as such, so a policy can fail closed on
"media kind, nothing to inspect".

Three policy ids are reserved and `registerJobPolicy` throws on them: `*` (an
`allow` every registered policy agreed to), `platform` (a fail-closed
resolution or a hold expiry) and `review` (an admin's decision).

**Ordering.** With several policies registered the request gate is asked in
registration order and the first `block` wins. The result gate asks **every**
policy — an audit wants each one's opinion — and combines by severity
`block > hold > flag > allow`, short-circuiting only on `block`, so a later
`flag` can never soften an earlier `hold`.

## Verdicts, and what the platform does with them

| Verdict | Job | Credits | Storage | Caller |
|---|---|---|---|---|
| `allow` | — | — | — | — |
| `block` (request) | no row created | no reservation taken | nothing written | `422 { error: { code: "job_blocked", message } }`; an internal creator gets a typed error it must handle |
| `flag` (result) | completes; nothing is written on the job row | commits | publishes | nothing withheld; the annotation lives only in the audit row |
| `block` (result) | `failed`, `error_hint = { kind: "policy-block", policyId, reason, hookPoint }` | refunded in full | the produced object is deleted | the failure, with a user-safe reason |
| `hold` (result) | `pending_review` | stay reserved | written, not published | "awaiting review"; the job stays in flight |

`pending_review` is a job status in the **in-flight** set: waiters keep waiting,
and it is exempt from the reconcile, timeout and cancel-in-flight sweeps. Its
resolution is a decision — approve puts the job back on the normal completion
path (nothing about the output differs from a job that was never held), reject
fails it with a refund, and the **owner's own cancel wins**: a held job is
cancellable like any in-flight job, and cancelling refunds the reservation and
deletes the withheld object, so a reservation is never stranded behind a
reviewer's response time.

**Who may be held.** `hold` is honoured only where the platform can replay the
completion later: a job completing through the finalize funnel, standing on its
own (no workflow execution, pipeline or parent job; not the director lane), on
an edition that has an admin surface to review it. The platform computes this
`holdEligible` flag itself and hands it to the policy. A `hold` on any other job
is applied as a `block` and recorded with `hold_downgraded = true` — never
quietly softened to `flag`, so the audit stays honest. The reason is mechanical:
the finalize funnel's post-completion tail (gallery asset, execution reopen,
reference-video attach) is extracted and replayable; the many direct completion
callers each run bespoke side effects after their completion write that an
approve hours later cannot reproduce. Widening eligibility is a config change
once those callers are made replayable, and is a named follow-up.

Why `block` deletes the object rather than leaving it unreferenced: outputs live
in a public-read bucket at keys derived from the job id with a long immutable
cache. An unreferenced object at such a key is not withheld — it is unlisted and
permanently fetchable. Deleting removes future reach. **It does not revoke a copy
an edge already served**, which is the honest limit of a post-generation gate on
this storage posture; deferred publication (a private staging key, copied to the
public key on allow) is the fix and is not built. Deletion is by the job's own
key family, never by URL: `output_data` routinely echoes the user's *input*
URLs, and a URL-driven delete would destroy them.

The same limit applies to `hold`: a held job's output is **unlisted, not
unreachable**. The job row's `output_data` stays NULL, the held payload lives in
columns no client-facing query can read, and a reviewer sees the media by
streaming it through the admin route — never through a public URL — but the
object itself sits at its deterministic key until approve or reject.

## Fail-closed

Once a policy is registered, an observer error is never a publish. The request
gate **blocks**; the result gate **holds** when the job is hold-eligible and
**blocks** otherwise. Both are recorded with `policy_id = "platform"` and
`reason = "policy-unavailable"`, and the user sees a platform-owned sentence
("Generation could not be verified") — never a policy's own wording, so an
outage cannot read as a judgement about someone's prompt. The platform adds no
timeout of its own around a check; it applies only a 120-second backstop that
resolves to this same path rather than throwing, so a deployment's own
error-handling stance inside its check stays reachable. A deployment that
prefers availability over enforcement catches inside its own check and returns
allow — the same escape hatch the upload policy documents, and deliberately not
an environment variable: it is a decision about what the product is.

## Asked once per payload

Every decision — `allow` included — is written to `job_policy_decisions`
(`job_id`, `hook_point`, `policy_id`, `verdict`, `reason`, `labels`,
`payload_hash`, `applied`, `hold_downgraded`, `created_at`, plus the resolver
on review rows), and a verdict already recorded for
`(job_id, hook_point, payload_hash)` is **never re-asked**. That is
what makes the seam safe under the two things that legitimately re-run a job:
the queue's own stall retries and the reconcile cron, both of which re-derive
the same `output_data` from the same provider result.

Re-asking and re-applying are different things. An `allow` or `flag` hit is
simply returned, and costs not even a row read. A `block` or `hold` hit reads
the job row once: if the job has already reached the verdict's outcome — failed,
cancelled, completed, or parked for review — the stored verdict is returned and
nothing is written. If the job is somehow still running, the **stored** verdict
is applied to it now, through the same compare-and-set as a fresh one. That case
exists because the decision is recorded before it is carried out: a process that
dies in between, or a database that refuses the write, would otherwise leave a
job that a policy has judged but nothing ever acted on — running forever with
its credits held. The policy is still asked only once, and only the first
recording is kept. Recording `allow` is not
bookkeeping — it *is* the idempotency key; without it every retry re-asks the
deployment's gate, and a gate that costs money or rate-limits would be asked an
unbounded number of times for one job. An `allow` row is written at a hook point
only when some registered policy implements that hook, so a policy that checks
results alone does not leave one dead request row per generation.

`payload_hash` is over the gated content, not over the row: `output_data` at
the result gate, `{ jobType, userId, inputData }` at the request gate. Two
genuinely different payloads on the same job are two decisions; an incidental
column change is not a re-gate.

The guarantee is asymmetric, and deliberately so. At the result gate there is a
job id to key on and a produced output that a retry would re-judge identically —
so a recorded verdict is reused. At the request gate a block has no row at all
(`job_id` is NULL on that audit row) and an allow can only be recorded once the
insert has returned an id, so a repeated request is a repeated decision. Request
deduplication is the insert funnel's existing idempotency-key path, not the
policy's.

The audit table is readable by the service role only — row-level security on,
no policies. Its rows carry a moderation reason, which is the deployment's
business, not the job owner's; the admin surface reads it through the backend.

## Review

Held jobs are resolved from **Admin → Review**, backed by
`GET /v1/admin/review/jobs` (the queue, oldest first — the job's `status` is
the authority, so a job cancelled out from under a hold never appears),
`GET /v1/admin/review/jobs/:jobId`, `GET /v1/admin/review/jobs/:jobId/output/:index`
(the held bytes, streamed through the admin route with `Cache-Control:
private, no-store`; the key is read server-side from the job row, never from
the client), `POST …/:jobId/approve`, `POST …/:jobId/reject` (a `reason` is
required — it becomes `error_hint.reason`, which the owner sees), and
`GET /v1/admin/review/decisions` (the audit trail; never a URL). The routes
are admin-gated and there is no bulk verb: one job per decision, and every
resolution records who made it.

Approve performs its own compare-and-set `pending_review → completed`, replays
the completion fields the funnel stored at hold time (including the caller's
metering flag, so a metered provider is charged its actual cost rather than the
reservation ceiling) and runs the extracted completion tail. The completion
funnel's own compare-and-set is **not** widened to admit `pending_review` —
that would let a stray worker complete a held row and re-enter the result gate.
A second approve, or an approve after a reject or a cancel, answers 409 with
the current status; it is a normal outcome, not an error.

**A hold has a clock.** `JOB_HOLD_TTL_HOURS` (`docs/deployment.md`) bounds
how long a job may wait in `pending_review`. On expiry the platform
**auto-rejects**: refund, delete, and an audit row with `policy_id =
"platform"`, `reason = "hold-expired"`. Unset, holds never expire and the
reservation waits for a human. This is the one sweep permitted to touch a
`pending_review` row, stated as an explicit exception to the exemption above.
Auto-approve is deliberately not offered: it would publish exactly the output
a human declined to look at.

## Failure writes, consolidated

The seam needed one place to fail a job — and found five shapes. Failures were
inline compare-and-set updates scattered across the workers and the reconcile
sweeps, two of them without a compare-and-set at all, plus a route-side helper
in the plugin toolkit. `markJobFailed(jobId, { error_message, error_hint?, … })`
in `lib/job-failure.ts` is now the compare-and-set-guarded failure writer for
every lane the result gate can hold — the media workers, the reconcile sweeps
and the plugin-toolkit helper. It is **not** the only writer in the codebase:
in-route settlers, sinks and the text/JSON lanes keep their own terminal write
(a few of them still without a compare-and-set), because none of them can
produce a held row. Each is enumerated with its reason in
`backend/src/workers/__tests__/job-policy-result-totality.test.ts`, and that
allowlist — not this paragraph — is the source of truth. The guard fails the
build on a `status: "failed"` write in any file not on the list; a new write
added inside a file already on it is not caught. `markJobFailed`
deliberately does not refund — the refund decision is caller-specific — and its
default `from` set is `pending`, `queued`, `processing`: `pending_review` is
absent on purpose, so no sweep can ever fail a held job; only reject names it
explicitly. A policy block is not a new column: it is a new `error_hint`
**kind**, so it reaches the editor, the API, the SDK and MCP through the same
path a provider content-policy block already uses.

## What is deliberately not gated

The seam sits on jobs. Anything that produces no job row — synchronous text
routes, streaming LLM responses, in-handler planning calls, prompt drafts written
before a row exists — is out of scope by construction, and no amount of
registration reaches it. A deployment that needs those judged needs a different
seam (the prompt policy covers the media-prompt lanes; the upload policy covers
ingested bytes). `flag` writes nothing on the job row and is invisible to the
user by design; turning a flag into a quieter enforcement lever (forcing the
output private, say) is a product decision and a named follow-up, not a shipped
behaviour.
