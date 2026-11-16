/**
 * The look of the picture: the Color agent's grade (warm, cool, vivid, or
 * black and white, skin tones kept) and the Framer's punch-in zooms on the key
 * lines. Both are the editor's own effects and keyframes, so they stay
 * editable, and a later cut cuts them with their clip.
 */
import type { Look } from "../edit-plan"
import { timelineFrameOf } from "../edit-plan"
import type { RunContext } from "./context"
import type { Sentence } from "./creative"

export interface ColorOutcome {
  readonly applied: boolean
  /** The effects the look added, so asking again replaces them. */
  readonly effects: ReadonlyArray<{ readonly itemId: string; readonly effectId: string }>
  readonly refused?: string
}

const LOOK_AMOUNT: Record<Look, number> = { warm: 0.6, cool: 0.5, vivid: 0.55, bw: 1 }

/** The new look wipes across the picture in the editor's own player: the original on one side, the edit on the other. */
async function wipe(ctx: RunContext): Promise<void> {
  if (!ctx.has("compare") || ctx.show.skipping) return
  const STEPS = 14
  try {
    for (let i = 0; i <= STEPS; i++) {
      const at = 0.04 + (0.92 * i) / STEPS
      ctx.link.compare("split", at)
      ctx.show.at("color", { preview: { x: at, y: 0.5 } })
      await ctx.show.wait(80)
    }
  } finally {
    ctx.link.compare("program")
  }
}

export async function runColor(ctx: RunContext, look: Look, earlier: ColorOutcome["effects"]): Promise<ColorOutcome> {
  ctx.working("color", true)
  ctx.step("color", "working", "freecutAi.grading", undefined, 0.2)
  await ctx.show.click("color", "workspace.color", 420)
  // The properties panel is always on screen; the color wheels' own Temp control only in the color workspace.
  await ctx.show.slide("color", "panel.properties", 0.5, look === "cool" ? 0.25 : 0.5 + LOOK_AMOUNT[look] * 0.4, 900, ctx.say(`freecutAi.look.${look}` as const))
  const applied = await ctx.apply("color", [
    ...(earlier.length > 0 ? [{ op: "removeEffects", effects: earlier }] : []),
    { op: "applyLook", mediaId: ctx.mediaId, look, amount: LOOK_AMOUNT[look] },
  ])
  if (applied.ok) await wipe(ctx)
  ctx.working("color", false)
  if (!applied.ok) return { applied: false, effects: earlier, refused: applied.reason }
  const effects = applied.result.results?.flatMap((r) => (r && typeof r === "object" && Array.isArray((r as { effects?: unknown }).effects) ? ((r as { effects: ColorOutcome["effects"] }).effects) : [])) ?? []
  ctx.feed("color", "freecutAi.graded", { look: ctx.say(`freecutAi.look.${look}` as const) })
  return { applied: true, effects }
}

/** How far a punch-in goes, and how long it takes to get there. */
const ZOOM = 1.18
const EASE_SECONDS = 0.3

export interface ZoomOutcome {
  readonly zooms: number
  readonly refused?: string
}

export async function runZoom(ctx: RunContext, lines: readonly Sentence[]): Promise<ZoomOutcome> {
  if (lines.length === 0) return { zooms: 0 }
  ctx.working("framer", true)
  let zooms = 0
  let refused: string | undefined
  for (const [i, line] of lines.entries()) {
    ctx.step("zoom", "working", "freecutAi.zooming", { done: i, total: lines.length }, i / lines.length)
    const start = timelineFrameOf(ctx.timeline, ctx.mediaId, line.start)
    if (!start) continue
    const item = ctx.timeline.items.find((it) => it.id === start.itemId)
    if (!item?.transform) continue
    const ease = Math.round(EASE_SECONDS * ctx.fps)
    const at = start.frame - item.from
    const endAt = timelineFrameOf(ctx.timeline, ctx.mediaId, line.end)
    // The zoom stays inside its clip: a cut inside the line ends it there.
    const until = Math.min(item.durationInFrames - 1, endAt && endAt.itemId === item.id ? endAt.frame - item.from : item.durationInFrames - 1)
    if (until - at < ease * 2) continue
    const { width, height } = item.transform
    const zoomed = { width: Math.round(width * ZOOM), height: Math.round(height * ZOOM) }
    ctx.link.playback("seek", start.frame)
    ctx.show.mark("zoom", { color: "#5ccfe0", trackId: start.trackId, from: start.frame, to: item.from + until })
    await ctx.show.move("framer", { frame: start.frame, trackId: start.trackId }, 300, ctx.say("freecutAi.note.zoom", { n: i + 1, total: lines.length }))
    const inset = (1 - 1 / ZOOM) / 2
    await ctx.show.frame("framer", { x: 0.01, y: 0.01, w: 0.98, h: 0.98 }, { x: inset, y: inset, w: 1 / ZOOM, h: 1 / ZOOM }, 650)
    const key = (property: "width" | "height", frame: number, value: number) => ({ op: "addKeyframe", itemId: item.id, property, frame, value, easing: "ease-in-out" })
    const applied = await ctx.apply("zoom", [
      key("width", Math.max(0, at - 1), width),
      key("height", Math.max(0, at - 1), height),
      key("width", at + ease, zoomed.width),
      key("height", at + ease, zoomed.height),
      key("width", until - ease, zoomed.width),
      key("height", until - ease, zoomed.height),
      key("width", until, width),
      key("height", until, height),
    ])
    ctx.show.unmark("zoom")
    if (applied.ok) {
      zooms += 1
      ctx.feed("framer", "freecutAi.zoomed", { text: line.text.slice(0, 60) })
    } else {
      refused = applied.reason
    }
  }
  ctx.working("framer", false)
  return { zooms, refused }
}
