/**
 * What a run leaves on a node, by key: the one reading of "a run's result" that
 * the editor's Clear results and the UGC publish strip (ugc-publish-strip.ts)
 * both apply, so a node they empty reads as one that never ran on either side.
 *
 * `EXECUTION_DATA_KEYS` (@nodaro/shared) is the registry of runtime / result
 * fields; minus the members that are really config (`RUN_RESULT_KEEP_KEYS`),
 * plus the output fields that were never registered there
 * (`RUN_RESULT_EXTRA_KEYS`, and `RUN_RESULT_TYPE_KEYS` for generic names one
 * node type writes as a result). The editor's coverage test
 * (clear-run-results-coverage.test.ts) scans the execution modules and fails
 * when a run starts writing a key nobody has classified here.
 */
import { EXECUTION_DATA_KEYS } from "@nodaro/shared/workflow"
import { UGC_CREATOR_CANDIDATES_KEY } from "@nodaro/shared/ugc"

/**
 * Members of `EXECUTION_DATA_KEYS` that are NOT a run result, and why each one
 * stays. The registry files them as runtime for its own consumers (undo
 * exemption, preset extraction); clearing them would delete something a person
 * made or paid for.
 */
export const RUN_RESULT_KEEP_KEYS: ReadonlyMap<string, string> = new Map([
  ["shots", "Kling multi-shot storyboard — user-authored config (workflow-export keeps it for the same reason)"],
  ["zoom", "the node's display size on the canvas"],
  ["sourceImageUrl", "dual-role: an entity's reference image AND its generated main — the key alone cannot tell"],
  ["loraReplicateVersion", "a trained LoRA is an asset, not a run result"],
  ["loraTriggerWord", "a trained LoRA is an asset, not a run result"],
  ["loraTrainingStatus", "a trained LoRA is an asset, not a run result"],
  ["resultsClearedAt", "the clear's own watermark — what stops the next reload from painting the last run back"],
  // Not even run STATE to a clear: the run it marks goes on whatever the clear
  // does, and lifting the mark would let a pending read-only freeze land before
  // that run's result does (`showsARunInFlight`).
  ["__runsInFlight", "a paid run still out (`withRunInFlight`), which the clear does not stop"],
])

/**
 * Output fields runs write that were never added to `EXECUTION_DATA_KEYS`.
 * Kept apart from it on purpose: that shared set has five other consumers (undo
 * skip, preset strip, template strip, copilot graph filtering, import
 * re-hosting), and widening it is a change to each of them.
 */
export const RUN_RESULT_EXTRA_KEYS: readonly string[] = [
  // Fan-out bookkeeping — the run-start reset clears these too (run-handlers LIST_STATE_FIELDS).
  // (`__listResultMeta`, the fan-out's notes rows, is in EXECUTION_DATA_KEYS — cleared from there.)
  "listResults",
  "__listInputs",
  "__currentRunId",
  "jobRecovering",
  // Media and text outputs.
  "thumbnailUrl",
  "panelUrls",
  "combinedText",
  "splitResults",
  "extractedText",
  "generatedTitle",
  "generatedMaskUrl",
  "generatedVideoUrls",
  "generatedAudioUrls",
  "generatedPickerJson",
  "generatedPickerRunId",
  "generatedGaps",
  "generatedVoiceId",
  "generatedPlan",
  "vocalUrl",
  "instrumentalUrl",
  "alignmentResults",
  "contentPolicyRewrites",
  // Until #1547 the load-time restore wrote the four above under names of its
  // own. Nothing ever read them, and nothing writes them any more — but saved
  // workflows still carry them, so the clear still takes them off.
  "generatedVocalUrl",
  "generatedInstrumentalUrl",
  "generatedAlignment",
  "generatedSplitResults",
  // Written through poll-job's `extraOutputFields` callbacks. Each stem is its
  // own OUTPUT HANDLE: one left behind keeps feeding last run's audio downstream
  // while its cleared siblings report "no input".
  "drumsUrl",
  "bassUrl",
  "otherUrl",
  "guitarUrl",
  "pianoUrl",
  "stems",
  "generatedSilentVideoUrl",
  "overlayVariants",
  "overlayComposition",
  "warningMessage",
  // A public video node that had nothing to do and passed its input through (R14).
  "passThroughWarning",
  // Delivery receipts.
  "savedUrl",
  "platformPostId",
  "platformPostUrl",
  // (webhookSuccess / webhookStatusCode / webhookResponseBody live in
  // EXECUTION_DATA_KEYS since the HTTP-credentials work — cleared from there.)
  // Provider ids stamped beside a result. Downstream extend / upscale nodes read
  // them off THIS node, so an id without its media would point at nothing.
  "sunoTrackId",
  "sunoTaskId",
  "kieTaskId",
  // Echoes of the last run.
  "lastRunOutcome",
  "lastAuditReport",
  "lastSystemPrompt",
  "lastUserPrompt",
  "lastInputType",
  "lastScaleFactor",
  "lastAppliedTransition",
  "lastSlideCount",
  "lastSilent",
  // A scraper's run ledger (components/nodes/web-scrape-run-state.ts). Its own
  // recovery guard reads these — and is asked only AFTER the clear's stamp, so
  // emptying them cannot resurrect an old crawl. What the person chose to LOOK
  // at (`featuredIndex`, `viewFormat`) is theirs and stays.
  "lastRunStartedAt",
  "lastRunFingerprint",
  "lastRunAt",
  "lastRunCount",
  "lastGoodAt",
  "lastGoodCount",
  "lastAppliedJobId",
  // A pending "continue from this stopped job" — the job's result is going away.
  "gvpContinueFromJobId",
  "gvpContinueFromSegment",
  // A use-case node's run (Tighten Episode): the wrapper job and execution its
  // Continue / Render final address — the run they name is going away. (Its
  // plan edit and transcript, `editedEdl` and `generatedTranscript`, and a
  // run's own continuation, `useCaseContinue`, are EXECUTION_DATA_KEYS —
  // cleared from there.)
  "useCaseJobId",
  "useCaseExecutionId",
]

/** Result fields whose NAMES are too generic to clear on every node type. */
export const RUN_RESULT_TYPE_KEYS: Readonly<Record<string, readonly string[]>> = {
  "qa-check": ["score", "approved", "reason"],
  "image-critic": ["score", "approved", "feedback", "details"],
  // The RESULT's pixel size (staleness check). The size a person sets lives in `canvas`.
  "image-overlay": ["width", "height"],
  // The last run's warnings line, its output canvas + length, and the
  // composition it was rendered from (the "Result (old)" check).
  "video-overlay": ["resultCompositionKey", "warnings", "width", "height", "durationSec"],
  // A use-case node's failure code (a refused Render final): its last run's, gone with it.
  "tighten-episode": ["errorCode"],
  "episode-chapters": ["errorCode"],
  // UGC video: each node's last run, always a subset of what publishing strips
  // (UGC_NODE_RUN_STATE_KEYS). UGC Creator's row is the options of its last
  // draw and their note: a kept-result node (the editor's KEPT_RESULT_NODE_TYPES) loses only
  // these and its run state, never the result it hands on.
  "ugc-creator": [UGC_CREATOR_CANDIDATES_KEY, "optionFailed"],
  // A template's example run, shown until the node's own first result (`UGC_EXAMPLE_LINES_KEY`,
  // ugc-template-keep.ts): never configuration, so every other publish strips it and Clear takes it.
  "ugc-script": ["exampleLines"],
  "ugc-clips": ["quote", "result", "__listResults", "ugcOutputs"],
  "ugc-clip": ["warnings", "clipWarnings", "durationSec", "ugcOutputs"],
  "ugc-cards": ["result", "ugcOutputs"],
}

const RESULT_KEYS: ReadonlySet<string> = new Set([
  ...[...EXECUTION_DATA_KEYS].filter((key) => !RUN_RESULT_KEEP_KEYS.has(key)),
  ...RUN_RESULT_EXTRA_KEYS,
])

/** Is `key` a run's result on a node of `type`: a registered result that is not config, an extra output, or the type's own? */
export function isRunResultKey(key: string, type: string | null | undefined): boolean {
  if (RESULT_KEYS.has(key)) return true
  return typeof type === "string" && Object.hasOwn(RUN_RESULT_TYPE_KEYS, type) && RUN_RESULT_TYPE_KEYS[type]!.includes(key)
}
