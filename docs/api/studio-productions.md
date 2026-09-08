# Studio Productions API

`/v1/studio/productions` is the platform's own reader and writer of a **studio
production**: a Nodaro workflow whose `settings.studio` holds an ordered list of
shots, each with a framed still, an optional animated clip, and the plan, looks,
cast bindings, frames and voice that made them.

Before these routes existed, the only code that could read that document ran in
the studio app's browser tab. Now a script, an agent and the app all read and
write the same production through one contract — which is what makes "generate
the still for shot 3 and keep the second candidate" something you can do from a
cron job.

- **SDK:** `client.studio.productions.*` ([`@nodaro/sdk`](https://www.npmjs.com/package/@nodaro/sdk)).
- **Types:** the SDK types the ENVELOPES — `version`, `rebased`, `receipts`,
  `warnings`, a quote's `credits`, a run's `jobIds` — and leaves the production
  DOCUMENT as open JSON. Its field-level types ship with the studio app, the one
  consumer that narrows them; a second spelling in the SDK would drift from it.
- **Auth:** a bearer token like every other `/v1` route. OAuth tokens need
  `workflows:read` to read and `workflows:write` to write.
- **Availability:** Nodaro Cloud only. A deployment that does not serve these
  routes answers `404` on all of them. Feature-detect once with `list()` — a
  deployment without the routes 404s that too, where a deployment with them
  answers an empty page.

Every route answers `404` — never `403` — to a caller who cannot reach the
production, so an id cannot be probed for existence.

## The envelope

Every response is wrapped:

```json
{ "data": { "production": { "…": "the production" } } }
```

The SDK unwraps it for you: a method that returns "the production" resolves to
the production object itself, and a method that returns a report resolves to the
whole report object.

Errors are the platform's usual shape:

```json
{ "error": { "code": "production_busy", "message": "…" } }
```

## The read shape

Every route returns the production in the same shape. Its top level:

| Field | Meaning |
| --- | --- |
| `id`, `name`, `version`, `updatedAt` | Identity and the change counter every write swaps on. |
| `thumbnailUrl`, `shared`, `archived` | The poster frame, the share-by-link flag, the soft hide. |
| `film`, `cast`, `folders`, `storyboard`, `music`, `musicPlan`, `cuts` | The production's own settings: the film look, the roles, the timeline folders, the brief, the score and the exported cuts. |
| `trash` | `{ count, items? }` — deletes are recoverable. |
| `pending` | `{ stills, clips, music, draft }` — what is in flight right now. |
| `shots[]` | In timeline order: `still`, `clip`, `startFrame`, `endFrame`, `plan`, `beats`, `look`, `voice`, … |

Two levels of detail:

- `detail=summary` (default) — counts and the active urls. This is what a list
  or a preamble wants.
- `detail=full` — every result in each shot's history, with the context that
  regenerates it.

`shot_id` returns a single shot, which is the cheap way to re-read after a
generation.

**Result histories accumulate.** Generating never replaces: a shot's stills are
every candidate it has ever had, and the same for its clips. Stills and clips
are independent — deleting one never touches the other. A result is addressed by
its **result key**: its job id when it has one, its url otherwise. Never by
position.

## Routes

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/v1/studio/productions/skill` | — | `{ skill, catalog, schema, operating, generatedFrom }` |
| `POST` | `/v1/studio/productions/validate` | `{ plan }` | `{ valid, errors[], warnings[], summary? }` |
| `GET` | `/v1/studio/productions` | `?limit&cursor&includeArchived` | `{ data[], nextCursor? }` |
| `POST` | `/v1/studio/productions` | `{ name?, plan? }` | `{ production, warnings?, summary? }` |
| `GET` | `/v1/studio/productions/:id` | `?detail&shot_id` | `{ production }` |
| `POST` | `/v1/studio/productions/:id/ops` | `{ ops[], baseVersion?, strict?, clientRequestId? }` | `{ production, version, rebased, receipts[], warnings[] }` |
| `POST` | `/v1/studio/productions/:id/reconcile` | — | `{ landed[], pending[], failed[], warnings[], production, version }` |
| `POST` | `/v1/studio/productions/:id/import` | `{ plan, mode: "append" }` | `{ production, warnings, summary }` |
| `POST` | `/v1/studio/productions/:id/describe` | `{ brief, llmModel, mode?, label?, clientRequestId? }` | `{ jobId, production }` |
| `POST` | `/v1/studio/productions/:id/generate` | `{ kind, shotId, count?, mode?, overrides?, dryRun?, clientRequestId? }` | `{ jobIds[], lane?, deduped?, production? }` or the quote |
| `POST` | `/v1/studio/productions/:id/frame` | `{ shotId, mode?, timestamp?, target?, clientRequestId? }` | `{ production, url? }` |
| `POST` | `/v1/studio/productions/:id/voice` | `{ shotId, text, voiceId?, voiceType?, ttsProvider?, delivery?, clientRequestId? }` | `{ production }` |
| `POST` | `/v1/studio/productions/:id/revoice` | `{ shotId, plan, clientRequestId? }` | `{ jobId, production }` |
| `POST` | `/v1/studio/productions/:id/music` | `{ prompt, duration?, instrumental?, vocalGender?, model?, clientRequestId? }` | `{ jobId, production }` |
| `GET` | `/v1/studio/productions/:id/export-plan` | `?upscale` | `{ canExport, steps[], resultStepId, estimate, unpriced[] }` |
| `POST` | `/v1/studio/productions/:id/share` | `{ shared }` | `{ production }` |
| `POST` | `/v1/studio/productions/:id/unshare` | — | `{ production }` |
| `POST` | `/v1/studio/productions/:id/clone` | `{ name? }` | `{ production }` |

There is deliberately no delete route. The soft hide the dashboard honours is
an operation, and it is reversible.

## Writing: operations, not patches

Every change to a production is an **operation**: a named, self-describing edit
— rename this shot, move it, bind this cast role, keep that candidate — that the
route validates and applies. The vocabulary is served, not printed here:
`GET …/skill` returns it as the `operating` part, rendered from the version that
is live, so what you read is what the deployment you are talking to accepts.

An operation addresses by **stable key**: a shot by its id, a folder or cut by
its id, a cast row by its role slug, a result by its result key. Not by
position — because the editor, a script and an agent can hold the same
production open at once, and an index is stale the moment any of them inserts
something.

```ts
const { production, version, rebased, receipts } =
  await client.studio.productions.ops(productionId, {
    // The operations, in order, in the vocabulary `GET …/skill` serves.
    ops,
    baseVersion: 7,
  })
```

Rules that hold for every batch:

1. **Atomic.** A batch applies completely or not at all. One invalid operation
   refuses the whole batch and writes nothing. Up to 100 operations per batch.
2. **Rebasing by default.** `baseVersion` is informational: a batch composed
   against an older version is still applied to the newest document, and the
   response reports `rebased: true`. Pass `strict: true` to refuse instead and
   get a `409` conflict carrying the current state.
3. **Ids you will address later are yours to mint.** An operation that creates
   something — a shot, a folder, a cut, a copy — takes the id you give it rather
   than minting one. Your optimistic local copy and the server then agree on
   every id.
4. **Deletes are recoverable.** A removal moves what it removed to the
   production's bin, and there is an operation that restores it. Only an
   explicit purge destroys anything.
5. **Sharing is not an operation.** Who may see the work is changed through the
   `share` route by the owner, never as a side effect of a batch that was
   editing something else. A batch that tries to set it is refused.
6. **Adopt the response.** `production` is canonical after the batch — replace
   your copy with it rather than merging into it — and `version` is the next
   `baseVersion`.

`receipts` is one line per operation — `{ op, summary, ids? }`, past tense,
naming the target the way a person would — which is what you show someone who
wants to know what an agent just did. `warnings` is a flat list of things worth
saying that are not failures: an operation that changed nothing, a rename that
rewrote four prompts.

## Generating, and landing the results

Generation is **run-then-poll**. A still or clip request submits the job(s),
records a pending marker on the production, and returns immediately — nothing
here blocks for minutes.

One route runs both kinds — `POST …/:id/generate` with `kind: "still" | "clip"`
and the shot in the body. The SDK's `generateStill` / `generateClip` are the
same call with `kind` filled in.

```ts
const run = await client.studio.productions.generateStill(id, "shot-2", {
  count: 2,
  clientRequestId: crypto.randomUUID(),
})

// …later, once the jobs finish:
const { landed, pending } = await client.studio.productions.reconcile(id)
```

- The request is **assembled server-side** from the shot's own plan, looks, bound
  references and direction, so a generate from a script and a press of the
  button in the app produce the same image. `overrides` changes one run without
  changing the shot.
- `dryRun: true` prices the run and writes nothing. The reply is the QUOTE —
  `{ dryRun: true, provider, count, credits, lane? }` — rather than a started
  run; `credits` is `null` when the model has no price, which is "unknown", not
  "free". In the SDK, narrow it with `isStudioGenerateEstimate(result)`.
- `clientRequestId` makes a retry safe: the same token answers with the jobs the
  first call started and `deduped: true`, having submitted nothing and charged
  nothing. Never retry a spend without it. It is 8–128 characters of
  `A-Za-z0-9_.:-`, minted by you — never derived from the request.
- `reconcile` turns finished jobs into results and clears the markers of jobs
  that failed. `GET …/:id` never writes, so call `reconcile` when you are
  waiting on something.
- For a clip, the **lane** (`generate-video` or `text-to-video`) is chosen from
  the shot's inputs — a start frame, references, a prompt — and reported back to
  you as `lane`. You never pick it. `mode` only says which SET of inputs to
  direct from (`"start"` or `"references"`); omit it and the inputs decide.

`frame` and `voice` are the short ones: they wait for their job (seconds) and
return the changed production. `revoice` and `music` are the long ones: they
answer `jobId` and land through their markers.

## Story → production

```ts
const { production } = await client.studio.productions.create({ name: "The Lighthouse" })
const { jobId } = await client.studio.productions.describe(production.id, {
  brief: "A keeper, a storm, and a light that will not start.",
  llmModel: "gpt-5-mini",
  mode: "replace",
})
// poll jobId with client.jobs.getStatus, then:
await client.studio.productions.reconcile(production.id)
```

`describe` writes the plan from a brief. A plan you already have skips the run entirely: validate it for free, then land
it with `create({ plan })` or add its scenes to an existing production with
`importPlan`. `GET …/skill` serves the authoring guide, the full catalog and the
plan's JSON Schema, rendered from the version that is live — so they describe
the platform you are actually talking to.

## Exporting

`GET …/export-plan` returns the ordered steps that assemble the film — the
per-shot audio merges, the join, the optional 4K finish:

```json
{
  "canExport": true,
  "steps": [
    {
      "id": "voice-shot-2",
      "node": "merge-video-audio",
      "label": "Voice over shot 2",
      "creditModel": "merge-video-audio",
      "credits": 2,
      "params": { "videoUrl": "https://…/shot-2.mp4", "audioUrl": "https://…/vo.mp3" }
    },
    {
      "id": "combine",
      "node": "combine-videos",
      "label": "Join 3 shots",
      "creditModel": "combine-videos",
      "credits": 4,
      "params": {
        "videoUrls": [{ "fromStep": "voice-shot-2" }, "https://…/shot-3.mp4"],
        "transition": "cut",
        "audioMode": "keep"
      }
    }
  ],
  "resultStepId": "combine",
  "estimate": 6,
  "unpriced": []
}
```

Run the steps in order with the ordinary generation verbs and record the
finished file back on the production as a cut, with the operation that adds
one. A `videoUrl` of `{ "fromStep": "…" }` is the output of an earlier step —
substitute the url that step produced. Step
ids are derived from the production, not minted, so re-planning the same film
gives the same references.

`canExport` is `false` when there is nothing to assemble (fewer than two clips).
`estimate` is `null` when ANY step is unpriced — the unpriced models are named
in `unpriced`, and a partial sum presented as the total would understate the
spend. Assembly is step-wise on purpose: a single call that chained several
minutes-long jobs would outlive any reasonable request timeout.

## Errors

| Status | `code` | What to do |
| --- | --- | --- |
| `400` | `validation_error` | The body or the plan is wrong; `path` names the field. |
| `400` | `op_invalid`, `op_target_missing` | On `…/ops`: one operation was wrong; `opIndex` names it (zero-based). Nothing was written — fix that operation and send the batch again. |
| `402` | `insufficient_credits` | Not enough credits for the batch. |
| `403` | `forbidden` | Only the owner or a workspace admin can change who a production is shared with. |
| `404` | `not_found` | No such production for this caller. |
| `404` | `op_target_missing` | On the generating and media routes: the shot, result or role the call named is not in the production. No `opIndex` — there is no batch to index into. |
| `409` | `workflow_conflict` | `strict: true` and the production had moved on. Re-read and re-apply. |
| `409` | `production_busy` | The row kept changing under the write. Re-read and retry. |
| `413` | `storage_exceeded` | The account's storage limit. |

In the SDK these arrive as typed errors: `StudioOpError` (with `opIndex`),
`WorkflowConflictError` (both `409`s — its `code` tells you which),
`InsufficientCreditsError`, `StorageExceededError`, `NotFoundError`. The
mapping is by SHAPE, not by code: any 4xx whose body carries a numeric
`opIndex` is a `StudioOpError`. So the same `op_target_missing` reaches you as
a `StudioOpError` off `…/ops` and as a `NotFoundError` off a generating or
media route, because only the batch answer indexes.

```ts
import { StudioOpError, WorkflowConflictError } from "@nodaro/sdk"

try {
  await client.studio.productions.ops(id, { ops, baseVersion, strict: true })
} catch (err) {
  if (err instanceof StudioOpError) {
    console.error(`operation ${err.opIndex} was refused: ${err.message}`)
  } else if (err instanceof WorkflowConflictError) {
    const fresh = await client.studio.productions.get(id, { detail: "full" })
    // re-compose the batch against `fresh`, then retry
  }
}
```

## SDK reference

| Method | Route |
| --- | --- |
| `skill()` | `GET …/skill` |
| `validatePlan(plan)` | `POST …/validate` |
| `list({ limit?, cursor?, includeArchived? })` | `GET …` |
| `create({ name?, plan? })` | `POST …` |
| `get(id, { detail?, shotId? })` | `GET …/:id` |
| `ops(id, { ops, baseVersion?, strict?, clientRequestId? })` | `POST …/:id/ops` |
| `reconcile(id)` | `POST …/:id/reconcile` |
| `importPlan(id, plan, { mode? })` | `POST …/:id/import` |
| `describe(id, { brief, llmModel, mode?, label?, clientRequestId? })` | `POST …/:id/describe` |
| `generate(id, { kind, shotId, … })` | `POST …/:id/generate` |
| `generateStill(id, shotId, { count?, overrides?, dryRun?, clientRequestId? })` | `POST …/:id/generate` (`kind: "still"`) |
| `generateClip(id, shotId, { mode?, overrides?, dryRun?, clientRequestId? })` | `POST …/:id/generate` (`kind: "clip"`) |
| `frame(id, { shotId, mode?, timestamp?, target? })` | `POST …/:id/frame` |
| `voice(id, { shotId, text, voiceId?, … })` | `POST …/:id/voice` |
| `revoice(id, { shotId, plan })` | `POST …/:id/revoice` |
| `music(id, { prompt, duration?, … })` | `POST …/:id/music` |
| `exportPlan(id, { upscale? })` | `GET …/:id/export-plan` |
| `share(id)` | `POST …/:id/share` |
| `unshare(id)` | `POST …/:id/unshare` |
| `clone(id, { name? })` | `POST …/:id/clone` |

See also: [API Integration](../api-integration.md), [SDK Reference](../sdk-reference.md).

## Retake one linked clip

Check `GET /v1/studio/productions/capabilities` for
`operations.retakeLinkedClips`. To price a native linked take, post to
`/:id/generate` with `kind: "clip"`, `shotId`, `retakeResultKey` and
`dryRun: true`. Submit the same take with the quote's `inputHash` in
`expectedInputHash` and a fresh `clientRequestId`. Do not include `mode`,
`overrides`, or `count`.

The server verifies the original job request and retained endpoint images.
Current frame acceptance and scene plans do not replace these inputs. A changed
quote returns `409 sequence_quote_changed` before submission. Missing original
metadata or retained images refuses the retake; this can include older or copied
takes. Each accepted submission adds one take and keeps existing history.
