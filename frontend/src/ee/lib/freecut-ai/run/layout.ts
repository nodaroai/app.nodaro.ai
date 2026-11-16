/**
 * The speaker layout: the Framer frames every shot of one recording for the
 * people seen in it, from the platform's face tracks. One person fills the
 * frame; two or three each get a part of their own (stacked, side by side, a
 * grid, or one large with the others small); a shot of a crowd is shown whole.
 *
 * The video is split at the shot changes, and a shot with several parts shows
 * its clip once per part: the copies sit on a track above (silent, under the
 * captions), each cropped to its person. Later cuts cut the copies with the video.
 */
import { speakerFrames } from "@/lib/api"
import type { Size } from "../crop-path"
import type { MessageKey } from "@/lib/i18n"
import { SEAM, framingOfPiece, shotFramings, shotLayoutOps, shotsOf, splitFramesOf, type ShotFraming, type ShotTrackSet } from "../shot-layout"
import { unlayOps, type SpeakerLayout, type facesOf } from "../speaker-layout"
import type { RunContext } from "./context"
import { JobFailed, checkStop } from "./jobs"
import type { HeardVideo } from "./types"

const FRAMES_TIMEOUT_MS = 10 * 60_000
const PHONE: Size = { width: 1080, height: 1920 }
/** The editor takes at most 500 edits in one request. */
const OPS_AT_ONCE = 480

/** The platform's face tracks of the video (with the speakers, when the video was heard). */
export async function faceTracks(ctx: RunContext, videoUrl: string, heard: HeardVideo | undefined): Promise<Parameters<typeof facesOf>[0]> {
  const output = await ctx.jobs.run(() => speakerFrames({ videoUrl, ...(heard?.transcript ? { transcript: heard.transcript } : {}), userId: ctx.userId }), FRAMES_TIMEOUT_MS)
  const descriptor = output.json as { url?: unknown } | undefined
  const url = typeof descriptor?.url === "string" ? descriptor.url : null
  if (!url) throw new JobFailed("no face tracks")
  const response = await fetch(url, { signal: ctx.signal })
  if (!response.ok) throw new JobFailed(`download ${response.status}`)
  const set = (await response.json()) as Parameters<typeof facesOf>[0]
  checkStop(ctx.signal)
  return set
}

/** An earlier layout left on the timeline is taken off before the video is framed again. */
export async function clearEarlierLayout(ctx: RunContext, step: "phone" | "layout"): Promise<void> {
  const ops = unlayOps(ctx.timeline, ctx.mediaId)
  if (ops.length > 0) await ctx.apply(step, ops)
}

/** What the timeline calls a clip, by how its shot is shown. */
const CLIP_NAME: Record<ShotFraming["kind"], (parts: number) => MessageKey> = {
  close: () => "freecutAi.shot.close",
  whole: () => "freecutAi.shot.whole",
  parts: (parts) => (parts === 2 ? "freecutAi.shot.two" : "freecutAi.shot.three"),
}

/** The name of a clip framed this way. */
export const clipNameKey = (framing: Pick<ShotFraming, "kind" | "slots">): MessageKey => CLIP_NAME[framing.kind](framing.slots.length)

/**
 * The captions of a laid-out phone frame sit on the seam, where the parts
 * meet, in every shot: the one line of the frame that never moves.
 */
export async function captionsOnSeam(ctx: RunContext, step: "captions" | "layout", captionsLabel: string): Promise<void> {
  const { width, height } = ctx.canvas
  if (height <= width || unlayOps(ctx.timeline, ctx.mediaId).length === 0) return
  const y = Math.round(height * (SEAM - 0.5))
  const ops = ctx.timeline.items
    .filter((i) => i.type === "subtitle" && i.label === captionsLabel && i.transform && Math.abs(i.transform.y - y) > 1)
    .map((i) => ({ op: "setTransform", id: i.id, transform: { ...i.transform!, y } }))
  if (ops.length > 0) await ctx.apply(step, ops)
}

export interface LayoutOutcome {
  readonly applied: boolean
  /** The most speakers the layout shows at once. */
  readonly speakers: number
  /** No shot shows two people: there is nothing to lay out. */
  readonly alone?: boolean
  /** The frame of the first shot shown in parts: where the edit is best looked at. */
  readonly at?: number
  readonly refused?: string
}

/** The Framer's turn: every shot framed for the people in it, each speaker in a part of their own. */
export async function runLayout(ctx: RunContext, set: ShotTrackSet, layout: SpeakerLayout): Promise<LayoutOutcome> {
  const media = ctx.timeline.media?.find((m) => m.id === ctx.mediaId)
  const source = media?.width && media?.height ? { width: media.width, height: media.height } : ctx.canvas
  // Side by side keeps the wide frame; the others are made for the phone.
  const canvas = layout === "side" ? ctx.canvas : PHONE
  const framings = shotFramings(shotsOf(set), layout, canvas, source)
  const n = Math.max(0, ...framings.map((f) => f.slots.length))
  if (n < 2) return { applied: false, speakers: 1, alone: true }

  ctx.working("framer", true)
  ctx.step("layout", "working", "freecutAi.layingOut", { n }, 0.5)
  const refuse = (reason: string | undefined): LayoutOutcome => {
    ctx.working("framer", false)
    return { applied: false, speakers: n, refused: reason }
  }

  // The parts of the first shot that has several, drawn on the picture before anything moves.
  const shown = framings.find((f) => f.slots.length > 1)!
  const shownPiece = ctx.pieces().find((p) => framingOfPiece(p, [shown], ctx.fps))
  await ctx.show.click("framer", "prop.canvas", 380, ctx.say("freecutAi.note.layout", { n }))
  if (shownPiece) await ctx.preview(Math.max(shownPiece.from, Math.min(shownPiece.from + shownPiece.durationInFrames - 1, shownPiece.from + Math.round(((shown.fromMs + 600) / 1000 - (shownPiece.sourceStart ?? 0) / (shownPiece.sourceFps ?? ctx.fps)) * ctx.fps))), 500)
  for (const [i, region] of shown.regions.entries()) {
    await ctx.show.frame("framer", { x: 0.01, y: 0.01, w: 0.98, h: 0.98 }, region, 620, ctx.say("freecutAi.note.speaker", { n: i + 1 }))
  }

  // The video is split where the framing changes, so every shot is a clip of its own.
  const frames = splitFramesOf(ctx.pieces(), framings, ctx.fps)
  if (frames.length > 0) {
    const split = await ctx.apply("layout", [{ op: "splitItems", ids: ctx.pieces().map((p) => p.id), frames }])
    if (!split.ok) return refuse(split.reason)
  }

  // A shot with several parts shows its clip once per part: one copy per part after the first.
  const pieces = ctx.pieces()
  const partsOf = (id: string) => framingOfPiece(pieces.find((p) => p.id === id)!, framings, ctx.fps)?.slots.length ?? 1
  const copiesOf = new Map<string, string[]>()
  for (let k = 1; k < n; k++) {
    const ids = pieces.filter((p) => partsOf(p.id) > k).map((p) => p.id)
    if (ids.length === 0) continue
    const copied = await ctx.apply("layout", [{ op: "duplicateItems", ids }])
    if (!copied.ok) return refuse(copied.reason)
    const result = copied.result.results?.find((r) => r && typeof r === "object" && Array.isArray((r as { copies?: unknown }).copies)) as { copies: Array<{ of: string; id: string }> } | undefined
    for (const copy of result?.copies ?? []) copiesOf.set(copy.of, [...(copiesOf.get(copy.of) ?? []), copy.id])
  }
  // A long recording is many shots: the editor takes them a few hundred edits at a time.
  const ops = shotLayoutOps(canvas, source, pieces, framings, ctx.fps, copiesOf, (framing) => ctx.say(clipNameKey(framing)))
  for (let at = 0; at < ops.length; at += OPS_AT_ONCE) {
    const applied = await ctx.apply("layout", ops.slice(at, at + OPS_AT_ONCE))
    if (!applied.ok) return refuse(applied.reason)
    ctx.step("layout", "working", "freecutAi.layingOut", { n }, 0.5 + 0.45 * Math.min(1, (at + OPS_AT_ONCE) / ops.length))
  }
  ctx.working("framer", false)
  const first = ctx.pieces().find((p) => partsOf(p.id) > 1) ?? ctx.pieces()[0]
  if (first) await ctx.preview(first.from, 1600)
  ctx.feed("framer", "freecutAi.laidOut", { n })
  return { applied: true, speakers: n, at: first?.from }
}
