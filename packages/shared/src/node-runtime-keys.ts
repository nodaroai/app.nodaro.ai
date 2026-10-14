/**
 * Field names on a node's `data` that hold runtime / result / transient execution
 * state (job ids, progress, generated outputs, fan-out bookkeeping). These are NEVER
 * part of a node's reusable configuration.
 *
 * Single source of truth, consumed by:
 *  - the workflow store's undo logic (execution-only updates skip undo capture, so job
 *    polling does not pollute undo history or flip `isDirty`)
 *  - the node-preset extractor (presets must never capture runtime state)
 *  - the backend defensive strip on preset writes
 *
 * When adding a new runtime/result field to a node's data, add its key here — or, when it is a
 * generic name only one node type writes as a result, to that type's row of
 * NODE_TYPE_EXECUTION_DATA_KEYS (read through `isExecutionDataKey` / `executionDataKeysOf`).
 */
export const EXECUTION_DATA_KEYS: ReadonlySet<string> = new Set([
  "executionStatus",
  "currentJobId",
  "currentJobProgress",
  "errorMessage",
  // Structured detail alongside errorMessage for a safety-filter block
  // (see `JobErrorHint` in the app's frontend/src/types/nodes.ts). Same
  // lifecycle as errorMessage: a RESULT the user expects to survive reload,
  // never user-edited config.
  "errorHint",
  // A job policy registered by the deployment held this node's result for a
  // human reviewer (`jobs.status = "pending_review"`). Pure run state, like
  // executionStatus: the node is still "running" and the flag disappears the
  // moment the review resolves — so it is ALSO in TRANSIENT_RUNTIME_KEYS
  // below. Without the transient half, a flip into review marks a passive tab
  // dirty and a preset captures "awaiting review".
  "jobAwaitingReview",
  // The editor cannot reach the server to read this node's job. The job keeps
  // running and the watch keeps polling. Pure run state, cleared by the next
  // check that gets through, so it is ALSO in TRANSIENT_RUNTIME_KEYS below.
  "jobConnectionLost",
  "isStreaming",
  "generatedImageUrl",
  "generatedVideoUrl",
  "generatedAudioUrl",
  "generatedText",
  "generatedScript",
  "generatedItems",
  "generatedResults",
  "activeResultIndex",
  "sourceImageUrl",
  "__listTotal",
  "__listCompleted",
  "__listResults",
  // Row-aligned twin of __listResults (Extract Field, List output) — read only
  // by the fan-out so two lists cut from one array pair by row.
  "__alignedListResults",
  // A render's fan-out row stamps, row-aligned with __listResults: each row's
  // take identity, and the clip every row was sent for (a failed row too).
  "__listResultStamps",
  // List fan-out window flag (abandon-guard exemption). Set/cleared by
  // executeNodeForList — purely execution-related, never user-edited.
  "__listRunning",
  // Why the last server run skipped this node (`empty_input`): a chip on the
  // card for the run that just ended, never a saved result — also in
  // TRANSIENT_RUNTIME_KEYS below.
  "__runSkipReason",
  // One token per paid run still out on this node that no executor mark
  // covers (the editor's `withRunInFlight`, around each paid call outside the
  // executors). Purely execution-related, never user-edited; also in
  // TRANSIENT_RUNTIME_KEYS.
  "__runsInFlight",
  // Selector node dual-channel outputs (picked + rest). Server-side execution
  // output, not user-edited config.
  "pickedResults",
  "restResults",
  "__pickedResults",
  "__restResults",
  "__pickedTotal",
  "__restTotal",
  "generatedJson",
  // A render's remapped transcript on its own pip (Speaker View's
  // `transcript`, RENDER_NODE_TYPES transcriptOutput) — run-result data.
  "generatedTranscript",
  // Edit Plan: a person's review of the plan (`EditedEdl`, edit-plan-review.ts),
  // kept beside `generatedJson` and fingerprinted against it. Run-result data
  // (TA14, decided 2026-10-04): out of undo, presets, templates and exports,
  // and Clear results wipes it. Persisted — never transient.
  "editedEdl",
  "subWorkflowProgress",
  "outputResults",
  "shots",
  "result",
  "processedResult",
  "activeRoutes",
  "routeOutputs",
  "_upstreamRefresh",
  "zoom",
  // Character LoRA training status fields — written every 8s while training.
  "loraReplicateVersion",
  "loraTriggerWord",
  "loraTrainingStatus",
  // Collect (fan-in) execution snapshot.
  "lastInputs",
  "lastMeta",
  "__upstreamCount",
  // Video URL node — the download's live percent/phase, written on every
  // progress tick (~2/s). Pure run-state; also in TRANSIENT_RUNTIME_KEYS below.
  "downloadPercent",
  "downloadPhase",
  // Webhook Output's delivery receipt. A webhook target may reflect the
  // request back (httpbin, RequestBin, an API that 400s with "headers
  // received: …"), so `webhookResponseBody` can carry whatever the request
  // carried — with an attached credential, the secret itself. Listing the three
  // here is what keeps the receipt out of template exports (GENERATED_FIELDS
  // derives from this set), out of node presets, and out of undo history.
  "webhookSuccess",
  "webhookStatusCode",
  "webhookResponseBody",
  // Content Ideas: one creative brief per idea (the node's list output — kept
  // out of __listResults, which would clone the node). And the non-fatal notes
  // a Content Recipe / Content Ideas run returns ("read the first of 3 posts").
  // Both are RESULTS: they persist, and a preset, a template or a run-only
  // patch must never treat them as config.
  "ideaBriefs",
  "runWarnings",
  // Content Ideas: the own brand whose results the last run leaned on — a
  // RESULT naming the runner's brand, so a template or a preset never carries it.
  "brandLessons",
  // Social Search: every post the last search found (the picker's grid), the
  // ids a person picked from them, and the run's non-fatal notes ("only part
  // of the results loaded"). All RESULTS: a template, a preset or a run-only
  // patch must never carry yesterday's posts or picks as configuration.
  "searchResults",
  "pickedIds",
  "searchWarnings",
  // Save to Collection: how the last run ended for this node (inserted /
  // duplicate / replayed) and how many old records the cap evicted. RESULTS of
  // a run — Clear results wipes them, and a template, a preset or a run-only
  // patch never carries them as configuration.
  "lastOutcome",
  "lastEvicted",
  // When the editor's "Clear results" last emptied this node (ISO time). Not a
  // result and not config: bookkeeping that tells the load-time recovery lanes
  // "this node is empty ON PURPOSE" — without it, every reload reads an empty
  // node as "ran while the editor was closed" and paints the last run back.
  // Persisted (never transient): the reload is exactly when it is read.
  "resultsClearedAt",
  // The id of the trigger-started run whose results this node shows (the
  // editor paints a Telegram run onto the canvas). Bookkeeping, not a result
  // and not config: it stops a reload from painting the same run again over
  // edits made since. Persisted for the same reason as resultsClearedAt.
  "resultsRunId",
  // When that run ended the node (beside resultsRunId): the editor's reopen
  // keeps a result a NEWER run left even when its own run listing cannot see
  // that run. Bookkeeping, persisted for the same reason.
  "resultsRunEndedAt",
  // A trigger's last run values (also in TRANSIENT_RUNTIME_KEYS: never saved).
  "__triggerData",
  // A fan-out's notes rows, every fan-out's (row-aligned with __listResults):
  // a row's warnings and length. A RESULT: persisted.
  "__listResultMeta",
  // A use-case node's continuation of one of its runs (Tighten Episode): set
  // for ONE run only, as that run's input override (an app's or the editor's
  // Render final, the canvas Continue's run option). Never saved — also in
  // TRANSIENT_RUNTIME_KEYS — so a saved one can never turn a later plain run
  // into a continuation of an old run.
  "useCaseContinue",
])

/**
 * Run results a node type writes under a GENERIC name — `quote`, `durationSec`,
 * `candidates` — that are execution data on THAT type only. Another node may
 * keep a setting under the same name; filing these globally would misfile it
 * (out of undo, presets, templates and the copilot's view). Same lifecycle as
 * the global results: persisted, and a run writing them is never an undo step.
 *
 * UGC video (Nodaro Cloud): the outputs a node hands on (`ugcOutputs`), UGC
 * Creator's options of a draw and their note, UGC Clips' quote, and UGC Clip's
 * warnings, length and Re-render marks (`rerenderPending`: the clips pressed for
 * Re-render that no run has rendered yet — run bookkeeping; the press itself,
 * `rerender`, is a choice).
 */
export const NODE_TYPE_EXECUTION_DATA_KEYS: Readonly<Record<string, readonly string[]>> = {
  "ugc-creator": ["ugcOutputs", "candidates", "optionFailed"],
  "ugc-script": ["ugcOutputs"],
  "ugc-clips": ["ugcOutputs", "quote"],
  "ugc-clip": ["ugcOutputs", "clipWarnings", "durationSec", "rerenderPending"],
  "ugc-cards": ["ugcOutputs"],
}

/** Is `key` execution data (run state or a run's result) on a node of `type`: global, or that type's own? */
export function isExecutionDataKey(key: string, type: string | null | undefined): boolean {
  if (EXECUTION_DATA_KEYS.has(key)) return true
  return typeof type === "string" && Object.hasOwn(NODE_TYPE_EXECUTION_DATA_KEYS, type) && NODE_TYPE_EXECUTION_DATA_KEYS[type]!.includes(key)
}

const EXECUTION_DATA_KEYS_BY_TYPE = new Map<string, ReadonlySet<string>>(
  Object.entries(NODE_TYPE_EXECUTION_DATA_KEYS).map(([type, keys]) => [type, new Set([...EXECUTION_DATA_KEYS, ...keys])]),
)

/** Every execution-data key on a node of `type`, as one set: the global ones, plus the type's own. */
export function executionDataKeysOf(type: string | null | undefined): ReadonlySet<string> {
  return (typeof type === "string" ? EXECUTION_DATA_KEYS_BY_TYPE.get(type) : undefined) ?? EXECUTION_DATA_KEYS
}

/**
 * The PURE RUN-STATE subset of EXECUTION_DATA_KEYS: per-tick values (status
 * flips, job ids, progress counters, fan-out bookkeeping) that must NEITHER
 * mark the workflow dirty NOR be persisted in the save payload. Everything
 * else in EXECUTION_DATA_KEYS is a RESULT the user expects to survive reload
 * (generated URLs/results, errorMessage, LoRA outputs, collect snapshots).
 *
 * Why this split exists: writing these keys used to set `isDirty`, so job
 * polling phantom-dirtied passive tabs → spurious autosaves → false
 * "changed in another tab" banners → the remote-ahead latch froze autosave
 * (the "not saved for a long time" report). Consumed by the workflow
 * store's dirty decision and the save-payload sanitizer below.
 *
 * Invariant (guarded by node-runtime-keys.test.ts): subset of
 * EXECUTION_DATA_KEYS — anything transient is also undo-exempt.
 */
export const TRANSIENT_RUNTIME_KEYS: ReadonlySet<string> = new Set([
  "executionStatus",
  "currentJobId",
  "currentJobProgress",
  "jobAwaitingReview",
  "jobConnectionLost",
  "isStreaming",
  "subWorkflowProgress",
  "__listTotal",
  "__listCompleted",
  "__listRunning",
  "__runSkipReason",
  // A paid run still out, held by the editor tab that started it. Never
  // saved, so a reload, which has no such run, starts without one.
  "__runsInFlight",
  "_upstreamRefresh",
  "__upstreamCount",
  // Video URL node download ticks. They used to dirty the workflow twice a
  // second for the length of the download — the same phantom-save chain the
  // job-progress keys above were moved here to stop. What SURVIVES a reload is
  // `downloadStatus` + `downloadId`; the percent is re-read from the server.
  "downloadPercent",
  "downloadPhase",
  // A trigger's last run values, shown in the editor after a run (a webhook's
  // body, a Telegram message and its post). Never saved: the workflow is not
  // where a message's content is kept — runs are, under their retention.
  "__triggerData",
  // A use-case node's continuation: one run's override, never config (above).
  "useCaseContinue",
])

/**
 * Pure save-payload sanitizer: returns new node objects with the transient
 * run-state keys removed from `data`. Nodes without transient keys (or
 * without `data`) are returned by reference — cheap for the common case.
 */
export function stripTransientRuntimeData<
  T extends { data?: Record<string, unknown> | undefined },
>(nodes: readonly T[]): T[] {
  return nodes.map((node) => {
    const data = node.data
    if (!data) return node
    let hasTransient = false
    for (const key of TRANSIENT_RUNTIME_KEYS) {
      if (key in data) {
        hasTransient = true
        break
      }
    }
    if (!hasTransient) return node
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (!TRANSIENT_RUNTIME_KEYS.has(key)) cleaned[key] = value
    }
    return { ...node, data: cleaned }
  })
}
