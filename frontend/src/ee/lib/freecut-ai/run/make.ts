/**
 * Made from the video: short vertical clips and a trailer, each in its own tab
 * of the editor, and a chapter list marked on the ruler. The platform's edit
 * plan picks the moments from what was said (planned as soon as the video is
 * heard); the clips and the trailer are then cut in the editor from the video
 * itself, never rendered on a server. Inside each clip the pauses are cut, the
 * crop follows the face and captions are laid, the way the main edit was.
 * What is made is kept when the edit is undone.
 *
 * Each is priced like the canvas's own node: its planning plus the node's
 * fixed fee per run, charged once the result is made.
 */
import { chargeUseCaseFee, editPlan } from "@/lib/api"
import { unwrapEditPlanOutput } from "@nodaro/shared/edl"
import { USE_CASE_NODE_TYPES, usecaseDescriptor, type UseCaseNodeType, type UseCaseResultKind } from "@nodaro/render-rules"
import { isEditPlanModeSupported } from "@/lib/edit-plan-modes"
import { coverTransform, pathAt, type PhoneFraming } from "../crop-path"
import { captionCues, isFillerWord, keptRanges, pauseRanges, readTimelineView, timelineFrameOf, wordsIn, type EditStep, type SecondsRange } from "../edit-plan"
import { CAPTION_HIGHLIGHT, highlightWords } from "./captions"
import type { RunContext } from "./context"
import type { CreativeChoices } from "./creative"
import { JobFailed, pause } from "./jobs"
import { RunFailed, type HeardVideo, type MadeResult } from "./types"

const PLAN_TIMEOUT_MS = 8 * 60_000
const TRAILER_SECONDS = 30
/** The chapter marks' color on the ruler (the Assistant's own). */
const CHAPTER_COLOR = "#f08c3a"

/** What each made thing is, in the use-case nodes' own terms: the node that makes the same result. */
const MADE_RESULT = { clips: "clips", trailer: "formats", chapters: "chapters" } as const satisfies Record<"clips" | "trailer" | "chapters", UseCaseResultKind>

/** The use-case node a made thing is priced like (its fixed fee per run): the node whose result it is. */
export function makeFeeType(made: keyof typeof MADE_RESULT): UseCaseNodeType {
  const type = USE_CASE_NODE_TYPES.find((t) => usecaseDescriptor(t).resultKind === MADE_RESULT[made])
  if (!type) throw new Error(`no use-case node makes ${MADE_RESULT[made]}`)
  return type
}

interface EdlLike {
  readonly segments?: ReadonlyArray<{ readonly inMs: number; readonly outMs: number }>
  readonly meta?: { readonly title?: string }
}

const rangesOf = (edl: EdlLike | null | undefined): SecondsRange[] =>
  (edl?.segments ?? []).filter((s) => s.outMs > s.inMs).map((s) => ({ start: s.inMs / 1000, end: s.outMs / 1000 }))

/** A plan of the platform's edit planner, started now; its answer is read when its turn comes. */
export function startPlan(ctx: RunContext, heard: HeardVideo, videoUrl: string, mode: "clips" | "trailer" | "chapters", extra: { count?: number; targetDurationSec?: number } = {}): Promise<unknown> {
  return ctx.jobs
    .run(
      () =>
        editPlan({
          mode,
          planTier: "economy",
          transcript: heard.transcript,
          sources: [{ id: "video", url: videoUrl, kind: "video" }],
          ...extra,
          userId: ctx.userId,
        }),
      PLAN_TIMEOUT_MS,
    )
    .then((output) => unwrapEditPlanOutput(output))
}

/** Whether this server's planner can plan a trailer; otherwise the creative pass picks its moments. */
export const plansTrailer = () => isEditPlanModeSupported("trailer")

/** The fee, charged once the result is made; a failure is said on the card, never swallowed. */
async function chargeFee(ctx: RunContext, step: EditStep, type: string): Promise<string | undefined> {
  try {
    await chargeUseCaseFee({ type })
    return undefined
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    ctx.feed("lead", "freecutAi.feeFailed", { reason })
    return reason
  }
}

/** The moments, marked on the edit while they are picked. */
async function markMoments(ctx: RunContext, ranges: readonly SecondsRange[]) {
  for (const [i, r] of ranges.slice(0, 6).entries()) {
    const at = timelineFrameOf(ctx.timeline, ctx.mediaId, r.start)
    const to = timelineFrameOf(ctx.timeline, ctx.mediaId, Math.max(r.start, r.end - 0.05))
    if (!at) continue
    ctx.show.mark(`moment-${i}`, { color: "#f08c3a", trackId: at.trackId, from: at.frame, to: Math.max(at.frame + 1, to?.frame ?? at.frame + 1) })
    await ctx.show.move("lead", { frame: at.frame, trackId: at.trackId }, 220)
  }
}

const clearMoments = (ctx: RunContext) => ctx.show.unmark(...Array.from({ length: 6 }, (_, i) => `moment-${i}`))

/** A clip's moments with their pauses taken out: what the tab plays. */
function tidy(ranges: readonly SecondsRange[], heard: HeardVideo): SecondsRange[] {
  const spoken = heard.words.filter((w) => !isFillerWord(w, heard.language))
  return ranges.flatMap((r) => keptRanges(r, pauseRanges(wordsIn(spoken, r), r.end).filter((p) => p.start >= r.start)))
}

/** The main edit, as a tab to open. */
const MAIN_TAB = "main"

/**
 * Opens a timeline tab and waits until the editor says it is the open one (the
 * editor declines while it is busy with an edit, so it is asked again a few
 * times). False when it never opens.
 */
async function openTab(ctx: RunContext, sequenceId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    ctx.link.openSequence(sequenceId)
    await pause(250 + attempt * 150, ctx.signal)
    const view = readTimelineView(await ctx.link.getTimeline())
    const open = view?.sequences?.find((s) => s.active)?.id ?? MAIN_TAB
    if (open === sequenceId) return true
  }
  return false
}

/**
 * A tab cut from the video: its pieces back to back, framed for the phone when
 * a framing is given, then captioned inside the tab (opened for that, and the
 * main edit opened again after; the run stops when the main edit cannot be
 * opened again, since every later edit would land in the wrong tab).
 */
async function makeSequence(ctx: RunContext, step: EditStep, name: string, ranges: readonly SecondsRange[], framing: PhoneFraming | null, heard: HeardVideo): Promise<{ sequenceId: string; seconds: number } | null> {
  const canvas = framing ? framing.phone : ctx.canvas
  const pieces = ranges.map((r) => ({
    mediaId: ctx.mediaId,
    sourceStart: Math.round(r.start * 1000) / 1000,
    sourceEnd: Math.round(r.end * 1000) / 1000,
    ...(framing ? { transform: coverTransform(framing.source, framing.phone, pathAt(framing.path, (r.start + r.end) / 2)) } : {}),
  }))
  await ctx.show.click("lead", "tabs.new", 380, name)
  const applied = await ctx.apply(step, [{ op: "createSequence", name, width: canvas.width, height: canvas.height, pieces }], { history: false })
  if (!applied.ok) return null
  const made = applied.result.results?.find((r) => r && typeof r === "object" && "sequenceId" in r) as { sequenceId?: string } | undefined
  if (!made?.sequenceId) return null
  // Captions inside the tab, along the words its pieces keep (skipping the show never skips them).
  const cues = captionCues(ranges.flatMap((r) => wordsIn(heard.words.filter((w) => !isFillerWord(w, heard.language)), r)))
  if (cues.length > 0 && (await openTab(ctx, made.sequenceId))) {
    const highlight = ctx.has("captions-word-highlight")
    await ctx.link
      .applyOps(ctx.label("captions"), [
        {
          op: "addTranscriptCaptions",
          mediaId: ctx.mediaId,
          cues: cues.map((c) => ({ text: c.text, start: c.start, end: c.end, ...(highlight && c.words ? { words: highlightWords(c.words) } : {}) })),
          ...(highlight ? { highlight: { color: CAPTION_HIGHLIGHT } } : {}),
        },
      ])
      .catch(() => undefined)
    await ctx.preview(0, 1500)
    if (!(await openTab(ctx, MAIN_TAB))) throw new RunFailed("freecutAi.tabStuck")
  }
  return { sequenceId: made.sequenceId, seconds: ranges.reduce((s, r) => s + (r.end - r.start), 0) }
}

export interface MadeOutcome {
  readonly made: readonly MadeResult[]
  readonly feeFailed?: string
}

export async function buildClips(ctx: RunContext, planned: Promise<unknown>, heard: HeardVideo, count: number, framing: PhoneFraming | null, name: (n: number) => string): Promise<MadeOutcome> {
  ctx.working("lead", true)
  ctx.step("clips", "working", "freecutAi.picking", undefined, 0.1)
  const clips = (await planned) as EdlLike[] | null
  if (!Array.isArray(clips) || clips.length === 0) throw new JobFailed("no clips")
  const made: MadeResult[] = []
  for (const [i, clip] of clips.slice(0, count).entries()) {
    const ranges = tidy(rangesOf(clip), heard)
    if (ranges.length === 0) continue
    await markMoments(ctx, ranges)
    const sequence = await makeSequence(ctx, "clips", name(i + 1), ranges, framing, heard)
    clearMoments(ctx)
    if (!sequence) continue
    const result: MadeResult = { id: `clip-${sequence.sequenceId}`, kind: "clip", key: "freecutAi.made.clip", vars: { n: i + 1 }, sequenceId: sequence.sequenceId, seconds: sequence.seconds }
    made.push(result)
    ctx.emit({ type: "made", result })
    ctx.step("clips", "working", "freecutAi.makingClips", { done: made.length, total: count }, 0.3 + (0.7 * made.length) / count)
  }
  const feeFailed = made.length > 0 ? await chargeFee(ctx, "clips", makeFeeType("clips")) : undefined
  ctx.working("lead", false)
  return { made, feeFailed }
}

export async function buildTrailer(ctx: RunContext, planned: Promise<unknown> | null, creative: CreativeChoices | null, heard: HeardVideo, name: string): Promise<MadeOutcome> {
  ctx.working("lead", true)
  ctx.step("trailer", "working", "freecutAi.picking", undefined, 0.1)
  const ranges = planned ? rangesOf((await planned) as EdlLike | null) : (creative?.trailer ?? [])
  if (ranges.length === 0) throw new JobFailed("no trailer")
  await markMoments(ctx, ranges)
  const sequence = await makeSequence(ctx, "trailer", name, ranges, null, heard)
  clearMoments(ctx)
  ctx.working("lead", false)
  if (!sequence) return { made: [] }
  const feeFailed = await chargeFee(ctx, "trailer", makeFeeType("trailer"))
  const result: MadeResult = { id: `trailer-${sequence.sequenceId}`, kind: "trailer", key: "freecutAi.made.trailer", sequenceId: sequence.sequenceId, seconds: sequence.seconds }
  ctx.emit({ type: "made", result })
  return { made: [result], feeFailed }
}

export async function buildChapters(ctx: RunContext, planned: Promise<unknown>): Promise<MadeOutcome> {
  ctx.working("lead", true)
  ctx.step("chapters", "working", "freecutAi.picking", undefined, 0.1)
  const answer = (await planned) as { chapters?: ReadonlyArray<{ startMs: number; title: string }> } | null
  const chapters = (answer?.chapters ?? []).filter((c) => typeof c.title === "string" && c.title.trim())
  if (chapters.length === 0) throw new JobFailed("no chapters")
  // Each chapter where it starts on the edit now: a start that was cut moves to the next moment kept.
  const placeOf = (start: number) => {
    for (let t = start; t < Math.min(ctx.mediaSeconds, start + 30); t += 0.25) {
      const at = timelineFrameOf(ctx.timeline, ctx.mediaId, t)
      if (at) return at.frame
    }
    return null
  }
  const marks = chapters
    .map((c) => ({ frame: placeOf(c.startMs / 1000), title: c.title.trim().slice(0, 80) }))
    .filter((m): m is { frame: number; title: string } => m.frame !== null)
  await ctx.show.click("lead", "timeline.ruler", 360, ctx.say("freecutAi.note.chapters"))
  // Asked again, the new chapter marks take the place of the earlier ones (told apart by their color).
  const earlier = (ctx.timeline.markers ?? []).filter((m) => m.color?.toLowerCase() === CHAPTER_COLOR).map((m) => m.id)
  const applied = await ctx.apply("chapters", [
    ...(earlier.length > 0 ? [{ op: "removeMarkers", ids: earlier }] : []),
    { op: "addMarkers", markers: marks.map((m) => ({ frame: m.frame, label: m.title, color: CHAPTER_COLOR })) },
  ])
  ctx.working("lead", false)
  if (!applied.ok) return { made: [] }
  const feeFailed = await chargeFee(ctx, "chapters", makeFeeType("chapters"))
  const result: MadeResult = {
    id: `chapters-${Date.now().toString(36)}`,
    kind: "chapters",
    key: "freecutAi.made.chapters",
    vars: { n: marks.length },
    chapters: marks.map((m) => ({ seconds: m.frame / ctx.fps, title: m.title })),
  }
  ctx.emit({ type: "made", result })
  return { made: [result], feeFailed }
}

export { TRAILER_SECONDS }
