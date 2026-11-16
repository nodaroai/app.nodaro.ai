/**
 * B-roll: short cutaway shots made in Nodaro for the moments that need them
 * (about one every 25 seconds), generated while the other agents work, then
 * dragged onto a track above the video a moment before the words they
 * illustrate, each moving a little (in, out, or across). Cut later, they are
 * cut with the speech under them. Asked again, new shots replace the old.
 *
 * The run keeps what it knows about each picture (its words, what it shows,
 * and why one was not made), so the panel can list them and change one.
 */
import { generateImage } from "@/lib/api"
import { readTimelineView, timelineFrameOf, type ItemTransform } from "../edit-plan"
import type { EditorLink } from "../editor-link"
import { DEFAULT_PICTURE_PLACE, pictureAspect, speakerCopiesOf, type PicturePlace } from "../picture-place"
import { PICTURE_FILE, PICTURE_LEAD_SECONDS, pictureFileBase, pictureSeconds, type PictureRecord } from "../picture-rows"
import type { RunContext } from "./context"
import type { CreativeChoices } from "./creative"
import { JobFailed, checkStop, pause } from "./jobs"
import { applyThrough, arrangePicture, type ApplyOps } from "./place-picture"

/** The image model b-roll is made with: quick, photoreal, and its price is read from the platform. */
export const BROLL_IMAGE_MODEL = "nano-banana-2-lite"
export const BROLL_IMAGE_TIMEOUT_MS = 4 * 60_000
/** Each shot moves a little, and not all the same way. */
const MOTIONS = ["push", "pull", "panLeft", "panRight"] as const
export type PictureMotion = (typeof MOTIONS)[number]

/** The move of the nth picture. */
export const motionOf = (n: number): PictureMotion => MOTIONS[((n % MOTIONS.length) + MOTIONS.length) % MOTIONS.length]!

/** The fewest and the most pictures a run makes, and the most it makes unless the person asks for more. */
export const BROLL_MIN_SHOTS = 1
export const BROLL_MAX_SHOTS = 40
const BROLL_DEFAULT_MOST = 20
/** A picture about every seven and a half seconds: four in half a minute, eight in a minute. */
const SECONDS_A_PICTURE = 7.5

/** How many pictures a video of this length gets unless the person chooses: 4 for half a minute, 8 for a minute, at most 20. */
export function brollShots(seconds: number): number {
  return Math.min(BROLL_DEFAULT_MOST, Math.max(2, Math.round(seconds / SECONDS_A_PICTURE)))
}

/** The number of pictures to make: the person's own when they chose one, else the length's. */
export const brollCount = (seconds: number, chosen?: number | null): number =>
  chosen === undefined || chosen === null ? brollShots(seconds) : Math.min(BROLL_MAX_SHOTS, Math.max(BROLL_MIN_SHOTS, Math.round(chosen)))

/** One picture's image job, in the shape of its part of the frame. */
export const startPictureJob = (prompt: string, aspect: string, userId: string) => generateImage(prompt, undefined, BROLL_IMAGE_MODEL, undefined, aspect, userId)

/** Why a picture's job failed, when the platform said so in a sentence (a refusal, a block); a bare status says nothing. */
export const failureWords = (error: unknown): string | undefined => (error instanceof JobFailed && /\s/.test(error.message.trim()) ? error.message.trim() : undefined)

export interface Shot {
  readonly choice: CreativeChoices["broll"][number]
  readonly url: string | null
  /** Why it was not made, when the platform said. */
  readonly reason?: string
}

/** The shots, all generated at once, each in the shape of its part of the frame; each promise settles when its image is ready (or failed). */
export function makeShots(ctx: RunContext, choices: CreativeChoices["broll"], portrait: boolean): Array<Promise<Shot>> {
  const aspect = pictureAspect(portrait ? { width: 9, height: 16 } : { width: 16, height: 9 }, DEFAULT_PICTURE_PLACE)
  return choices.map((choice) =>
    ctx.jobs.run(() => startPictureJob(choice.prompt, aspect, ctx.userId), BROLL_IMAGE_TIMEOUT_MS).then(
      (output) => ({ choice, url: typeof output.imageUrl === "string" ? output.imageUrl : null }),
      (error: unknown) => {
        const reason = failureWords(error)
        return { choice, url: null, ...(reason ? { reason } : {}) }
      },
    ),
  )
}

/** The keyframes of one shot's move, from its first frame to its last. */
export function motionOps(itemId: string, base: ItemTransform, motion: PictureMotion, last: number): Array<Record<string, unknown>> {
  const key = (property: string, frame: number, value: number) => ({ op: "addKeyframe", itemId, property, frame, value: Math.round(value), easing: "ease-in-out" })
  const big = { width: base.width * 1.1, height: base.height * 1.1 }
  switch (motion) {
    case "push":
      return [key("width", 0, base.width), key("height", 0, base.height), key("width", last, big.width), key("height", last, big.height)]
    case "pull":
      return [key("width", 0, big.width), key("height", 0, big.height), key("width", last, base.width), key("height", last, base.height)]
    case "panLeft":
    case "panRight": {
      const shift = base.width * 0.04 * (motion === "panLeft" ? 1 : -1)
      return [key("width", 0, big.width), key("height", 0, big.height), key("x", 0, base.x + shift), key("x", last, base.x - shift)]
    }
  }
}

export interface BrollOutcome {
  readonly placed: number
  readonly failed: number
  readonly refused?: string
  /** What the run knows about each picture: the ones laid, and the ones that were not made. */
  readonly pictures: readonly PictureRecord[]
}

export const extensionOf = (type: string) => (type.includes("jpeg") ? "jpg" : type.includes("webp") ? "webp" : "png")

/** A picture's bytes, from where the platform stored it; null when it cannot be read. */
export async function pictureBytes(url: string, signal: AbortSignal): Promise<{ readonly type: string; readonly buffer: ArrayBuffer } | null> {
  const response = await fetch(url, { signal }).catch(() => null)
  if (!response?.ok) return null
  return { type: response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png", buffer: await response.arrayBuffer() }
}

export interface LayPicture {
  /** The undo entry's label. */
  readonly label: string
  /** The file's name in the editor, without its extension (`pictureFileBase`). */
  readonly base: string
  readonly type: string
  readonly buffer: ArrayBuffer
  /** Timeline frames. */
  readonly from: number
  readonly frames: number
  /** Clips it takes the place of. */
  readonly replace?: readonly string[]
  /** Where it shows in the frame, and the video it lies over. */
  readonly place: PicturePlace
  readonly mediaId: string
  readonly motion: PictureMotion
  readonly onRecorded?: () => void
}

/**
 * One picture laid over the video by the panel after a run (a picture made
 * again, or the person's own): its file handed to the editor, laid above the
 * video in place of the clips it replaces, then shown where it belongs in the frame.
 */
export async function layPicture(editor: EditorLink, lay: LayPicture): Promise<{ readonly ok: boolean; readonly reason?: string; readonly place?: PicturePlace }> {
  editor.importFile(lay.base, `${lay.base}.${extensionOf(lay.type)}`, lay.type, lay.buffer)
  const applied = await editor.applyOps(lay.label, [
    ...(lay.replace && lay.replace.length > 0 ? [{ op: "removeItems", ids: lay.replace }] : []),
    { op: "placeMedia", ref: lay.base, from: lay.from, durationInFrames: lay.frames, fit: "cover" },
  ])
  if (!applied.ok) return { ok: false, reason: applied.error?.message }
  if (applied.recorded !== false) lay.onRecorded?.()
  const placed = applied.results?.find((r) => r && typeof r === "object" && "id" in r) as { id?: string } | undefined
  const timeline = readTimelineView(applied.timeline) ?? readTimelineView(await editor.getTimeline())
  if (!timeline || !placed?.id) return { ok: true }
  const apply = applyThrough((ops) => editor.applyOps(lay.label, ops), () => editor.getTimeline(), (recorded) => recorded && lay.onRecorded?.())
  const arranged = await arrangePicture(apply, timeline, { pictureId: placed.id, mediaId: lay.mediaId, place: lay.place, motion: lay.motion })
  return arranged.ok ? { ok: true, place: arranged.place } : { ok: false, reason: arranged.reason }
}

/** The B-roll agent's turn: each shot, in order, dragged from the media bin onto the words, then played. */
export async function placeShots(ctx: RunContext, shots: ReadonlyArray<Promise<Shot>>): Promise<BrollOutcome> {
  if (shots.length === 0) return { placed: 0, failed: 0, pictures: [] }
  ctx.working("broll", true)
  const total = shots.length
  let ready = 0
  shots.forEach((s) => void s.then(() => (ready += 1)))
  let placed = 0
  let failed = 0
  let refused: string | undefined
  const pictures: PictureRecord[] = []
  const stamp = Date.now().toString(36)
  // Each picture is shown where it belongs through the run's own requests: one undo label, the timeline kept current.
  const apply: ApplyOps = async (ops) => {
    if (ops.length === 0) return { ok: true, timeline: null }
    const out = await ctx.apply("broll", ops)
    return out.ok ? { ok: true, results: out.result.results, timeline: ctx.timeline } : { ok: false, timeline: null, reason: out.reason }
  }
  // Asked again, the new shots take the place of the earlier ones.
  const named = new Set((ctx.timeline.media ?? []).filter((m) => m.fileName && PICTURE_FILE.test(m.fileName)).map((m) => m.id))
  const earlierPictures = ctx.timeline.items.filter((i) => i.mediaId && named.has(i.mediaId))
  // With each earlier picture goes the speaker's copy laid beside it.
  let earlier = [...earlierPictures.map((i) => i.id), ...earlierPictures.flatMap((p) => speakerCopiesOf(ctx.timeline, p).map((c) => c.id))]

  for (const [n, pending] of shots.entries()) {
    for (;;) {
      // Real time, whatever the show's pace: this waits on the images, not on the show.
      const done = await Promise.race([pending.then(() => true), pause(700, ctx.signal).then(() => false)])
      ctx.show.progress("broll", "panel.media", ready / total, ctx.say("freecutAi.note.generating", { done: ready, total }))
      ctx.step("broll", "working", "freecutAi.generating", { done: ready, total }, 0.1 + (0.5 * ready) / total)
      if (done) break
    }
    const { choice, url, reason } = await pending
    checkStop(ctx.signal)
    const base = pictureFileBase(false, stamp, n + 1)
    const record: PictureRecord = { id: base, label: choice.label, said: choice.sentence.text, prompt: choice.prompt, start: choice.start, end: choice.end, mediaId: ctx.mediaId }
    const notMade = (why?: string) => {
      failed += 1
      pictures.push({ ...record, failed: true, ...(why ? { reason: why } : {}) })
    }
    const at = timelineFrameOf(ctx.timeline, ctx.mediaId, Math.max(0, choice.start - PICTURE_LEAD_SECONDS)) ?? timelineFrameOf(ctx.timeline, ctx.mediaId, choice.start)
    // Its words were cut away: nothing to lay it over, and nothing to list.
    if (!at) {
      failed += 1
      continue
    }
    const image = url ? await pictureBytes(url, ctx.signal) : null
    if (!image) {
      notMade(reason)
      continue
    }
    ctx.link.importFile(base, `${base}.${extensionOf(image.type)}`, image.type, image.buffer)

    const duration = Math.round(pictureSeconds(choice.start, choice.until) * ctx.fps)
    ctx.link.playback("seek", at.frame)
    await ctx.show.drag("broll", { target: "panel.media" }, { frame: at.frame, trackId: at.trackId }, choice.label || `#${placed + 1}`, 850)
    // The editor lays each shot right above the video and under the captions, on a track with room.
    const applied = await ctx.apply("broll", [
      ...(earlier.length > 0 ? [{ op: "removeItems", ids: earlier }] : []),
      { op: "placeMedia", ref: base, from: at.frame, durationInFrames: duration, fit: "cover" },
    ])
    earlier = []
    if (!applied.ok) {
      refused = applied.reason
      notMade()
      continue
    }
    const placedItem = applied.result.results?.find((r) => r && typeof r === "object" && "id" in r) as { id?: string } | undefined
    // Beside the speaker by default; a moment the speaker layout shows in parts keeps them, and the picture fills the frame.
    if (placedItem?.id) {
      const arranged = await arrangePicture(apply, ctx.timeline, { pictureId: placedItem.id, mediaId: ctx.mediaId, place: DEFAULT_PICTURE_PLACE, motion: motionOf(placed) })
      if (!arranged.ok) refused = arranged.reason
    }
    placed += 1
    pictures.push({ ...record, ...(url ? { url } : {}) })
    ctx.feed("broll", "freecutAi.placedBroll", { label: choice.label || String(placed) })
    ctx.step("broll", "working", "freecutAi.placingBroll", { done: placed, total }, 0.6 + (0.4 * placed) / total)
    await ctx.preview(at.frame, 1400)
  }
  ctx.working("broll", false)
  return { placed, failed, refused, pictures }
}
