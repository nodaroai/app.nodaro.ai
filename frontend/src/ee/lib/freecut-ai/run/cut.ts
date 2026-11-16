/**
 * The Cutter: the pauses, the filler words, and the mistakes and repeats, cut
 * one by one where the person can watch: the razor, a selection over the
 * moment, the cut, the gap closing.
 *
 * Every cut is the editor's own range removal, so whatever sits over the
 * words (captions, b-roll, zooms) is cut with them and stays on its words.
 * Background music lies on a track that cuts leave alone; it is fitted to
 * the new length afterwards (`refitMusic`).
 */
import { editPlan } from "@/lib/api"
import { unwrapEditPlanOutput } from "@nodaro/shared/edl"
import type { MessageKey } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n"
import {
  fillerRanges,
  isFillerWord,
  mergeRanges,
  pauseRanges,
  timelineFrameOf,
  timelineSeconds,
  type SecondsRange,
  type TimedWord,
} from "../edit-plan"
import type { RunContext } from "./context"
import type { HeardVideo } from "./types"

export type CutKind = "pause" | "filler" | "mistake"

export interface CutRange extends SecondsRange {
  readonly kind: CutKind
  /** The filler's word, or the words of a mistake, for the run's log. */
  readonly words?: string
}

const EDIT_PLAN_TIMEOUT_MS = 8 * 60_000
/** The reasons a planned cut is a mistake: a restart or something off the topic. Silences and fillers are cut by the Cutter itself. */
const MISTAKE_REASONS = new Set(["false-start", "tangent", "repeat", "retake"])

/** A word as the log names it: "um" for the transcript's "um,". */
export const bareWord = (text: string) => text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") || text
const seconds = (s: number) => formatNumber(s, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/**
 * The mistakes and repeats in what was said: the platform's edit plan reads the
 * whole transcript and marks restarts, repeated takes and off-topic parts.
 */
export async function mistakeRanges(ctx: RunContext, heard: HeardVideo, videoUrl: string): Promise<CutRange[]> {
  const output = await ctx.jobs.run(
    () =>
      editPlan({
        mode: "tighten",
        planTier: "economy",
        transcript: heard.transcript,
        sources: [{ id: "video", url: videoUrl, kind: "video" }],
        instructions: "Remove only restarts, false starts, repeated takes and off-topic parts. Keep every sentence that is said once and well. Do not remove silences or filler words.",
        userId: ctx.userId,
      }),
    EDIT_PLAN_TIMEOUT_MS,
  )
  const edl = unwrapEditPlanOutput(output) as { dropped?: ReadonlyArray<{ inMs: number; outMs: number; reason?: string }> } | null
  const wordsIn = (r: SecondsRange) => heard.words.filter((w) => w.start >= r.start - 0.05 && w.end <= r.end + 0.05).map((w) => w.text).join(" ")
  return (edl?.dropped ?? [])
    .filter((d) => MISTAKE_REASONS.has(String(d.reason ?? "")) && d.outMs > d.inMs)
    .map((d) => ({ start: d.inMs / 1000, end: d.outMs / 1000 }))
    .map((r) => ({ ...r, kind: "mistake" as const, words: wordsIn(r).slice(0, 80) }))
}

/** The pauses and filler sounds, in the video's own language. */
export function speechCuts(words: readonly TimedWord[], language: string | null, mediaSeconds: number, opts: { readonly pauses: boolean; readonly fillers: boolean; readonly fillersGone: boolean }): CutRange[] {
  const fillers = opts.fillers ? fillerRanges(words, language) : []
  // With the fillers gone, the silence around each one is one pause.
  const spoken = opts.fillersGone ? words.filter((w) => !isFillerWord(w, language)) : words
  return [
    ...fillers.map((f) => ({ start: f.start, end: f.end, kind: "filler" as const, words: bareWord(f.word) })),
    ...(opts.pauses ? pauseRanges(spoken, mediaSeconds).map((r) => ({ ...r, kind: "pause" as const })) : []),
  ]
}

const PRIORITY: Record<CutKind, number> = { mistake: 3, filler: 2, pause: 1 }

/** Overlapping cuts joined into one, named by the strongest reason among them. */
export function joinCuts(cuts: readonly CutRange[]): CutRange[] {
  const merged = mergeRanges(cuts)
  return merged.map((range) => {
    const inside = cuts.filter((c) => c.start < range.end && c.end > range.start)
    const kind = inside.reduce<CutKind>((best, c) => (PRIORITY[c.kind] > PRIORITY[best] ? c.kind : best), "pause")
    const words = inside.filter((c) => c.kind === kind && c.words).map((c) => c.words).join(" ")
    return { ...range, kind, ...(words ? { words } : {}) }
  })
}

/**
 * At most this many steps, whatever the length: the first cuts are shown one
 * at a time, the rest share a step. Each step is one undo entry, and the
 * editor keeps a limited number of them (50 by default), so a whole run's
 * entries must stay well under that for Undo all to reach its first one.
 */
const DETAILED = 4
const MAX_STEPS = 10

/** The cuts in the order the Cutter makes them: the first few one at a time, the rest in small groups. */
export function cutSteps(cuts: readonly CutRange[]): CutRange[][] {
  const first = cuts.slice(0, DETAILED).map((c) => [c])
  const rest = cuts.slice(DETAILED)
  if (rest.length === 0) return first
  const size = Math.max(1, Math.ceil(rest.length / (MAX_STEPS - first.length)))
  const groups: CutRange[][] = []
  for (let i = 0; i < rest.length; i += size) groups.push(rest.slice(i, i + size))
  return [...first, ...groups]
}

export interface CutOutcome {
  readonly pausesCut: number
  readonly fillersCut: number
  readonly mistakesCut: number
  /** The editor refused some cuts: its own words. */
  readonly refused?: string
  /** Captions from an earlier panel were taken away so the cuts could land: they are made again. */
  readonly captionsRemoved: boolean
}

const NOTE: Record<CutKind, MessageKey> = { pause: "freecutAi.note.pause", filler: "freecutAi.note.filler", mistake: "freecutAi.note.mistake" }
const STEP_OF: Record<CutKind, "pauses" | "fillers" | "mistakes"> = { pause: "pauses", filler: "fillers", mistake: "mistakes" }

/** Captions made in several parts (by the first version of this panel) stop the editor from cutting under them. */
const blockedByCaptions = (reason: string) => /none of the ranges could be cut/i.test(reason)

/**
 * The cuts, made where the person can watch. Each step is its own edit under
 * its kind's label. A refused cut is reported with the editor's words; the
 * other cuts still land.
 */
/** The first cuts are shown whole, each with the join played back; after them the pace picks up. */
const PLAYED_JOINS = 4

export async function runCuts(ctx: RunContext, cuts: readonly CutRange[]): Promise<CutOutcome> {
  const counts = { pause: 0, filler: 0, mistake: 0 }
  const kinds = new Set(cuts.map((c) => c.kind))
  const total = cuts.length
  const startSeconds = timelineSeconds(ctx.timeline)
  let done = 0
  let shown = 0
  let refused: string | undefined
  let captionsRemoved = false
  const removed = () => seconds(Math.max(0, startSeconds - timelineSeconds(ctx.timeline)))
  const progress = () => {
    for (const kind of kinds) ctx.step(STEP_OF[kind], "working", "freecutAi.cuttingRemoved", { done, total, seconds: removed() }, total > 0 ? done / total : 1)
  }
  progress()
  if (total === 0) return { pausesCut: 0, fillersCut: 0, mistakesCut: 0, captionsRemoved }

  ctx.working("cutter", true)
  await ctx.show.click("cutter", "tool.razor", 420)
  for (const step of cutSteps(cuts)) {
    const first = step[0]!
    const from = timelineFrameOf(ctx.timeline, ctx.mediaId, first.start)
    const to = timelineFrameOf(ctx.timeline, ctx.mediaId, Math.max(first.start, first.end - 0.01))
    if (from) {
      ctx.link.playback("seek", Math.max(0, from.frame - 2))
      const note = ctx.say(NOTE[first.kind], { seconds: seconds(first.end - first.start), word: first.words ?? "" })
      ctx.show.mark("cut", { color: "#ff7a5c", trackId: from.trackId, from: from.frame, to: Math.max(from.frame + 1, to?.frame ?? from.frame + 1) })
      await ctx.show.cut("cutter", from.trackId, from.frame, Math.max(from.frame + 1, to?.frame ?? from.frame + 1), step.length === 1 ? 700 : 380, note)
    }
    const kind = step.reduce<CutKind>((best, c) => (PRIORITY[c.kind] > PRIORITY[best] ? c.kind : best), "pause")
    const ranges = step.map((c) => ({ start: c.start, end: c.end }))
    let applied = await ctx.apply(STEP_OF[kind], [{ op: "removeSourceRanges", mediaId: ctx.mediaId, ranges }])
    if (!applied.ok && blockedByCaptions(applied.reason) && !captionsRemoved) {
      // Captions this panel made in parts block the cut: they go, the cut lands, and they are made again after.
      const panelCaptions = ctx.timeline.items.filter((i) => i.type === "subtitle" && i.label === "Captions").map((i) => i.id)
      if (panelCaptions.length > 0) {
        const removed = await ctx.apply("captions", [{ op: "removeItems", ids: panelCaptions }])
        if (removed.ok) {
          captionsRemoved = true
          applied = await ctx.apply(STEP_OF[kind], [{ op: "removeSourceRanges", mediaId: ctx.mediaId, ranges }])
        }
      }
    }
    ctx.show.unmark("cut")
    // The join, played back: the cut is real.
    if (applied.ok && from && step.length === 1 && shown < PLAYED_JOINS) {
      shown += 1
      await ctx.preview(Math.max(0, from.frame - Math.round(ctx.fps * 0.6)), 1300)
    }
    if (applied.ok) {
      for (const c of step) {
        counts[c.kind] += 1
        if (c.kind === "filler") ctx.feed("cutter", "freecutAi.cutFiller", { word: c.words ?? "" })
        else if (c.kind === "mistake") ctx.feed("cutter", "freecutAi.cutMistake", { seconds: seconds(c.end - c.start) })
        else ctx.feed("cutter", "freecutAi.cutPause", { seconds: seconds(c.end - c.start) })
      }
    } else {
      refused = applied.reason || refused
      ctx.feed("cutter", "freecutAi.opRefused", { reason: applied.reason })
    }
    done += step.length
    progress()
    if (from) ctx.show.at("cutter", { frame: from.frame, trackId: from.trackId }, { note: ctx.say("freecutAi.removed", { seconds: removed() }) })
    await ctx.show.wait(step.length === 1 ? 220 : 120)
  }
  ctx.working("cutter", false)
  return { pausesCut: counts.pause, fillersCut: counts.filler, mistakesCut: counts.mistake, refused, captionsRemoved }
}

/** How many seconds the cuts took off, for the cards. */
export const secondsRemoved = (fromSeconds: number, ctx: RunContext) => Math.max(0, fromSeconds - timelineSeconds(ctx.timeline))
