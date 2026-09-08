---
"@nodaro/sdk": minor
---

**@nodaro/sdk** — `client.studio.productions`: the studio production document,
from a script.

A studio production is a workflow whose `settings.studio` holds the shots — each
one a framed still, an optional animated clip, and the plan, looks, cast
bindings, frames and voice that made them. Until now the only code that could
read or write that document ran in the studio app's browser tab. This resource
is the SDK half of `/v1/studio/productions`, so a script, an agent and the app
work on ONE production instead of three opinions about one row.

The read half — `skill()`, `validatePlan()`, `list()`, `get()`, `exportPlan()` —
returns the route's envelopes typed and the production DOCUMENT as open JSON:
`detail: "summary"` (counts and the active urls) or `"full"` (every result with
the context that regenerates it), with `shotId` for a single shot. The
document's field-level types ship with the studio app, the one consumer that
narrows them; everything a caller branches on — `version`, `rebased`,
`receipts`, `warnings`, a quote's `credits`, a run's `jobIds` — is typed here.

The write half is `ops()`: a batch of semantic operations, applied atomically.
Operations address by stable KEY — a shot id, a role slug, a result's job id or
url — and never by position, which is what lets two writers hold one production
open: a batch composed against a slightly older version still applies to the
newest document and the response says `rebased: true`. `strict: true` refuses
instead. `receipts` says what each operation did, in the words a change log
would use.

Generation is run-then-poll: `generate()` — and its `generateStill()` /
`generateClip()` spellings, which only fill in `kind` — submit and record
pending markers, and `reconcile()` turns finished jobs into results, no browser
required. The request is assembled server-side from the shot's own plan, so a
scripted run and a press of the button produce the same media. `dryRun` prices
without writing (the reply is the quote — narrow it with
`isStudioGenerateEstimate`), and `clientRequestId` makes a retry safe: the same
token answers with the jobs the first call started and submits nothing.
`describe()` turns a brief into scenes, `frame()` / `voice()` / `revoice()` /
`music()` cover the per-shot media, and `share()` / `unshare()` / `clone()` the
audience and copies.

Two error mappings come with it: `409 production_busy` now maps to
`WorkflowConflictError` (the same situation and the same remedy as
`workflow_conflict` — its `code` says which arrived), and a 4xx carrying an
`opIndex` maps to the new `StudioOpError`, which names the operation that was
refused. Selected by SHAPE rather than by a list of codes, so a new refusal
reason reaches callers without an SDK release.
