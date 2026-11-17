/**
 * One picture on the words changed after a run, as the person chose: made
 * again from other words, replaced by a picture of their own, shown another
 * way or for another length, or taken off; and a picture added by hand at the
 * playhead. Each is an edit like the rest, under one label, undone with them.
 */
import { readTimelineView, type TimelineView } from "../edit-plan"
import type { EditorLink } from "../editor-link"
import { DEFAULT_PICTURE_PLACE, pictureAspect, placeOf, speakerCopiesOf, videoUnder, type PicturePlace } from "../picture-place"
import { PICTURE_FILE, pictureFileBase, type PictureRecord, type PictureRow } from "../picture-rows"
import { BROLL_IMAGE_TIMEOUT_MS, failureWords, layPicture, motionOf, pictureBytes, startPictureJob } from "./broll"
import { RunJobs } from "./jobs"
import { applyThrough, arrangePicture } from "./place-picture"

/** The shortest and the longest a picture stays, and how long one added by hand stays, in seconds. */
export const PICTURE_SHORTEST_SECONDS = 1
export const PICTURE_LONGEST_SECONDS = 10
export const PICTURE_ADDED_SECONDS = 2.5

export type PictureChoice =
  /** Made again: what it shows, in the person's words. */
  | { readonly kind: "again"; readonly prompt: string }
  /** The person's own picture. */
  | { readonly kind: "mine"; readonly file: File }
  /** Shown another way: beside the speaker, in a window, or filling the frame. */
  | { readonly kind: "place"; readonly place: PicturePlace }
  /** Shown for another length. */
  | { readonly kind: "length"; readonly seconds: number }
  | { readonly kind: "remove" }

/** Where a new picture comes from: made from words, or the person's own. */
export type PictureSourceChoice = Extract<PictureChoice, { readonly kind: "again" | "mine" }>

export interface PictureChangeRequest {
  readonly label: string
  readonly row: PictureRow
  readonly choice: PictureChoice
  readonly userId: string
  readonly signal: AbortSignal
  /** One undo entry was made under the label. */
  readonly onRecorded: () => void
}

export type PictureChangeResult =
  /** The picture is on the timeline (or off it); `record` is what the panel now knows about it. */
  | { readonly ok: true; readonly record?: PictureRecord; readonly forget?: string; /** Asked beside the speaker, it fills the frame: that moment already shows several parts. */ readonly filled?: boolean }
  /** The editor refused, in its own words. */
  | { readonly ok: false; readonly refused: string | undefined }
  /** The picture was not made; `reason` is the platform's sentence when it gave one. */
  | { readonly ok: false; readonly notMade: true; readonly reason?: string }
  /** A picture added by hand has no room: another picture already shows at the playhead. */
  | { readonly ok: false; readonly taken: true }

type Got = { readonly image: { readonly type: string; readonly buffer: ArrayBuffer }; readonly url?: string } | { readonly notMade: true; readonly reason?: string }

/** The picture's bytes: the person's file, or an image made from their words (a refusal is an answer, not an error). */
async function getPicture(choice: PictureSourceChoice, aspect: "1:1" | "9:16" | "16:9", userId: string, signal: AbortSignal): Promise<Got> {
  if (choice.kind === "mine") return { image: { type: choice.file.type || "image/png", buffer: await choice.file.arrayBuffer() } }
  const jobs = new RunJobs(signal)
  try {
    const output = await jobs.run(() => startPictureJob(choice.prompt, aspect, userId), BROLL_IMAGE_TIMEOUT_MS)
    const url = typeof output.imageUrl === "string" ? output.imageUrl : undefined
    const image = url ? await pictureBytes(url, signal) : null
    return image ? { image, url } : { notMade: true }
  } catch (error) {
    const reason = failureWords(error)
    // A refusal is an answer about this picture; anything else (no credits, signed out) is the caller's to say.
    if (reason) return { notMade: true, reason }
    throw error
  } finally {
    jobs.end()
  }
}

/** The pictures the panel laid that are on the timeline. */
function picturesOn(view: TimelineView) {
  const files = new Set((view.media ?? []).filter((m) => m.fileName && PICTURE_FILE.test(m.fileName)).map((m) => m.id))
  return view.items.filter((i) => i.mediaId && files.has(i.mediaId))
}

/** Applies the change. Throws what a job or the editor throws (no credits, signed out, no answer). */
export async function applyPictureChange(editor: EditorLink, request: PictureChangeRequest): Promise<PictureChangeResult> {
  const { row, choice } = request
  const view = readTimelineView(await editor.getTimeline())
  const item = row.itemId ? view?.items.find((i) => i.id === row.itemId) : undefined
  // The speaker's copy laid beside a picture goes with it.
  const beside = view && item ? speakerCopiesOf(view, item).map((i) => i.id) : []
  const mediaId = row.record?.mediaId ?? (view ? videoUnder(view, row.from) : null)
  const motion = motionOf(Math.round(row.from))
  const apply = applyThrough((ops) => editor.applyOps(request.label, ops), () => editor.getTimeline(), (recorded) => recorded && request.onRecorded())
  if (choice.kind === "remove") {
    if (!row.itemId) return { ok: true, ...(row.record ? { forget: row.record.id } : {}) }
    const removed = await editor.applyOps(request.label, [{ op: "removeItems", ids: [row.itemId, ...beside] }])
    if (!removed.ok) return { ok: false, refused: removed.error?.message }
    if (removed.recorded !== false) request.onRecorded()
    return { ok: true, ...(row.record ? { forget: row.record.id } : {}) }
  }

  if (choice.kind === "place") {
    if (!view || !item || !mediaId) return { ok: true }
    const arranged = await arrangePicture(apply, view, { pictureId: item.id, mediaId, place: choice.place, motion })
    if (!arranged.ok) return { ok: false, refused: arranged.reason }
    return { ok: true, ...(choice.place === "split" && arranged.place !== "split" ? { filled: true } : {}) }
  }

  if (choice.kind === "length") {
    if (!view || !item || !mediaId) return { ok: true }
    const place = placeOf(view, item)
    // Never into the next picture; the editor itself stops at the next clip on the track.
    const next = Math.min(...picturesOn(view).filter((p) => p.id !== item.id && p.from > item.from).map((p) => p.from), Infinity)
    const seconds = Math.min(PICTURE_LONGEST_SECONDS, Math.max(PICTURE_SHORTEST_SECONDS, choice.seconds))
    const frames = Math.max(1, Math.min(Math.round(seconds * view.fps), next - item.from))
    // The speaker's copy is laid again for the new length, so it goes first.
    const fitted = await apply([...(beside.length > 0 ? [{ op: "removeItems", ids: beside }] : []), { op: "fitItem", id: item.id, durationInFrames: frames }])
    if (!fitted.ok) return { ok: false, refused: fitted.reason }
    const arranged = await arrangePicture(apply, fitted.timeline ?? view, { pictureId: item.id, mediaId, place, motion })
    return arranged.ok ? { ok: true } : { ok: false, refused: arranged.reason }
  }

  // A picture made again, or the person's own, shows where the one before it did.
  const place = view && item ? placeOf(view, item) : DEFAULT_PICTURE_PLACE
  const canvas = { width: view?.width ?? 16, height: view?.height ?? 9 }
  const got = await getPicture(choice, pictureAspect(canvas, place), request.userId, request.signal)
  if ("notMade" in got) return { ok: false, notMade: true, ...(got.reason ? { reason: got.reason } : {}) }

  const base = pictureFileBase(choice.kind === "mine", Date.now().toString(36), 1)
  const laid = await layPicture(editor, {
    label: request.label,
    base,
    type: got.image.type,
    buffer: got.image.buffer,
    from: row.from,
    frames: Math.max(1, row.to - row.from),
    replace: row.itemId ? [row.itemId, ...beside] : [],
    place,
    mediaId: mediaId ?? "",
    motion,
    onRecorded: request.onRecorded,
  })
  if (!laid.ok) return { ok: false, refused: laid.reason }
  const before = row.record
  const record: PictureRecord | undefined = before
    ? { id: base, label: before.label, said: before.said, prompt: choice.kind === "again" ? choice.prompt : before.prompt, start: before.start, end: before.end, mediaId: before.mediaId, ...(got.url ? { url: got.url } : {}) }
    : undefined
  return { ok: true, ...(record ? { record } : {}), ...(before ? { forget: before.id } : {}) }
}

export interface AddPictureRequest {
  readonly label: string
  readonly choice: PictureSourceChoice
  readonly userId: string
  readonly signal: AbortSignal
  readonly onRecorded: () => void
}

/**
 * A picture added by hand where the playhead is: made from the person's words
 * or their own file, laid beside the speaker for a few seconds. Refused when a
 * picture already shows there; shortened so it ends before the next one.
 */
export async function addPictureAtPlayhead(editor: EditorLink, request: AddPictureRequest): Promise<PictureChangeResult> {
  const view = readTimelineView(await editor.getTimeline())
  if (!view) return { ok: false, refused: undefined }
  const from = Math.max(0, Math.round(view.currentFrame ?? 0))
  const mediaId = videoUnder(view, from)
  const others = picturesOn(view)
  if (others.some((p) => p.from <= from && p.from + p.durationInFrames > from)) return { ok: false, taken: true }
  // No video under the playhead: nothing to lay a picture over.
  if (!mediaId) return { ok: false, refused: undefined }
  const next = Math.min(...others.filter((p) => p.from > from).map((p) => p.from), view.durationInFrames)
  const frames = Math.min(Math.round(PICTURE_ADDED_SECONDS * view.fps), next - from)
  if (frames < Math.round(PICTURE_SHORTEST_SECONDS * view.fps)) return { ok: false, taken: true }

  const { choice } = request
  const canvas = { width: view.width ?? 16, height: view.height ?? 9 }
  const got = await getPicture(choice, pictureAspect(canvas, DEFAULT_PICTURE_PLACE), request.userId, request.signal)
  if ("notMade" in got) return { ok: false, notMade: true, ...(got.reason ? { reason: got.reason } : {}) }
  const base = pictureFileBase(choice.kind === "mine", Date.now().toString(36), 1)
  const laid = await layPicture(editor, { label: request.label, base, type: got.image.type, buffer: got.image.buffer, from, frames, place: DEFAULT_PICTURE_PLACE, mediaId, motion: motionOf(from), onRecorded: request.onRecorded })
  if (!laid.ok) return { ok: false, refused: laid.reason }
  // What the panel knows about it: its words, so it can be made again from them. It was not chosen from the speech.
  const words = choice.kind === "again" ? choice.prompt : ""
  const record: PictureRecord = { id: base, label: words.split(/\s+/).slice(0, 4).join(" "), said: "", prompt: words, start: 0, end: 0, mediaId, ...(got.url ? { url: got.url } : {}) }
  return { ok: true, record, ...(laid.place && laid.place !== DEFAULT_PICTURE_PLACE ? { filled: true } : {}) }
}
