import { editPlanResultPatch, unwrapEditPlanOutput } from "@nodaro/shared"

/**
 * A finished node's JSON result, under the fields its card and its output
 * handles read — ONE mapping for every lane that lands a run's result on a
 * node:
 *   - the live server run (`run-handlers.ts :: syncNodeStatesToStore`),
 *   - the two load-time lanes (`use-workflow-persistence.ts ::
 *     applyBackendExecutionState` for a run still going when the editor
 *     reopens, `applyCompletedExecutionResults` for one that ended while it was
 *     closed),
 *   - a job poll restored after a reload (`run-handlers.ts ::
 *     applyRestoredJobCompletion`), the recovery of a single-node job that
 *     finished while the editor was closed (`reconcile-completed-jobs.ts ::
 *     buildCompletedResultPatch`) and the persisted-run-state lane
 *     (`use-workflow-persistence.ts :: syncNodeResultsFromDB`).
 *
 * In the three lanes that land a server run (the live run and the two
 * load-time lanes), as in the two job restores, a type listed here takes this
 * mapping ONLY — never the lane's generic media / text / list writes — so a
 * server run writes
 * exactly what the node's canvas run writes (decided 2026-10-05). The generic
 * text write used to add a text history to `generatedResults` (and a list of
 * links one entry per link) that no canvas run writes, which the list readers
 * then preferred over the node's own list. `json-run-result-canvas-shape.test.ts`
 * runs each type's real canvas executor and fails on any field a server-run
 * lane writes that it does not.
 *
 * The lanes used to map media URLs, text and a few named outputs and never
 * `json`. So a workflow run (Run, Run from here, a reopen after either) left
 * Edit Plan's plan, Transcribe's transcript and Silence Detect's ranges on the
 * canvas as the last CANVAS run had left them, or empty — and the next Run from
 * here seeded the orchestrator from that stale value, because the server reads
 * these nodes' saved output back from the very fields written here
 * (`output-extractor.ts :: extractSavedNodeOutput`). The canvas run's own write
 * (execute-node.ts) is the shape each type follows.
 *
 * The types whose whole result is json on `generatedJson` are here; Transcribe,
 * whose result is a text AND a json on each take; and three whose result lives
 * under a field of its own (decided 2026-10-05): Describe to Picker's picker
 * json (`generatedPickerJson`), JSON Process's value (`processedResult`) and
 * Extract Field's text, list and json (`extractedText`, `__listResults`,
 * `generatedJson`) — each as its canvas run writes it. Other json producers
 * keep a mapping of their own that already reaches every lane: Camera Switch
 * (`perHandleRunFields`), Apply EDL (`applyEdlRunCutFields`), Content Recipe /
 * Ideas (`contentRunResultPatch`), the scrapers and Social Search
 * (`scrapeServerRunPatch`). The census test (`json-run-result-census.test.ts`)
 * holds every node type whose saved json the server reads against these, from
 * a list a backend test computes.
 */
export const JSON_RUN_RESULT_TYPES: ReadonlySet<string> = new Set([
  "edit-plan",
  "transcribe",
  "silence-detect",
  "audio-sync",
  "video-analysis",
  "video-audit",
  "describe-to-picker",
  "json-process",
  "extract-field",
])

/**
 * The field that says "this node holds a result" — what the saved-output
 * reader reads first (`output-extractor.ts :: extractSavedNodeOutput`).
 * `generatedJson` for every type not listed.
 */
const RESULT_FIELD: Readonly<Record<string, string>> = {
  "describe-to-picker": "generatedPickerJson",
  "json-process": "processedResult",
  "extract-field": "extractedText",
}

export function isJsonRunResultType(nodeType: string | null | undefined): boolean {
  return typeof nodeType === "string" && JSON_RUN_RESULT_TYPES.has(nodeType)
}

/** What a lane reads off a finished run: the orchestrator's node output
 *  (`NodeExecutionState.output`). A job row's `output_data` goes through
 *  {@link jobRunOutput} first. */
export interface JsonRunOutput {
  readonly json?: unknown
  /** Transcribe: the plain transcript. */
  readonly text?: unknown
  /** Transcribe: the detected language (a job row carries it; a node output
   *  does not, and the transcript json does). */
  readonly language?: unknown
  /** Video Audit's fix-and-disclose report. Only a job row carries it — the
   *  orchestrator never promotes it onto the node output (it is node-local UI,
   *  not a graph output). */
  readonly report?: unknown
  /** Extract Field: the newline-joined values (its `text` handle). */
  readonly extractedText?: unknown
  /** JSON Process: the filtered / transformed value. */
  readonly processedResult?: unknown
  /** Extract Field (List) / JSON Process: one item per value. */
  readonly listResults?: unknown
  /** Extract Field (List): the same list, one entry per array element. */
  readonly alignedListResults?: unknown
}

/** The run a Transcribe take records. */
export interface JsonRunTake {
  /** The node's data now — the takes it already holds. */
  readonly data?: Readonly<Record<string, unknown>>
  /** The job the run was. Two landings of one job make one take. */
  readonly jobId?: string
  /** When the run ended (the take's timestamp). */
  readonly timestamp?: string
}

/**
 * A job row's `output_data` as the run's node output — the json half of the
 * backend's `buildNodeOutputFromJobData`. Edit Plan's plan sits at the TOP of
 * its output_data and is unwrapped here, exactly once: `unwrapEditPlanOutput`
 * is not idempotent on a Clips plan's bare `Edl[]` (it would spread it into
 * numeric keys), so it must never run on a node output's `json`.
 */
export function jobRunOutput(nodeType: string | null | undefined, outputData: unknown): JsonRunOutput {
  if (!outputData || typeof outputData !== "object") return {}
  const o = outputData as Record<string, unknown>
  if (nodeType === "edit-plan") return { json: unwrapEditPlanOutput(o) }
  return { json: o.json, text: o.text, language: o.language, report: o.report }
}

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null

/** A Transcribe take, as the canvas run writes it (execute-node.ts). */
interface TranscribeTake {
  readonly text: string
  readonly language: string
  readonly jobId: string
  readonly timestamp: string
  readonly transcript?: unknown
}

function transcribeLanguage(output: JsonRunOutput): string {
  if (typeof output.language === "string" && output.language) return output.language
  const fromJson = isObject(output.json) ? (output.json as { language?: unknown }).language : undefined
  return typeof fromJson === "string" && fromJson ? fromJson : "unknown"
}

/**
 * Transcribe's result: the text, the transcript json, and a TAKE carrying
 * both. The take is what matters most: both engines read a Transcribe's json
 * as the ACTIVE take's `transcript` before `generatedJson`, so a take without
 * one hands the next node whatever an earlier take or the bare field held.
 */
function transcribePatch(output: JsonRunOutput, take: JsonRunTake): Record<string, unknown> | undefined {
  const text = typeof output.text === "string" && output.text.trim() ? output.text : undefined
  const transcript = isObject(output.json) ? output.json : undefined
  if (!text) return transcript ? { generatedJson: transcript } : undefined
  const prev = Array.isArray(take.data?.generatedResults) ? (take.data.generatedResults as TranscribeTake[]) : []
  const jobId = take.jobId ?? ""
  const already = prev.findIndex((r) => (jobId ? r.jobId === jobId : r.text === text))
  const landed: TranscribeTake = {
    text,
    language: transcribeLanguage(output),
    jobId,
    timestamp: take.timestamp ?? new Date().toISOString(),
    ...(transcript ? { transcript } : {}),
  }
  if (already < 0) {
    return { generatedText: text, generatedJson: transcript, generatedResults: [landed, ...prev], activeResultIndex: 0 }
  }
  // This run landed before (a second look at the same run): the node has moved
  // on from it as the person chose, so only the transcript an older landing
  // left off its take is added.
  if (!transcript || prev[already]!.transcript !== undefined) return undefined
  return { generatedResults: prev.map((r, i) => (i === already ? { ...r, transcript } : r)) }
}

const stringList = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined

/**
 * Extract Field, as its canvas run writes it: the text, the list in List mode
 * and the value in JSON mode — the other two cleared, so a mode switched since
 * an earlier run leaves nothing of it behind.
 */
function extractFieldPatch(output: JsonRunOutput): Record<string, unknown> | undefined {
  if (typeof output.extractedText !== "string") return undefined
  return {
    extractedText: output.extractedText,
    __listResults: stringList(output.listResults),
    __alignedListResults: stringList(output.alignedListResults),
    generatedJson: output.json,
  }
}

/** JSON Process, as its canvas run writes it: the value and one item per element. */
function jsonProcessPatch(output: JsonRunOutput): Record<string, unknown> | undefined {
  if (output.processedResult === undefined) return undefined
  return { processedResult: output.processedResult, __listResults: stringList(output.listResults) ?? [] }
}

/**
 * The node-data patch for a finished run's json, or `undefined` for a node
 * type this mapping does not cover and for an output with no result to land.
 * In a lane that lands a server run it is the node's WHOLE result patch (beside
 * the status), never mixed with the lane's generic writes.
 */
export function jsonRunResultPatch(
  nodeType: string | null | undefined,
  output: JsonRunOutput | null | undefined,
  take: JsonRunTake = {},
): Record<string, unknown> | undefined {
  if (!output || !isJsonRunResultType(nodeType)) return undefined
  if (nodeType === "transcribe") return transcribePatch(output, take)
  if (nodeType === "extract-field") return extractFieldPatch(output)
  if (nodeType === "json-process") return jsonProcessPatch(output)
  if (!isObject(output.json)) return undefined
  if (nodeType === "describe-to-picker") {
    // The run's gaps never reach the job row or the node output (the route
    // records them server-side), so an earlier canvas run's are cleared rather
    // than left beside a picker json they do not describe.
    return { generatedPickerJson: output.json, generatedGaps: undefined }
  }
  if (nodeType === "video-audit") {
    // The report travels beside the corrected analysis, so the node never
    // renders a payload with an earlier run's disclosure strip. A node output
    // carries no report: the strip is cleared rather than left stale, and the
    // lanes read it back off the job row (lib/audit-report-recovery.ts).
    return { generatedJson: output.json, lastAuditReport: isObject(output.report) ? output.report : undefined }
  }
  // Edit Plan: a different plan clears the person's review of the old one; the
  // same plan landing again keeps it (decided 2026-10-05). `take.data` is the
  // node's data now, the review included.
  if (nodeType === "edit-plan") return { ...editPlanResultPatch(output.json, take.data?.editedEdl) }
  return { generatedJson: output.json }
}

/**
 * Whether the node already holds a json result — the "fill only what is
 * empty" lane (`applyCompletedExecutionResults`) leaves such a node alone.
 */
export function holdsJsonRunResult(nodeType: string | null | undefined, data: Readonly<Record<string, unknown>>): boolean {
  const field = (typeof nodeType === "string" && RESULT_FIELD[nodeType]) || "generatedJson"
  if (data[field] !== undefined) return true
  if (nodeType !== "transcribe") return false
  const text = data.generatedText
  return (typeof text === "string" && text.trim() !== "") || (Array.isArray(data.generatedResults) && data.generatedResults.length > 0)
}
