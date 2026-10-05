/**
 * Apply EDL renders ONE cut per run — video or audio, by its `output` setting —
 * and its saved node must hold exactly that cut.
 *
 * Both engines treat the node as video whenever `generatedVideoUrl` is set (the
 * server's saved-data path reads it first; the canvas resolver routes the media
 * handle as video when it is set). Its result history survives an Output
 * switch, so a node rendered as video and then switched to audio still holds
 * that earlier video's URL. A write that lands an audio take without clearing
 * it splits the engines: a workflow run hands the OLD video downstream, the
 * canvas routes the NEW audio as video, and an audio consumer gets nothing.
 *
 * So every write of a cut — a run's result landing on the node (live or
 * restored on load) and a pick in the results gallery — sets its medium's field
 * and clears the other one. A canvas run already clears both when it starts.
 *
 * The cut's Transcript output moves with it. A render remaps the wired
 * transcript through ITS cut (`output_data.json`); captions downstream time
 * their words by the node's Transcript output (`generatedJson`), so it must be
 * the transcript of the cut the node holds — never one an earlier take left, or
 * one a pick's late job read wrote before this render landed. A run that lands
 * a render sets it to that render's, and CLEARS it when the render was cut with
 * no transcript wired. The landed take keeps the same value on its result, so a
 * later pick restores it with no job read (lib/apply-edl-take-transcript.ts).
 */

export type ApplyEdlMedium = "video" | "audio"

/** The saved field of each medium. */
export const APPLY_EDL_MEDIA_FIELD = {
  video: "generatedVideoUrl",
  audio: "generatedAudioUrl",
} as const satisfies Record<ApplyEdlMedium, string>

const OTHER: Record<ApplyEdlMedium, ApplyEdlMedium> = { video: "audio", audio: "video" }

/** The medium the node renders: its `output` field, video when absent (the
 *  node's default). */
export function applyEdlMedium(data: Readonly<Record<string, unknown>>): ApplyEdlMedium {
  return data.output === "audio" ? "audio" : "video"
}

/** The node-data fields that make `url` the node's one cut, as `medium`. */
export function applyEdlCutFields(medium: ApplyEdlMedium, url: string): Record<string, string | undefined> {
  return { [APPLY_EDL_MEDIA_FIELD[medium]]: url, [APPLY_EDL_MEDIA_FIELD[OTHER[medium]]]: undefined }
}

/** What a run-result lane reads off a finished render: the job's output_data
 *  or the orchestrator's node output, the same keys in both. */
export interface ApplyEdlRunOutput {
  readonly videoUrl?: unknown
  readonly audioUrl?: unknown
  /** The wired transcript remapped through this render's cut; absent when
   *  none was wired. */
  readonly json?: unknown
}

/** The render an output describes: its one medium and that medium's URL, or
 *  `undefined` for an output that names no medium or (never from Apply EDL)
 *  both. */
function renderedCut(output: ApplyEdlRunOutput | null | undefined): { medium: ApplyEdlMedium; url: string } | undefined {
  if (!output) return undefined
  const video = typeof output.videoUrl === "string" && output.videoUrl !== "" ? output.videoUrl : undefined
  const audio = typeof output.audioUrl === "string" && output.audioUrl !== "" ? output.audioUrl : undefined
  if (video !== undefined && audio === undefined) return { medium: "video", url: video }
  if (audio !== undefined && video === undefined) return { medium: "audio", url: audio }
  return undefined
}

/**
 * For the lanes that write a run's result onto a node: when an Apply EDL run
 * produced one medium, the rest of that render's cut — the other medium's field
 * cleared, and the Transcript output set to the one the render was cut with, or
 * cleared (`undefined`) when it was cut with none. Spread it AFTER the lane's
 * own media writes. `undefined` for every other node type, and for an output
 * that names no medium or (never from Apply EDL) both.
 */
export function applyEdlRunCutFields(
  nodeType: string | null | undefined,
  output: ApplyEdlRunOutput | null | undefined,
): Record<string, unknown> | undefined {
  if (nodeType !== "apply-edl") return undefined
  const cut = renderedCut(output)
  if (!cut) return undefined
  return { [APPLY_EDL_MEDIA_FIELD[OTHER[cut.medium]]]: undefined, generatedJson: output?.json ?? undefined }
}

/**
 * For the lanes that add a run's render to the node's results: what the take
 * whose file is `url` keeps — the Transcript its render was cut with, as an own
 * `generatedJson` (`undefined` when it was cut with none), so a later pick
 * restores it with no job read. Only on the take that IS the render the output
 * describes: a list run lands several takes from one output, which carries its
 * first render's transcript only (the server's fan-out spreads that render's
 * output beside every URL), so the other takes keep none rather than another
 * cut's. `undefined` for every other node type and every other take.
 */
export function applyEdlTakeTranscriptField(
  nodeType: string | null | undefined,
  output: ApplyEdlRunOutput | null | undefined,
  url: string | null | undefined,
): { readonly generatedJson: unknown } | undefined {
  if (nodeType !== "apply-edl") return undefined
  const cut = renderedCut(output)
  if (!cut || cut.url !== url) return undefined
  return { generatedJson: output?.json ?? undefined }
}
