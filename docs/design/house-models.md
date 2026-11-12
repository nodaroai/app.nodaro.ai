# House models

A **house model** is a model a deployment offers under its own label. It is a
model-catalog entry marked `ownLabel: true` that names no maker. The platform
runs the job: the credit hold, the queue, the checkpoint, the poll loop,
recovery, delivery and the charge. The deployment supplies the upstream that
does the work through a private plugin, which the public platform never names.

This note describes the seam between the two. The core module is
`backend/src/lib/house-models.ts`.

## The two halves

| The platform (this repository) | The deployment's plugin |
|---|---|
| Lists the model (catalog entry, prices, docs) | Says which house models it serves (`ids()`) |
| Validates the request and reserves credits | Prices a run in its own cost (`plan()`, pure) |
| Saves the run's reference on the job before anything else | Submits the run and returns an opaque reference (`start()`) |
| Polls, cancels, times out, recovers a job whose worker died | Reads the run's status (`poll()`) |
| Re-hosts the result, settles and commits the charge, refunds a failure | Holds the upstream's client, key, request shape and rates |

The plugin member is `PluginServices.houseModels` (additive-optional: an install
without it simply has no house models). The platform treats the upstream as an
opaque task: it never sees the request, never calls a provider client of its
own for a house model, and never names one.

## Availability: one rule

`houseModelServed(id)` is true when the catalog marks `id` own-label **and** the
loaded plugin's `ids()` includes it. The set of house models is exactly the
catalog's own-label ids; a plugin can only narrow it. A plugin leaves out of
`ids()` what it cannot run — a model whose upstream key this deployment lacks
— so "not served" also means "no key", in every process that loads the plugin
(the API, the workers and the reconcile).

`isModelDenied` (`backend/src/lib/surface-deny.ts`) asks it first. A house model
this install does not serve is no model here at all, in every edition, and no
profile, override or admin switch hands it back. Everything that already reads
model availability follows from that one rule:

- `GET /v1/models` and the MCP `list_models` tool leave it out, and no
  recommendation names it.
- `GET /v1/surface/availability` lists it as denied, so the editor's model menus
  leave it out (a node that already stores it keeps showing it, and is refused
  at run).
- Admin → Availability shows no switch for it.
- A request that runs it is refused before any credit is reserved
  (`model_not_available`), and so is a workflow run.
- A deployment overlay's preset pack that names it logs a warning at boot,
  naming the pack, the preset and the model, and the process starts. The
  preset is refused when it runs, before any hold. Whether a house model is
  served depends on its upstream key being present in that process. That
  differs between services (the pipeline worker never needs it) and changes
  at run time (a key added, rotated or removed), so refusing the boot could
  crash-loop a whole service. The check runs once the private plugins have
  loaded, since before that no house model reads as served. A preset naming
  a model the profile withholds still refuses the boot.
- While the catalog has a house model this install does not serve, the
  deployment counts as restricting models (`modelRestrictionConfigured`). A
  route that names the model it runs only through `runModel` is then judged
  on it before the hold, and a new node does not start on it.

Generated documentation (the model guide, the node skills) never reads what an
install serves. It is written from the catalog alone, so a house model's row
says where it is offered. Only run-time listings read `houseModelServed`.

A community install has no plugin, so it offers no house model, and its
discovery lists only models that name their maker.

### In which process

The API server, the video worker and the pipeline worker load the plugins. The
standalone orchestrator, which builds and reserves workflow runs, does not:

| Function | Valid in | Elsewhere |
|---|---|---|
| `houseModelServed` | every process | where the plugins are loaded it reads `ids()`; the orchestrator asks its API (`GET /v1/house-models/internal/served`, internal only) and reuses the answer for a minute. Through failed asks it keeps using its last answer for up to 10 minutes from when it was fetched, so an API restart causes no hand-back. With no answer, or one older than that, the answer is unknown, not "not served": a run on a house model is handed back to the queue (`HouseModelsServedUnknownError`, a `DrainAbortError`) with nothing held, and the API is asked again after a few seconds. Once the process has been without a usable answer for 3 minutes, the node fails instead as temporarily unavailable (`model_temporarily_unavailable`), with nothing held, and the run can be started again. A process with neither answers "not served" |
| `planHouseModelRun` | the API (a route's guard, before the hold), the video worker (before `start`) | throws `HouseModelsNotLoadedError`, a programming error — never "invalid run" |
| `runHouseModelTask` | the video worker | throws `HouseModelsNotLoadedError` |
| the reconcile kind | the API (the reconcile cron) and the video worker (the inline re-pick) | throws `HouseModelsNotLoadedError` (the cron logs it and the job waits) |

So a workflow lane never calls `plan`: it checks what its own core rules can
before the hold, and the worker plans before it starts (null there fails and
refunds the job). While the catalog has a house model, the engine makes the
orchestrator's answer current before it builds every node's payload, where the
availability rule is applied. It does so whether or not the node names a house
model, since its model can arrive through a FieldMapping, an app input or a
retired model's remap.

## A run

`runHouseModelTask(id, args, { jobId, pollIntervalMs, timeoutMs, onProgress, inputFacts })`:

1. Refuses before anything starts when any of these holds:
   - the model is not served, or has no valid lane row;
   - a declared input file is not on this install's own storage;
   - a URL appears anywhere in `args`, at any depth, outside the declared
     input-file args;
   - a declared input file has no measurement in `inputFacts`, or the lane
     row's input rule does not take it;
   - `plan` finds no valid run in `args`.

   Nothing is submitted upstream, and the job fails and is refunded.
2. Claims the job, then calls `start`: once per job, ever, held by the job row
   (`backend/src/lib/house-model-claim.ts`). The claim is one compare-and-set
   on `jobs`. It writes `provider_kind = 'house-model'`,
   `provider_task_id = 'house-model:claimed'` and a fresh
   `provider_call_started_at`. It lands only on a row that is live (pending,
   queued or processing) and holds no `provider_task_id` yet. From then on:
   - A queue re-pick finds a task id and takes the recovery path. A pickup
     keeps the kind and stamp of a row with a saved task id.
   - A second run of the lane in the same process finds the claim taken. The
     worker's inline safety retry is one such run. With the run's reference
     saved, the second run reads that run and never starts another.
   - With the claim and no reference, the second run is refused, final
     (`HouseModelStartRefusedError`). That state means the worker died between
     `start` and the save, or the save failed.

   A cancel is checked right before the claim. An upstream may have no
   idempotency key, and a submit that timed out may still have created a task.
   So a rejected `start` is final: the job fails and is refunded, and nothing
   runs the lane again. The reference then replaces the claim at once, with a
   second compare-and-set on the claim's own value, together with the start's
   planned cost. That save lands only while the job is still live (pending,
   queued or processing). A worker whose lock lapsed while `start` ran can find
   its job already failed and refunded by the re-pick. It then stops: it does
   not poll, it logs that the job was ended, and it leaves the row as it is
   (`HouseModelJobEndedError`, final).
3. Polls until the run is done or failed, or the per-model poll budget runs out.
   A failed status (a finished task with no usable file comes back as one) is
   the run's end: final. Every tick honours a cancel. A status read that throws
   is retried a bounded number of times. Past that, or past the budget, the
   run is given up for now (`HouseModelRunPendingError`), unless its reference
   could not be saved: then every failure after `start` is final. A drain
   hands the job back (`DrainAbortError`) once the reference is saved, and the
   re-pick reads the run. A run whose reference could not be saved keeps
   polling, since handing it back could not resume it.
4. Returns the result files, the output size when the upstream reports it, the
   cost the upstream reported (if any), and the start's planned cost. The
   planned cost was also saved on the job with the reference.

A lane tells the two kinds of rejection apart with `isHouseModelRunFinal` and
`isHouseModelRunPending`, and rethrows the error unchanged either way. Final
means the job fails and is refunded now: a refusal before `start`, a rejected
`start`, a returned failure, or any failure after `start` whose reference was
not saved. Pending means a timeout, or status reads that kept failing, with the
reference saved. On a non-final queue attempt the retry re-picks the job and
the recovery reads the same run. On the final attempt the worker leaves the
row `processing` for the reconcile instead of failing it. Either way the run is
checked again, so the error's own sentence ("the run will be checked again") is
true. A cancel is
neither; it ends the job through the cancel path.

The worker then delivers the run through `deliverHouseModelRun`
(`backend/src/lib/house-model-delivery.ts`), the one delivery both the worker
and the recovery call. It runs the lane's own `deliver` when the lane has one
(a thumbnail, its own output fields). Otherwise it runs the default: the first
file is the result and the rest ride along, the shared finalize stores them,
`jobs.provider` records the house-model id, and a held run settles through the
lane's `settledBase`. The delivery also resolves the cost the job records, the
same way on both paths: what the upstream reported; else `plan` on what was
delivered, from the lane's `deliveredPlanArgs` built from the job's request;
else the start's planned figure.

Each lane computes its model's arguments, refuses what the model cannot do
with its own core rules before the hold, and reserves credits from the
catalog's price rows; a route (in the API) may also ask `plan` before the hold.
The worker asks `plan` before `start`.

An input file from outside is copied to our storage first, and that copy is
what is measured, billed and sent. A file already on our storage is used as
it is. So the file the upstream fetches is the file that was measured: a link
someone else controls cannot answer one way when measured and another way
when fetched. The runner is the backstop for a lane that forgets. Each lane
row names the `args` that hold input-file URLs (`inputUrlArgs`). The runner
refuses to start when any of them is not a file of this install's own
storage, by the same strict test the platform applies to any link an outside
service fetches (`isOwnStoredFileUrl`, `backend/src/lib/own-storage-url.ts`).
It also refuses a URL anywhere else in `args`, since an upstream may fetch any
URL it is handed. The refusal is final and uses a neutral sentence.

The input rule (`input`: accepted formats and the largest file in bytes) has
one source and one measurement. The lane row is the only place its numbers
live. The lane hands the rule to the step that stores the input, and that
step is the only one that measures the file:

- An outside file is copied under `maxBytes` as a hard cap on the bytes
  actually read, and is measured as it is written.
- A file already on our storage is measured from our storage's own object
  metadata, never from a caller's claim.

The lane passes that measurement to the runner as `inputFacts`, keyed by the
stored URL. Each entry holds the file's size in bytes, and its format (as the
platform's media probe names it: `png`, `jpeg`, `mp4`) when the rule names
accepted formats. The runner holds the rule against those same facts before
`start` and measures nothing itself. A declared input file with no size, or
with no format where the rule names formats, is a lane error. Both refusals
are final.

## Recovery

A job whose worker died is finished by the `house-model` reconcile kind. It
reads the saved reference's status through the same plugin and never starts
anything, so taking a job over early costs a read and never a second run. The
cron reads once a tick. The worker's inline re-pick keeps reading a run that is
still going, on the model's own cadence, up to its poll budget, as the provider
path does, and hands the job back on a drain.

- **Done:** the job is delivered through the same `deliverHouseModelRun` call
  the worker makes, with the same inputs, and records the same cost. When
  neither the upstream nor a re-plan gives a figure, the recovery passes none
  and the planned figure saved with the reference stays on the row.
- **Failed, or done with no file:** the job fails with the same
  `error_message` and `error_hint` the worker writes, and is refunded.
- **Still running:** the job is looked at again on the next tick.
- **Claimed with no reference:** the job can never progress, so it is failed
  and refunded at the first look: by the cron once it is past the kind's
  staleness threshold, or by the inline re-pick. Its sentence says the run will
  not be retried, which holds whether or not the run reached the upstream.
- **Not served, or the read fails:** the job counts toward exhaustion, which
  fails it and refunds it.

The kind's staleness threshold is derived from the longest per-model poll
budget plus a margin. The recovery therefore never takes over a job whose
worker is still polling.

## Failures

The plugin reports a failure as the upstream's own words plus the flags a
plugin handler's error already carries: `deterministic`, `requestRefused`
(with `requestRefusedSubject`), `inputImageRefused`, `inputVideoRefused`,
`promptRefused` and `contentPolicy`.

The platform builds a fresh error from them. It carries a fixed sentence for
the person, a neutral operator detail, and the flags as own properties.
`contentPolicy` becomes a safety block. The worker and the recovery map that
error to the job's `error_message` and `error_hint` the same way. No own-label
catalog entry may declare a stochastic safety filter, so a house model never
takes the worker's inline safety retry; a guard test holds this.

The upstream's words are written to one server log line with the job id,
redacted like any provider detail (a URL is cut to its host, secrets are
dropped), and nowhere else. They never reach `error_message`, `error_detail`,
`error_hint` or `reconcile_last_error`. The same holds for a status read that
throws: its words go to a log line, and the job keeps a neutral sentence. It
also holds for a delivery that fails. The result files sit on the upstream's
own host, and a failed re-host can name that host, a redirect's target, a
certificate's names or an address. So the one delivery logs the original once,
redacted, then gives the error a fixed sentence and a neutral detail. It keeps
only the class prefix the classifiers read (`upload-size-exceeded`, the SVG
refusal), and rethrows the same error object, so its markers still classify
it.

## Accounting

- **Credits:** reserved and charged from the catalog's price rows. A lane may
  settle a run it reserved at its top price on what was delivered
  (`settledBase` → `meteredBaseCredits`, never above the reservation). The
  figure must be above 0. A 0 would commit the whole reservation, so the
  delivery refuses it with an error log and commits the reservation as it
  stands.
- **Provider cost:** `jobs.provider_cost` holds the start's planned cost from
  the moment the reference is saved. On delivery it records what the upstream
  reported, else `plan` on what was delivered, else keeps the planned figure.
  A job that fails or is refunded after its reference was saved keeps the
  planned figure, since the run was started upstream.
- **Attribution:** `jobs.provider` records the house-model id, the catalog's
  own name. The concurrency provider ceilings count every house model under one
  neutral name, `house-models`.
- **Concurrency:** the job holds its lane's slot like any other provider job.

## Adding a house model

1. A catalog entry with `ownLabel: true` (no `maker`), its price rows, and the
   `model_pricing` seed migration.
2. One row in each per-model table, keyed by the catalog id:
   - `backend/src/lib/house-model-timeouts.ts`: the poll budget and cadence. The
     recovery threshold follows from the longest budget plus ten minutes (a
     60-minute run makes it 70), and must stay inside the recovery's 75-minute
     envelope, so no budget may exceed 65 minutes.
   - `backend/src/lib/house-model-lanes.ts`: the `args` that hold input-file
     URLs (`inputUrlArgs`, required; `[]` for a model that reads no file), the
     input rule (passed to the step that stores the input, whose measurement
     the lane hands the runner as `inputFacts`), the lane's own `deliver` when the default delivery does not
     fit, the settle for a held run, and the plan arguments for what was
     delivered. A guard test fails an own-label model with no row, or a row
     that does not declare its input URLs.
3. The lane: build `args`, refuse what the model cannot do, call `plan` before
   the hold, run `runHouseModelTask` in the worker, and deliver through
   `deliverHouseModelRun`.
4. The deployment's plugin serves the id.

A guard test holds the boundary. No provider configuration names a house model.
The house-model modules import nothing from the provider clients. No line that
names a house model names a provider.

## Known gaps

- **No upstream cancel.** Cancelling refunds the job, but the run it started is
  not stopped upstream.
- **A run lost between `start` and saving its reference is paid upstream and
  refunded here.** This happens when the worker dies in that window, or the
  save fails and the worker dies later. The claim stops a second run, and the
  job is failed and refunded at its recovery's first look. Nothing reads the
  run that was started.
- **An orchestrator with no usable answer from its API hands its house-model
  runs back for up to 3 minutes.** Each hand-back resumes the execution. After
  that the node fails as temporarily unavailable, with nothing held.
- **The plugin's own HTTP calls do not pass through the platform's egress
  decorator.**
- **These jobs are outside everything keyed to a named upstream:** low-balance
  alerts, the admin credit audit, and bill matching.
- **Hidden by a stored models override.** On a deployment with a stored models
  override in Admin → Availability, a new house model stays hidden until an
  admin switches it on, like any new model.
