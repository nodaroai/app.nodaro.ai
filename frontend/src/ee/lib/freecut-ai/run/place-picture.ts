/**
 * One picture on the words shown where it belongs in the frame (beside the
 * speaker, in a window, or filling the frame), sent to the editor. Used by the
 * run for each picture it lays, and by the panel when the person changes one.
 *
 * Beside the speaker: the footage under the picture is cut at the picture's
 * two ends (a cut that changes nothing), a silent copy of that stretch is
 * cropped to the speaker and placed in one half, and the picture takes the
 * other. A moment the speaker layout already shows in several parts keeps its
 * parts: there the picture fills the frame instead.
 */
import { readTimelineView, type TimelineItemView, type TimelineView } from "../edit-plan"
import { coverRegion, pictureSlots, slotOps, speakerCopiesOf, speakerRegion, visibleRegion, type Canvas, type PicturePlace, windowCornerRadius } from "../picture-place"
import { motionOps, type PictureMotion } from "./broll"

/** Sends edits to the editor and answers with the timeline after them. */
export type ApplyOps = (ops: ReadonlyArray<Record<string, unknown>>) => Promise<{ readonly ok: boolean; readonly results?: readonly unknown[]; readonly timeline: TimelineView | null; readonly reason?: string }>

export interface ArrangePicture {
  /** The picture's clip. */
  readonly pictureId: string
  /** The video it lies over, as the editor knows it. */
  readonly mediaId: string
  readonly place: PicturePlace
  /** Its small move, when it fills the frame. */
  readonly motion: PictureMotion
}

export interface Arranged {
  readonly ok: boolean
  /** How it shows now: `full` when it was asked beside the speaker and the moment could not be split. */
  readonly place?: PicturePlace
  readonly reason?: string
}

const sizeOf = (item: TimelineItemView): Canvas | null => (item.transform && item.transform.width > 0 && item.transform.height > 0 ? { width: item.transform.width, height: item.transform.height } : null)

const within = (item: TimelineItemView, from: number, to: number) => item.from >= from && item.from + item.durationInFrames <= to

const overlaps = (item: TimelineItemView, from: number, to: number) => item.from < to && item.from + item.durationInFrames > from

/** The footage clips of the video under a stretch; null when some moment of it shows the video more than once (a speaker layout). */
function footageUnder(view: TimelineView, mediaId: string, from: number, to: number, ignore: ReadonlySet<string>): TimelineItemView[] | null {
  const clips = view.items.filter((i) => i.type === "video" && i.mediaId === mediaId && !ignore.has(i.id) && overlaps(i, from, to)).sort((a, b) => a.from - b.from)
  if (clips.length === 0) return null
  for (let i = 1; i < clips.length; i += 1) if (clips[i]!.from < clips[i - 1]!.from + clips[i - 1]!.durationInFrames) return null
  return clips
}

/** Shows one picture as asked. Every request goes through `apply`, so they share the caller's undo label. */
export async function arrangePicture(apply: ApplyOps, view: TimelineView, request: ArrangePicture): Promise<Arranged> {
  let timeline = view
  const send = async (ops: ReadonlyArray<Record<string, unknown>>) => {
    const out = await apply(ops)
    if (out.timeline) timeline = out.timeline
    return out
  }
  const canvas: Canvas | null = timeline.width !== undefined && timeline.height !== undefined ? { width: timeline.width, height: timeline.height } : null
  const picture = () => timeline.items.find((i) => i.id === request.pictureId)
  const first = picture()
  // An editor that does not say its frame's size: the picture stays as it was laid.
  if (!first || !canvas) return { ok: true, place: "full" }
  const from = first.from
  const to = first.from + first.durationInFrames

  // The speaker's copies from an earlier arrangement go first.
  const earlier = speakerCopiesOf(timeline, first).map((i) => i.id)
  if (earlier.length > 0) {
    const removed = await send([{ op: "removeItems", ids: earlier }])
    if (!removed.ok) return { ok: false, reason: removed.reason }
  }

  let place = request.place
  const ops: Array<Record<string, unknown>> = []
  if (place === "split") {
    const footage = footageUnder(timeline, request.mediaId, from, to, new Set())
    if (!footage) {
      place = "full"
    } else {
      const frames = [from, to].filter((frame) => footage.some((clip) => frame > clip.from && frame < clip.from + clip.durationInFrames))
      if (frames.length > 0) {
        const cut = await send([{ op: "splitItems", ids: footage.map((clip) => clip.id), frames }])
        if (!cut.ok) return { ok: false, reason: cut.reason }
      }
      const pieces = (footageUnder(timeline, request.mediaId, from, to, new Set()) ?? []).filter((clip) => within(clip, from, to))
      if (pieces.length === 0) {
        place = "full"
      } else {
        const copied = await send([{ op: "duplicateItems", ids: pieces.map((clip) => clip.id) }])
        if (!copied.ok) return { ok: false, reason: copied.reason }
        const made = copied.results?.find((r) => r && typeof r === "object" && Array.isArray((r as { copies?: unknown }).copies)) as { copies: Array<{ of: string; id: string }> } | undefined
        const slot = pictureSlots(canvas, "split").speaker!
        for (const copy of made?.copies ?? []) {
          const piece = pieces.find((clip) => clip.id === copy.of)
          const size = piece ? sizeOf(piece) : null
          if (!piece?.transform || !size) continue
          ops.push(...slotOps(copy.id, speakerRegion(visibleRegion(piece.transform, canvas), slot, size), slot, size, canvas))
        }
      }
    }
  }

  const now = picture()
  const size = now ? sizeOf(now) : null
  if (!now || !size) return { ok: true, place }
  const slot = pictureSlots(canvas, place, size.width / size.height).picture
  ops.push(...slotOps(now.id, coverRegion(size, slot), slot, size, canvas, place === "window" ? windowCornerRadius(canvas) : 0))
  const placed = await send(ops)
  if (!placed.ok) return { ok: false, reason: placed.reason }
  if (place === "full") {
    const filled = picture()
    if (filled?.transform) await send(motionOps(filled.id, filled.transform, request.motion, Math.max(1, filled.durationInFrames - 1)))
  }
  return { ok: true, place }
}

/** `ApplyOps` over an editor request that answers `{ ok, results, timeline, error }`. */
export const applyThrough =
  (request: (ops: ReadonlyArray<Record<string, unknown>>) => Promise<{ readonly ok: boolean; readonly results?: readonly unknown[]; readonly timeline?: unknown; readonly error?: { readonly message: string } }>, reread: () => Promise<unknown>, onOk?: (recorded: boolean) => void): ApplyOps =>
  async (ops) => {
    if (ops.length === 0) return { ok: true, timeline: null }
    const out = await request(ops)
    if (!out.ok) return { ok: false, timeline: null, reason: out.error?.message }
    onOk?.((out as { recorded?: boolean }).recorded !== false)
    return { ok: true, results: out.results, timeline: readTimelineView(out.timeline) ?? readTimelineView(await reread()) }
  }
