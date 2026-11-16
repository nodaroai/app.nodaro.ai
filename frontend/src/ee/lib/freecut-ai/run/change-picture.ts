/**
 * One picture on the words changed after a run, as the person chose: made
 * again from other words, replaced by a picture of their own, or taken off.
 * Each is an edit like the rest, under one label, undone with them.
 */
import { readTimelineView } from "../edit-plan"
import type { EditorLink } from "../editor-link"
import { DEFAULT_PICTURE_PLACE, pictureAspect, placeOf, speakerCopiesOf, videoUnder, type PicturePlace } from "../picture-place"
import { pictureFileBase, type PictureRecord, type PictureRow } from "../picture-rows"
import { BROLL_IMAGE_TIMEOUT_MS, failureWords, layPicture, motionOf, pictureBytes, startPictureJob } from "./broll"
import { RunJobs } from "./jobs"
import { applyThrough, arrangePicture } from "./place-picture"

export type PictureChoice =
  /** Made again: what it shows, in the person's words. */
  | { readonly kind: "again"; readonly prompt: string }
  /** The person's own picture. */
  | { readonly kind: "mine"; readonly file: File }
  /** Shown another way: beside the speaker, in a window, or filling the frame. */
  | { readonly kind: "place"; readonly place: PicturePlace }
  | { readonly kind: "remove" }

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

/** Applies the change. Throws what a job or the editor throws (no credits, signed out, no answer). */
export async function applyPictureChange(editor: EditorLink, request: PictureChangeRequest): Promise<PictureChangeResult> {
  const { row, choice } = request
  const view = readTimelineView(await editor.getTimeline())
  const item = row.itemId ? view?.items.find((i) => i.id === row.itemId) : undefined
  // The speaker's copy laid beside a picture goes with it.
  const beside = view && item ? speakerCopiesOf(view, item).map((i) => i.id) : []
  const mediaId = row.record?.mediaId ?? (view ? videoUnder(view, row.from) : null)
  const motion = motionOf(Math.round(row.from))
  if (choice.kind === "remove") {
    if (!row.itemId) return { ok: true, ...(row.record ? { forget: row.record.id } : {}) }
    const removed = await editor.applyOps(request.label, [{ op: "removeItems", ids: [row.itemId, ...beside] }])
    if (!removed.ok) return { ok: false, refused: removed.error?.message }
    if (removed.recorded !== false) request.onRecorded()
    return { ok: true, ...(row.record ? { forget: row.record.id } : {}) }
  }

  if (choice.kind === "place") {
    if (!view || !item || !mediaId) return { ok: true }
    const apply = applyThrough((ops) => editor.applyOps(request.label, ops), () => editor.getTimeline(), (recorded) => recorded && request.onRecorded())
    const arranged = await arrangePicture(apply, view, { pictureId: item.id, mediaId, place: choice.place, motion })
    if (!arranged.ok) return { ok: false, refused: arranged.reason }
    return { ok: true, ...(choice.place === "split" && arranged.place !== "split" ? { filled: true } : {}) }
  }

  // A picture made again, or the person's own, shows where the one before it did.
  const place = view && item ? placeOf(view, item) : DEFAULT_PICTURE_PLACE
  const canvas = { width: view?.width ?? 16, height: view?.height ?? 9 }
  const stamp = Date.now().toString(36)
  let image: { readonly type: string; readonly buffer: ArrayBuffer } | null
  let madeUrl: string | undefined
  if (choice.kind === "mine") {
    image = { type: choice.file.type || "image/png", buffer: await choice.file.arrayBuffer() }
  } else {
    const jobs = new RunJobs(request.signal)
    try {
      const output = await jobs.run(() => startPictureJob(choice.prompt, pictureAspect(canvas, place), request.userId), BROLL_IMAGE_TIMEOUT_MS)
      madeUrl = typeof output.imageUrl === "string" ? output.imageUrl : undefined
      image = madeUrl ? await pictureBytes(madeUrl, request.signal) : null
    } catch (error) {
      const reason = failureWords(error)
      // A refusal is an answer about this picture; anything else (no credits, signed out) is the caller's to say.
      if (reason) return { ok: false, notMade: true, reason }
      throw error
    } finally {
      jobs.end()
    }
    if (!image) return { ok: false, notMade: true }
  }

  const base = pictureFileBase(choice.kind === "mine", stamp, 1)
  const laid = await layPicture(editor, {
    label: request.label,
    base,
    type: image.type,
    buffer: image.buffer,
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
    ? { id: base, label: before.label, said: before.said, prompt: choice.kind === "again" ? choice.prompt : before.prompt, start: before.start, end: before.end, mediaId: before.mediaId, ...(madeUrl ? { url: madeUrl } : {}) }
    : undefined
  return { ok: true, ...(record ? { record } : {}), ...(before ? { forget: before.id } : {}) }
}
