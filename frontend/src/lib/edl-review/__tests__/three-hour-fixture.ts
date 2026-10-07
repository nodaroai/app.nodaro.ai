/**
 * The 3-hour episode the inspector's budgets are measured on (§2.4 of the
 * inspectors design): about 30k words, 3k dropped spans (844 of them fillers),
 * two cameras and a master-audio track, the shape Edit Plan's tighten mode
 * emits. Deterministic, so a timing is always taken on the same plan.
 *
 * Each 3.6 s block is one kept segment (ten words) and one dropped span.
 * Filler and false-start spans hold a word (the "um" that was cut); silences,
 * no-picture spans and tangents hold none. The cameras alternate every
 * segment, so restored time really takes a neighbour's look.
 */
import { normalizeEdl, normalizeTranscript, type Edl, type Transcript } from "@nodaro/shared"
import type { ReviewRenderContext } from "../restore"
import { TIMING_UNDER_COVERAGE } from "@/test/coverage-flag"

export const THREE_HOUR_BLOCKS = 3000
export const THREE_HOUR_FILLERS = 844
const BLOCK_MS = 3600
const KEPT_MS = 3000
const WORDS_PER_KEPT = 10

/** The reason of block `b`'s dropped span: 844 fillers, then the rest spread over the others. */
function reasonOf(b: number): string {
  // Every 3rd block up to 844 fillers; the rest cycle through the planner's other reasons.
  if (b % 3 === 1 && Math.floor(b / 3) < THREE_HOUR_FILLERS) return "filler"
  const others = ["silence", "silence", "silence", "false-start", "silence", "tangent", "silence", "no-picture"]
  return others[b % others.length]!
}

export interface ThreeHourSession {
  readonly base: Edl
  readonly transcript: Transcript
}

/** The 3-hour episode the budgets name. */
export function threeHourSession(): ThreeHourSession {
  return sessionOf(THREE_HOUR_BLOCKS)
}

/** The same episode with `blocks` blocks: what the shape checks compare at two
 *  sizes. Fillers stay capped at THREE_HOUR_FILLERS, so a shorter episode has
 *  fewer (every 3rd block). */
export function sessionOf(blocks: number): ThreeHourSession {
  const segments: Array<Record<string, unknown>> = []
  const dropped: Array<Record<string, unknown>> = []
  const words: Array<Record<string, unknown>> = []
  for (let b = 0; b < blocks; b++) {
    const t0 = b * BLOCK_MS
    const speaker = Math.floor(b / 4) % 2 === 0 ? "Host" : "Guest"
    segments.push({ id: `seg-${b}`, inMs: t0, outMs: t0 + KEPT_MS, video: b % 2 === 0 ? "cam-a" : "cam-b", audio: "mic" })
    for (let w = 0; w < WORDS_PER_KEPT; w++) {
      const s = t0 + 50 + w * 290
      words.push({ text: w === WORDS_PER_KEPT - 1 ? `word${b}.` : `word${b}`, startMs: s, endMs: s + 260, speaker })
    }
    const reason = reasonOf(b)
    dropped.push({ inMs: t0 + KEPT_MS, outMs: t0 + BLOCK_MS, reason })
    if (reason === "filler" || reason === "false-start") {
      words.push({ text: "um", startMs: t0 + KEPT_MS + 150, endMs: t0 + KEPT_MS + 450, speaker })
    }
  }
  const base = normalizeEdl({
    version: 1,
    clock: "master",
    sources: [
      { id: "cam-a", url: "https://cdn.test/cam-a.mp4", kind: "video", role: "camera" },
      { id: "cam-b", url: "https://cdn.test/cam-b.mp4", kind: "video", role: "camera" },
      { id: "mic", url: "https://cdn.test/mic.wav", kind: "audio", role: "master-audio" },
    ],
    segments,
    dropped,
  })
  return { base, transcript: normalizeTranscript({ version: 1, words }) }
}

/** The render a 3-hour Tighten review is for: video, hard cuts, no overrides. */
export const THREE_HOUR_RENDER: ReviewRenderContext = { output: "video", crossfadeMs: 0, sources: [] }

/**
 * How much slower these timings run than on the machine the budgets are for.
 * Two separate causes, so two separate factors. Measured on one restore
 * judgement of this fixture (decided 2026-10-06): 14 ms on a developer machine
 * without coverage, 59-68 ms under v8 coverage on that same machine (coverage
 * alone ×4.3-4.9), 136 ms under coverage on the shared 2-vCPU CI runner (×9.7
 * in all, so the runner alone is ×2.3).
 *
 * Coverage applies wherever `--coverage` is on (vitest.config.ts tells the
 * workers through TIMING_UNDER_COVERAGE), CI or not; the runner factor applies
 * on CI, with or without coverage. The wall-clock budgets are user-facing
 * latency targets for real machines, so they stay exact on a plain local run;
 * elsewhere they are a looser guard, and the shape of the work is pinned by
 * machine-independent counts beside them (review-budgets).
 */
export const COVERAGE_SLOWDOWN = 5
export const CI_RUNNER_SLOWDOWN = 2.5

/** A latency budget in ms: as the design states it, scaled for coverage and for the CI runner. */
export function budgetMs(ms: number, env: Record<string, string | undefined> = process.env): number {
  const coverage = env[TIMING_UNDER_COVERAGE] ? COVERAGE_SLOWDOWN : 1
  const runner = env.CI ? CI_RUNNER_SLOWDOWN : 1
  return ms * coverage * runner
}

/** The fastest of `runs` timings of `fn`, in ms: the cost of the work, not of the machine's noise. */
export function fastestMs(fn: () => void, runs = 5): number {
  let best = Infinity
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    fn()
    best = Math.min(best, performance.now() - start)
  }
  return best
}
