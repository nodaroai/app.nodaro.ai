/**
 * A finished node's NAMED side outputs, under the keys its card and its output
 * handles read.
 *
 * Three places paint an orchestrator's `node_states` output onto a canvas node:
 * the live run (`run-handlers.ts :: syncNodeStatesToStore`) and the two
 * load-time lanes in `use-workflow-persistence.ts` (an execution still running
 * when the editor reopens; one that finished while it was closed). Each used to
 * spell these fields by hand, and the two load-time lanes spelled four of them
 * differently from everything that READS them — `generatedVocalUrl` for
 * `vocalUrl`, and so on (#1547). A run that finished with the tab closed came
 * back with its vocals, instrumental, alignment and split items invisible: on
 * the card, and on the handles that feed the next node.
 *
 * One function, three callers: a new named output is added here once and is
 * right everywhere, or wrong everywhere — never right live and lost on reload.
 */
export interface NamedRunOutputs {
  readonly generatedVoiceId?: string
  readonly vocalUrl?: string
  readonly instrumentalUrl?: string
  readonly alignment?: unknown
  readonly combinedText?: string
  readonly splitResults?: readonly string[]
}

export function namedRunOutputFields(output: NamedRunOutputs): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  if (output.generatedVoiceId) fields.generatedVoiceId = output.generatedVoiceId
  if (output.vocalUrl) fields.vocalUrl = output.vocalUrl
  if (output.instrumentalUrl) fields.instrumentalUrl = output.instrumentalUrl
  if (output.alignment) fields.alignmentResults = output.alignment
  // A Combine Text card reads `combinedText`; its `text` handle reads `generatedText`.
  if (output.combinedText) {
    fields.combinedText = output.combinedText
    fields.generatedText = output.combinedText
  }
  if (output.splitResults) fields.splitResults = output.splitResults
  return fields
}

/** Choose Best's run output: the winner and the strategy's meta. */
export interface ReduceRunOutput {
  readonly result?: unknown
  readonly reduceMeta?: Record<string, unknown>
}

/**
 * Choose Best (reduce): the orchestrator reports the winner as `result` (+ the
 * strategy's meta), under the fields the single-node Run writes
 * (execute-node.ts). The same three lanes call it, so a reopen never sets the
 * node completed with no winner on it.
 */
export function reduceRunOutputFields(nodeType: string | null | undefined, output: ReduceRunOutput): Record<string, unknown> {
  if (nodeType !== "reduce" || typeof output.result !== "string") return {}
  return output.reduceMeta ? { result: output.result, lastMeta: output.reduceMeta } : { result: output.result }
}

/** Split into Chunks' run output: its parts, one list per pip. */
export interface SplitMediaRunOutput {
  readonly videoUrls?: readonly string[]
  readonly audioUrls?: readonly string[]
}

/**
 * Split into Chunks: the orchestrator reports its parts as `videoUrls` /
 * `audioUrls`, painted under the fields the single-node Run writes and every
 * reader uses (`generatedVideoUrls` / `generatedAudioUrls`). Without it a
 * server run left the node's parts on the run only — the card showed none and
 * a later run from the canvas had none to hand on. Both fields are written
 * (an absent list clears an earlier run's), and only on this node type.
 */
export function splitMediaRunOutputFields(nodeType: string | null | undefined, output: SplitMediaRunOutput): Record<string, unknown> {
  if (nodeType !== "split-media") return {}
  return { generatedVideoUrls: output.videoUrls ? [...output.videoUrls] : undefined, generatedAudioUrls: output.audioUrls ? [...output.audioUrls] : undefined }
}
