/**
 * A node's SAVED data — the results it holds in the stored workflow, from the
 * editor or an earlier run — may stand in for its output in a run only when
 * the run gives that node no output of its own on purpose: a source or
 * parameter node (its data IS its value), a node the person froze with Skip,
 * or a node outside a "Run from here" / "Run selected" subset — all seeded
 * through `seededFromSavedData` — or a node with no state at all (a Group /
 * Collect container, or a read made before the run sets up its states). A
 * node the run will execute but has not reached yet is `pending`, so it does
 * NOT qualify: it will have this run's output, or none.
 *
 * A node that RAN in this run, or that a Router GATED in this run, never falls
 * back to saved data. The worker loads the workflow once, so `node.data` is the
 * last save: a fallback there hands a downstream node an old result (last
 * week's recipe to Content Ideas, an old scrape to a digest) with no sign
 * anything is wrong.
 *
 * Every state the run builds FROM saved data goes through `seededFromSavedData`
 * — or, in a run continued from an earlier execution, is that execution's
 * own saved-data seed of a node it did not run, carried over as it was
 * (`continuationSeeds`, run-continuation.ts); a read of saved node data asks
 * `savedDataAllowed` or goes through one of the readers below (or
 * `savedOutputFor` in output-extractor.ts).
 * `__tests__/saved-data-fallback-sites.test.ts` counts, per file, every call of
 * a saved-data reader and every read of a `SAVED_RESULT_FIELDS` field off a
 * node's data in the engine, so a new one fails the build until it is gated
 * and listed. A count cannot tell a gated site swapped for an ungated one in
 * the same file; the reasons in that test are the record of what was checked.
 */
import { extractAllGeneratedResults, extractGeneratedJsonAsList, FAN_OUT_EACH_HANDLES, ownsItsList, rendersLatestBatch, savedRenderBatchUrls } from "@nodaro/shared"
import type { NodeExecutionState, NodeOutput, SimpleNode } from "./types.js"
import { editPlanSavedOutput } from "@nodaro/shared"

/**
 * The fields a run writes onto a node's data as its RESULTS. Reading one off a
 * node's `data` in the engine is reading saved data. Every member is in
 * `EXECUTION_DATA_KEYS` (@nodaro/shared) except `splitResults`, which Split
 * Text writes there without being listed (pinned by the sites test).
 */
export const SAVED_RESULT_FIELDS: ReadonlySet<string> = new Set([
  "generatedImageUrl",
  "generatedVideoUrl",
  "generatedAudioUrl",
  "generatedText",
  "generatedScript",
  "generatedItems",
  "generatedResults",
  "generatedJson",
  "pickedResults",
  "restResults",
  "__pickedResults",
  "__restResults",
  "__listResults",
  "__alignedListResults",
  "outputResults",
  "processedResult",
  "ideaBriefs",
  "splitResults",
  // Edit Plan's review (TA13/TA14): read only through editPlanSavedOutput.
  "editedEdl",
])

/** A state this run builds from the node's saved data (or its own config), not from running it. */
export function seededFromSavedData(output: NodeOutput | undefined): NodeExecutionState {
  return { status: "completed", output, completedAt: new Date().toISOString(), fromSavedData: true }
}

/** True when the node's saved data may stand in for its output in this run. */
export function savedDataAllowed(state: NodeExecutionState | undefined): boolean {
  return state === undefined || state.fromSavedData === true
}

/** The node's saved results (accumulated results, else a saved JSON array), unless this run ran or gated it. */
export function savedListFor(node: SimpleNode, state: NodeExecutionState | undefined): string[] | undefined {
  if (!savedDataAllowed(state)) return undefined
  const data = node.data as Record<string, unknown>
  // An Edit Plan lists its clips as the person's review leaves them (TA13): the
  // PLAN's rows, "" at every dropped clip (TA16). Never the raw plan, and never
  // a `__listResults` an older server run persisted.
  if (node.type === "edit-plan") return editPlanSavedOutput(data)?.listResults
  // A node that runs once per upstream item (Camera Switch per clip) lists its
  // LAST batch — its accumulated history holds earlier runs' items too.
  if (Object.prototype.hasOwnProperty.call(FAN_OUT_EACH_HANDLES, node.type)) {
    const batch = data.__listResults
    return Array.isArray(batch) && batch.length > 0 ? (batch as string[]) : undefined
  }
  // A render whose descriptor says so (Apply EDL) lists its LATEST batch too —
  // the one reader both engines share (TA6). None after a single run: the edge
  // reads its one result.
  if (rendersLatestBatch(node.type)) return savedRenderBatchUrls(data)
  // Extract Field / JSON Process: the list their run produced (Extract Field's
  // JSON value), or none — never a history in generatedResults, which no run
  // of theirs writes (an earlier build's server runs left one).
  if (ownsItsList(node.type)) {
    const own = data.__listResults
    if (Array.isArray(own) && own.length > 0) return own as string[]
    return extractGeneratedJsonAsList(data)
  }
  return extractAllGeneratedResults(data) ?? extractGeneratedJsonAsList(data)
}

/**
 * The list a node holds in this run: its `listResults`; else, for a node this
 * run ran, the JSON array it produced; else (only when allowed) its saved list.
 */
export function listFor(node: SimpleNode, state: NodeExecutionState | undefined): string[] | undefined {
  const listResults = state?.output?.listResults
  if (listResults !== undefined) return listResults
  if (savedDataAllowed(state)) return savedListFor(node, state)
  return jsonArrayItems(state?.output?.json)
}

/** A JSON array as list items, one per element (strings as they are, the rest stringified). */
export function jsonArrayItems(json: unknown): string[] | undefined {
  if (!Array.isArray(json) || json.length === 0) return undefined
  const items = json
    .filter((element) => element !== undefined && element !== null)
    .map((element) => (typeof element === "string" ? element : JSON.stringify(element)))
  return items.length > 0 ? items : undefined
}
