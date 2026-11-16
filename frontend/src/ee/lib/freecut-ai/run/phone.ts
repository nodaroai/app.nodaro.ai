/**
 * The phone version: the Framer turns the canvas to 9:16 and keeps the face in
 * frame, moment by moment, from the platform's face tracking. Every clip of
 * the video gets a crop that follows whoever speaks, calmly, cutting rather
 * than gliding when the face jumps; pictures laid over it fill the new frame.
 * The panel keeps the framing, so Wide | Phone switches back and forth.
 *
 * The faces are tracked as soon as the video is heard (`faceTracks`); the reframing
 * itself (`applyPhone`) comes when the Framer's turn does.
 */
import { followPath, formatOps, mainFaces, phoneFraming, speakerAt, type PhoneFraming } from "../crop-path"
import type { RunContext } from "./context"
import { peopleTracks, speakersHeard } from "../speaker-layout"
import type { HeardVideo } from "./types"

/** About how long face tracking takes: the progress shown while it runs. */
export const TRACK_MS = 60_000

/** The phone version's framing, from the video's face tracks: the crop follows the real people only, whoever speaks. */
export function framingOf(ctx: RunContext, set: Parameters<typeof mainFaces>[0], heard: HeardVideo | undefined): PhoneFraming {
  const media = ctx.timeline.media?.find((m) => m.id === ctx.mediaId)
  const source = media?.width && media?.height ? { width: media.width, height: media.height } : { width: ctx.canvas.width, height: ctx.canvas.height }
  const people = peopleTracks(set, (heard && speakersHeard(heard.words).length) || undefined) as Parameters<typeof mainFaces>[0]
  return phoneFraming(ctx.mediaId, source, ctx.canvas, followPath(mainFaces(people, heard ? (t) => speakerAt(heard.words, t) : undefined)))
}

export interface PhoneOutcome {
  readonly applied: boolean
  readonly refused?: string
}

/** The Framer's turn: the canvas flips to 9:16 and the crop follows the face along every clip. */
export async function applyPhone(ctx: RunContext, framing: PhoneFraming, step: "phone" | "layout" = "phone"): Promise<PhoneOutcome> {
  ctx.working("framer", true)
  ctx.step(step, "working", "freecutAi.reframing", undefined, 0.85)
  await ctx.show.click("framer", "prop.canvas", 420, ctx.say("freecutAi.note.canvas"))
  // The 9:16 frame, drawn on the wide picture where the face is, then moved along the face's first seconds.
  const share = Math.min(1, (framing.phone.width / framing.phone.height) / (framing.source.width / framing.source.height))
  const rectAt = (cx: number) => ({ x: Math.max(0, Math.min(1 - share, cx - share / 2)), y: 0.01, w: share, h: 0.98 })
  const faceAt = framing.path[0]?.cx ?? 0.5
  await ctx.show.frame("framer", { x: 0.01, y: 0.01, w: 0.98, h: 0.98 }, rectAt(faceAt), 900, ctx.say("freecutAi.note.tracking"))
  const later = framing.path.find((p) => Math.abs(p.cx - faceAt) > 0.04)
  if (later) await ctx.show.frame("framer", rectAt(faceAt), rectAt(later.cx), 700, ctx.say("freecutAi.note.tracking"))
  const applied = await ctx.apply(step, formatOps(ctx.timeline, framing, "phone"))
  if (!applied.ok) {
    ctx.working("framer", false)
    return { applied: false, refused: applied.reason }
  }
  ctx.emit({ type: "framing", framing })
  // The crop, followed along the clips.
  for (const piece of ctx.pieces().slice(0, 4)) await ctx.show.move("framer", { item: piece.id }, 240, ctx.say("freecutAi.note.tracking"))
  const first = ctx.pieces()[0]
  if (first) await ctx.preview(first.from, 1600)
  ctx.feed("framer", "freecutAi.reframed")
  ctx.working("framer", false)
  return { applied: true }
}
