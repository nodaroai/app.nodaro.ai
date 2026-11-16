/**
 * Switch cameras: with two or more cameras of the same moment stacked on the
 * timeline, the Director cuts to whoever speaks. The platform's camera switch
 * reads who speaks when (the video was heard with its speakers told apart)
 * and answers a cut list; the Director plays it with the cameras' opacity,
 * held from cut to cut, so every camera stays whole and editable.
 */
import { cameraSwitch } from "@/lib/api"
import { cameraSwitchSettingsPayload } from "@nodaro/shared/edl"
import { timelineFrameOf, type TimelineItemView } from "../edit-plan"
import type { RunContext } from "./context"
import { JobFailed } from "./jobs"
import type { HeardVideo } from "./types"

const SWITCH_TIMEOUT_MS = 6 * 60_000

export interface Angle {
  readonly mediaId: string
  readonly url: string
  readonly items: readonly TimelineItemView[]
  /** Higher draws over lower. */
  readonly layer: number
}

/**
 * The other cameras: videos of other files stacked over the edited one for most
 * of its length, each with an address the platform can read. Empty when there
 * are none (one camera).
 */
export function anglesOf(ctx: RunContext, urlOfName: (fileName: string) => string | undefined): Angle[] {
  const main = ctx.pieces()
  if (main.length === 0) return []
  const span = { from: main[0]!.from, to: main.at(-1)!.from + main.at(-1)!.durationInFrames }
  const order = new Map((ctx.timeline.tracks ?? []).map((t, i) => [t.id, t.order ?? i]))
  const media = new Map((ctx.timeline.media ?? []).map((m) => [m.id, m]))
  const byMedia = new Map<string, TimelineItemView[]>()
  for (const item of ctx.timeline.items) {
    if (item.type !== "video" || !item.mediaId || item.mediaId === ctx.mediaId) continue
    byMedia.set(item.mediaId, [...(byMedia.get(item.mediaId) ?? []), item])
  }
  const angles: Angle[] = []
  for (const [mediaId, items] of byMedia) {
    const covered = items.reduce((sum, i) => sum + Math.max(0, Math.min(span.to, i.from + i.durationInFrames) - Math.max(span.from, i.from)), 0)
    if (covered < (span.to - span.from) * 0.5) continue
    const url = urlOfName(media.get(mediaId)?.fileName ?? "")
    if (!url) continue
    // Video tracks draw lower orders on top (the editor's order): a lower order is a higher layer.
    const layer = -Math.min(...items.map((i) => order.get(i.trackId) ?? 0))
    angles.push({ mediaId, url, items, layer })
  }
  return angles
}

export interface CamerasOutcome {
  readonly switches: number
  readonly refused?: string
}

export async function runCameras(ctx: RunContext, heard: HeardVideo, mainUrl: string, angles: readonly Angle[]): Promise<CamerasOutcome> {
  ctx.working("director", true)
  ctx.step("cameras", "working", "freecutAi.speakers", undefined, 0.1)
  const durationMs = Math.round(ctx.mediaSeconds * 1000)
  const edl = {
    version: 1,
    clock: "master",
    sources: [{ id: ctx.mediaId, url: mainUrl, kind: "video" }, ...angles.map((a) => ({ id: a.mediaId, url: a.url, kind: "video" }))],
    segments: [{ id: "all", inMs: 0, outMs: durationMs, video: ctx.mediaId }],
  }
  const settings = cameraSwitchSettingsPayload({}, edl, heard.transcript)
  await ctx.show.click("director", "panel.properties", 380, ctx.say("freecutAi.note.speakers"))
  const output = await ctx.jobs.run(() => cameraSwitch({ edl, transcript: heard.transcript, ...settings, userId: ctx.userId }), SWITCH_TIMEOUT_MS)
  const cut = (output.json ?? output) as { segments?: ReadonlyArray<{ inMs: number; outMs: number; video?: string }> }
  const segments = (cut.segments ?? []).filter((s) => s.outMs > s.inMs && typeof s.video === "string")
  if (segments.length === 0) throw new JobFailed("no cuts")

  // Each upper camera is shown only on its own segments; the edited video lies under them all.
  const ops: Array<Record<string, unknown>> = []
  let switches = 0
  let previous: string | undefined
  for (const segment of segments) {
    const at = timelineFrameOf(ctx.timeline, ctx.mediaId, segment.inMs / 1000)
    if (!at) continue
    if (segment.video !== previous) switches += 1
    previous = segment.video
    for (const angle of angles) {
      const item = angle.items.find((i) => i.from <= at.frame && at.frame < i.from + i.durationInFrames)
      if (!item) continue
      ops.push({ op: "addKeyframe", itemId: item.id, property: "opacity", frame: at.frame - item.from, value: segment.video === angle.mediaId ? 1 : 0, easing: "hold" })
    }
  }
  // The other cameras' own sound is lowered: the edited video's sound is the one heard.
  for (const angle of angles) {
    for (const audio of ctx.timeline.items.filter((i) => i.type === "audio" && i.mediaId === angle.mediaId)) {
      ops.push({ op: "updateItem", id: audio.id, updates: { volume: -60 } })
    }
  }
  const applied = await ctx.apply("cameras", ops)
  ctx.working("director", false)
  if (!applied.ok) return { switches: 0, refused: applied.reason }
  ctx.feed("director", switches - 1 === 1 ? "freecutAi.switchedOne" : "freecutAi.switched", { n: Math.max(0, switches - 1) })
  return { switches: Math.max(0, switches - 1) }
}
