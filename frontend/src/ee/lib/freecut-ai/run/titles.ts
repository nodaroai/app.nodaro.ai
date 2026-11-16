/**
 * The texts that come onto the screen on the spoken words: laid as the
 * editor's own text items on one track above everything, each in the part of
 * the frame where the speaker shows (never on a picture; none while a picture
 * fills the frame). Asked again, the new texts take the place of the earlier
 * ones. One text can then be changed or taken off (`applyTitleChange`).
 */
import { readTimelineView, timelineFrameOf, type TimelineView } from "../edit-plan"
import type { EditorLink } from "../editor-link"
import { titleRows, titleTrackOf, titleZone, type TitleRow } from "../title-rows"
import { DEFAULT_ENTRY, DEFAULT_TITLE_PLACE, TITLE_ID, TITLE_LEAD_SECONDS, titleFields, titleId, titleSeconds, type TitleLook, type TitleRecord } from "../title-style"
import type { RunContext } from "./context"
import type { TitleChoice } from "./creative"
import { checkStop } from "./jobs"

/** The fewest and the most texts a run lays, and the most it lays unless the person asks for more. */
export const TITLE_MIN = 1
export const TITLE_MAX = 20
const TITLE_DEFAULT_MOST = 10
/** A text about every fifteen seconds: two in half a minute, four in a minute. */
const SECONDS_A_TITLE = 15

/** How many texts a video of this length gets unless the person chooses. */
export const titleShots = (seconds: number) => Math.min(TITLE_DEFAULT_MOST, Math.max(1, Math.round(seconds / SECONDS_A_TITLE)))

/** The number of texts to lay: the person's own when they chose one, else the length's. */
export const titleCount = (seconds: number, chosen?: number | null): number =>
  chosen === undefined || chosen === null ? titleShots(seconds) : Math.min(TITLE_MAX, Math.max(TITLE_MIN, Math.round(chosen)))

/** A text shorter than this is not worth showing. */
const LEAST_SECONDS = 1.2

export interface PlannedTitle {
  readonly record: TitleRecord
  readonly from: number
  readonly frames: number
  readonly fields: Record<string, unknown>
}

/**
 * Where each chosen text goes on the timeline as it is now, in order: on its
 * words, ended before the next one, in the speaker's part of the frame. A text
 * whose words were cut away, or that a full-frame picture covers, is left out.
 */
export function planTitles(view: TimelineView, mediaId: string, choices: readonly TitleChoice[], look: TitleLook, stamp: string): PlannedTitle[] {
  const canvas = { width: view.width ?? 0, height: view.height ?? 0 }
  const placed = choices
    .map((choice) => ({ choice, at: timelineFrameOf(view, mediaId, Math.max(0, choice.start - TITLE_LEAD_SECONDS)) ?? timelineFrameOf(view, mediaId, choice.start) }))
    .filter((p): p is { choice: TitleChoice; at: NonNullable<typeof p.at> } => !!p.at)
    .sort((a, b) => a.at.frame - b.at.frame)
  const planned: PlannedTitle[] = []
  for (const [i, { choice, at }] of placed.entries()) {
    const lines = choice.kind === "list" ? choice.text.split("\n").length : 1
    const lineGap = choice.kind === "list" ? Math.max(0.4, (choice.sentence.end - choice.start) / lines) : undefined
    const wanted = Math.round(titleSeconds(choice.kind, choice.start, choice.until, lines, lineGap ?? 0) * view.fps)
    const next = placed[i + 1]?.at.frame ?? Infinity
    let frames = Math.min(wanted, next - at.frame)
    // A picture that fills the frame ends the text before it; one already showing leaves no room for it.
    let zone = titleZone(view, at.frame, at.frame + frames)
    if (!zone) {
      if (!titleZone(view, at.frame, at.frame + 1)) continue
      while (frames > 0 && !titleZone(view, at.frame, at.frame + frames)) frames -= Math.max(1, Math.round(view.fps / 5))
      zone = frames > 0 ? titleZone(view, at.frame, at.frame + frames) : null
    }
    if (!zone || frames < LEAST_SECONDS * view.fps) continue
    const record: TitleRecord = {
      id: titleId(stamp, planned.length + 1),
      kind: choice.kind,
      text: choice.text,
      key: choice.key,
      ...(choice.sub ? { sub: choice.sub } : {}),
      look,
      place: DEFAULT_TITLE_PLACE,
      entry: DEFAULT_ENTRY[choice.kind],
      ...(lineGap ? { lineGap } : {}),
    }
    planned.push({ record, from: at.frame, frames, fields: titleFields(record, zone, canvas, view.fps) })
  }
  return planned
}

/** The Captions agent's second job: the texts laid, the earlier ones taken away. */
export async function placeTitles(ctx: RunContext, choices: readonly TitleChoice[], look: TitleLook): Promise<{ readonly placed: number; readonly refused?: string; readonly titles: readonly TitleRecord[] }> {
  if (choices.length === 0) return { placed: 0, titles: [] }
  ctx.working("captions", true)
  ctx.step("titles", "working", "freecutAi.titles.laying", { done: 0, total: choices.length }, 0.1)
  const done = (out: { placed: number; refused?: string; titles: readonly TitleRecord[] }) => {
    ctx.working("captions", false)
    return out
  }
  const planned = planTitles(ctx.timeline, ctx.mediaId, choices, look, Date.now().toString(36))
  if (planned.length === 0) return done({ placed: 0, titles: [] })
  const earlier = ctx.timeline.items.filter((i) => i.type === "text" && TITLE_ID.test(i.id)).map((i) => i.id)
  // One track for the texts, above everything: the one they were on, else a new one.
  let trackId = titleTrackOf(ctx.timeline)
  if (!trackId) {
    const made = await ctx.apply("titles", [{ op: "addTrack", kind: "video" }])
    if (!made.ok) return done({ placed: 0, refused: made.reason, titles: [] })
    trackId = (made.result.results?.[0] as { trackId?: string } | undefined)?.trackId ?? null
    if (!trackId) return done({ placed: 0, refused: "", titles: [] })
  }
  checkStop(ctx.signal)
  const first = planned[0]!
  await ctx.show.click("captions", "rail.text", 380)
  ctx.link.playback("seek", first.from)
  await ctx.show.type("captions", { preview: { x: 0.5, y: 0.2 } }, first.record.text.replace(/\n/g, " "))
  const applied = await ctx.apply("titles", [
    ...(earlier.length > 0 ? [{ op: "removeItems", ids: earlier }] : []),
    ...planned.map((p) => ({ op: "addItem", item: { ...p.fields, id: p.record.id, trackId, from: p.from, durationInFrames: p.frames } })),
  ])
  if (!applied.ok) return done({ placed: 0, refused: applied.reason, titles: [] })
  ctx.step("titles", "working", "freecutAi.titles.laying", { done: planned.length, total: planned.length }, 0.9)
  ctx.feed("captions", planned.length === 1 ? "freecutAi.titles.laidOne" : "freecutAi.titles.laid", { n: planned.length })
  await ctx.preview(first.from, 1600)
  return done({ placed: planned.length, titles: planned.map((p) => p.record) })
}

export type TitleChoiceChange =
  /** The text shown another way: its words, where it sits, how it comes in, its colors. `also` are other texts given the same colors. */
  | { readonly kind: "set"; readonly record: TitleRecord; readonly also?: readonly TitleRecord[] }
  | { readonly kind: "remove" }

export type TitleChangeResult = { readonly ok: true; /** The texts as they now are. */ readonly records?: readonly TitleRecord[]; readonly forget?: string } | { readonly ok: false; readonly refused: string | undefined }

/** One text changed or taken off: an edit like the rest, under one label. */
export async function applyTitleChange(editor: EditorLink, request: { readonly label: string; readonly row: TitleRow; readonly change: TitleChoiceChange; readonly onRecorded: () => void }): Promise<TitleChangeResult> {
  const { row, change } = request
  const view = readTimelineView(await editor.getTimeline())
  const now = view ? titleRows(view, []).find((r) => r.key === row.key) : undefined
  if (!view || !now) return { ok: true, forget: row.key }
  const canvas = { width: view.width ?? 0, height: view.height ?? 0 }
  const onTimeline = new Map(titleRows(view, []).map((r) => [r.key, r]))
  // Each text is sent whole again (all but its type: the item stays a text), in its own part of the frame.
  const set = (record: TitleRecord): Array<Record<string, unknown>> => {
    const at = onTimeline.get(record.id)
    if (!at) return []
    const zone = titleZone(view, at.from, at.to) ?? { x: 0, y: 0, w: canvas.width, h: canvas.height }
    const updates = Object.fromEntries(Object.entries(titleFields(record, zone, canvas, view.fps)).filter(([name]) => name !== "type"))
    return [{ op: "updateItem", id: record.id, updates }]
  }
  const records = change.kind === "set" ? [change.record, ...(change.also ?? [])].filter((r) => onTimeline.has(r.id)) : []
  const ops = change.kind === "remove" ? [{ op: "removeItems", ids: [row.key] }] : records.flatMap(set)
  const applied = await editor.applyOps(request.label, ops)
  if (!applied.ok) return { ok: false, refused: applied.error?.message }
  if (applied.recorded !== false) request.onRecorded()
  return change.kind === "remove" ? { ok: true, forget: row.key } : { ok: true, records }
}
