/**
 * The measurement a workflow run makes for a Speaker View fed a bare video
 * (decided 2026-10-11, D16): the clip's real length and size, once, here,
 * because the payload builder is synchronous and the canvas engine reaches the
 * same number through `POST /v1/media/clip-length` — one measurement
 * (`measureClip`), both engines.
 *
 * Everything that costs nothing is asked FIRST, so a run that is refused
 * anyway never downloads a file: video mode not live yet (R15, Speaker View
 * AND Speaker Frames priced), and the transcript the video
 * mode requires. When one of those would refuse the run, nothing is measured
 * and the builder refuses with its own words.
 */
import { speakerViewVideoModeLive, speakerViewVideoTranscriptIssue, type SpeakerViewClipFacts } from "@nodaro/render-rules"
import { ClipMeasureError, measureClip, type MeasuredClip } from "./clip-measure.js"

export interface SpeakerViewClipRunDeps {
  /** Whether video mode may run (`speakerViewVideoModeLive`, R15). */
  readonly videoModeLive: () => boolean
  readonly measure: (url: string) => Promise<MeasuredClip>
}

const defaultDeps: SpeakerViewClipRunDeps = { videoModeLive: () => speakerViewVideoModeLive(), measure: (url) => measureClip(url) }

const blank = (v: unknown) => v === undefined || v === null || v === ""

const parse = (v: unknown): unknown => {
  if (typeof v !== "string") return v
  try { return JSON.parse(v) } catch { return v }
}

/**
 * The clip facts for a Speaker View's resolved inputs, or undefined when there
 * is nothing to measure (no video, or an edit wired beside it, or a refusal the
 * builder makes first). Throws with the measurement's sentence when the clip
 * cannot be measured.
 */
export async function speakerViewClipOfRun(
  inputs: {
    readonly edl?: unknown
    /** The node's own `data.edl`: the payload builder reads it as an edit too, so it counts as one wired beside the video. */
    readonly inlineEdl?: unknown
    readonly videoUrl?: unknown
    readonly transcript?: unknown
  },
  deps: SpeakerViewClipRunDeps = defaultDeps,
): Promise<SpeakerViewClipFacts | undefined> {
  const url = typeof inputs.videoUrl === "string" ? inputs.videoUrl.trim() : ""
  if (!url || !blank(inputs.edl) || !blank(inputs.inlineEdl)) return undefined
  if (!deps.videoModeLive()) return undefined
  if (speakerViewVideoTranscriptIssue(blank(inputs.transcript) ? undefined : parse(inputs.transcript))) return undefined
  try {
    return await deps.measure(url)
  } catch (err) {
    if (err instanceof ClipMeasureError) throw new Error(`speaker-view: ${err.message}`)
    throw err
  }
}
