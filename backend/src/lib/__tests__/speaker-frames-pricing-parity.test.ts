// @test-watches backend/src/lib/__tests__/fixtures/speaker-frames-pricing-cases.json
/**
 * Speaker Frames' reserve, as a CROSS-REPO fixture (P3.7, decided 2026-10-16).
 *
 * Two sites reserve a Speaker Frames run and must agree: the cloud plugin's
 * route (`POST /v1/speaker-frames`: its own copy of the scope rule, its own
 * frame count, its probe of a bare video) and the workflow run here
 * (`speakerFramesReserveFrames` + `speakerFramesCreditOverride`). This app is
 * the source of truth for the price: every case below is computed by this
 * repo's code and committed as `fixtures/speaker-frames-pricing-cases.json`;
 * the plugin's `app-pricing-parity.test.ts` runs its route's frame count over
 * the same file and fails on any difference (per-source frames, total,
 * blocks, base credits, or a refusal's code).
 *
 * Here: the committed fixture must equal what this code computes (so it can
 * never go stale against the app), the workflow run's own count must give the
 * same frames, and the docs' three worked examples are cases of it.
 *
 * Regenerate after a pricing change: `SF_PRICING_WRITE=1 npx vitest run
 * src/lib/__tests__/speaker-frames-pricing-parity.test.ts`, then land the
 * plugin's matching change after this one (its check reads `dev`).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import type { Edl } from "@nodaro/shared/edl"
import {
  SPEAKER_FRAMES_CEILING_BLOCKS,
  SPEAKER_FRAMES_CREDITS_PER_BLOCK,
  coerceSpeakerFramesEdits,
  speakerFramesBaseCredits,
  speakerFramesBlocks,
  speakerFramesScope,
  speakerFramesScopeFrames,
} from "@nodaro/render-rules"
import { speakerFramesReserveFrames } from "../speaker-frames-plan.js"

const FIXTURE = join(__dirname, "fixtures", "speaker-frames-pricing-cases.json")

interface PricingCase {
  readonly name: string
  /** One edit, a pack (an array), or the JSON string of either — as the route's body carries it. */
  readonly edl?: unknown
  readonly videoUrl?: string
  readonly excludeSourceIds?: readonly string[]
  /** A bare video's length as the server's probe reads it, seconds. */
  readonly probedSec?: number
}

type Expected =
  | {
      readonly sources: ReadonlyArray<{ readonly sourceId: string; readonly frames: number }>
      readonly frames: number
      readonly blocks: number
      readonly creditsPerBlock: number
      readonly baseCredits: number
    }
  | { readonly refused: string }

interface PricedCase extends PricingCase {
  readonly expected: Expected
}

// ── The edits ────────────────────────────────────────────────────────────────
const MIC = { id: "mic", url: "https://media.example/mic.wav", kind: "audio" as const, role: "master-audio" as const }
const cam = (id: string, extra: Record<string, unknown> = {}) => ({ id, url: `https://media.example/${id}.mp4`, kind: "video" as const, ...extra })
const seg = (id: string, inMs: number, outMs: number, video = "wide") => ({ id, inMs, outMs, video })
const edit = (sources: unknown[], segments: unknown[]): Edl => ({ version: 1, clock: "master", sources, segments }) as Edl

/** One wide camera, one segment of `ms` from the top: `⌈(ms + 2 s) × 2 ÷ 1000⌉` frames. */
const wideFor = (ms: number) => edit([MIC, cam("wide")], [seg("s0", 0, ms)])

/** The docs' Tighten example: a 90-minute episode on one wide camera, tightened —
 *  90 kept stretches of 55 s, one a minute (5 s cut between them, more than the
 *  4 s two margins bridge, so no two merge). */
const TIGHTEN_90 = edit(
  [MIC, cam("wide")],
  Array.from({ length: 90 }, (_, k) => seg(`s${k}`, k * 60_000, k * 60_000 + 55_000)),
)

/** The docs' clip pack: 8 clips of 56 s on the same camera, 100 s apart. */
const PACK_8 = Array.from({ length: 8 }, (_, i) => edit([MIC, cam("wide")], [seg("s0", i * 100_000 + 10_000, i * 100_000 + 66_000)]))

const CASES: PricingCase[] = [
  // The block boundary.
  { name: "999 frames: one block", edl: wideFor(497_500) },
  { name: "1,000 frames: one block", edl: wideFor(498_000) },
  { name: "1,001 frames: two blocks", edl: wideFor(498_500) },
  // The docs' three worked examples.
  { name: "docs: a 90-minute episode tightened, one wide camera", edl: TIGHTEN_90 },
  { name: "docs: a clip pack of 8 clips, one run over their union", edl: PACK_8 },
  { name: "docs: a 14-second bare video", videoUrl: "https://media.example/clip.mp4", probedSec: 14 },
  // The scope's rules.
  { name: "a late camera: its spans moved onto its own clock and clamped at its zero", edl: edit([MIC, cam("a"), cam("b", { offsetMs: 4_000 })], [seg("s0", 0, 30_000, "a"), seg("s1", 45_000, 75_000, "b")]) },
  { name: "margins that touch merge (a 3 s cut)", edl: edit([MIC, cam("wide")], [seg("s0", 10_000, 20_000), seg("s1", 23_000, 30_000)]) },
  { name: "margins that do not touch stay apart (a 5 s cut)", edl: edit([MIC, cam("wide")], [seg("s0", 10_000, 20_000), seg("s1", 25_000, 30_000)]) },
  { name: "a pack whose clips overlap on one camera: the union, counted once", edl: [edit([MIC, cam("wide")], [seg("s0", 0, 60_000)]), edit([MIC, cam("wide")], [seg("s0", 30_000, 90_000)])] },
  { name: "the pack as a JSON string", edl: JSON.stringify(PACK_8) },
  { name: "two cameras, one unticked", edl: edit([MIC, cam("a"), cam("b")], [seg("s0", 0, 60_000, "a"), seg("s1", 60_000, 120_000, "b")]), excludeSourceIds: ["b"] },
  { name: "two cameras, both ticked: every video source samples every kept span", edl: edit([MIC, cam("a"), cam("b")], [seg("s0", 0, 60_000, "a"), seg("s1", 60_000, 120_000, "b")]) },
  { name: "exactly 180 minutes kept on one camera", edl: wideFor(180 * 60_000) },
  { name: "the ceiling: 180 minutes on each of 6 cameras", edl: edit([MIC, ...["a", "b", "c", "d", "e", "f"].map((id) => cam(id))], [seg("s0", 0, 180 * 60_000, "a")]) },
  { name: "a bare video of 2 h 59 min 59.7 s", videoUrl: "https://media.example/long.mp4", probedSec: 10_799.7 },
  { name: "a bare video of 0.2 s: the one-block minimum", videoUrl: "https://media.example/blink.mp4", probedSec: 0.2 },
  // Refusals: never priced.
  { name: "over 180 minutes kept on one camera", edl: wideFor(180 * 60_000 + 1) },
  { name: "every camera unticked", edl: edit([MIC, cam("a")], [seg("s0", 0, 60_000, "a")]), excludeSourceIds: ["a"] },
  { name: "an untick naming no camera of the edit", edl: wideFor(60_000), excludeSourceIds: ["gone"] },
  { name: "an edit and a video together", edl: wideFor(60_000), videoUrl: "https://media.example/clip.mp4", probedSec: 60 },
]

function price(c: PricingCase): Expected {
  let edits: Edl[] | undefined
  if (c.edl !== undefined) {
    const coerced = coerceSpeakerFramesEdits(c.edl)
    if (!coerced.ok) return { refused: coerced.code }
    edits = coerced.edits
  }
  const scope = speakerFramesScope({
    ...(edits ? { edits } : {}),
    ...(c.videoUrl ? { videoUrl: c.videoUrl } : {}),
    ...(c.excludeSourceIds ? { excludeSourceIds: c.excludeSourceIds } : {}),
  })
  if (!scope.ok) return { refused: scope.code }
  const frames = speakerFramesScopeFrames(scope.sources, c.probedSec)!
  return {
    sources: scope.sources.map((s) => ({ sourceId: s.sourceId, frames: s.frames ?? speakerFramesScopeFrames([s], c.probedSec)! })),
    frames,
    blocks: speakerFramesBlocks(frames),
    creditsPerBlock: SPEAKER_FRAMES_CREDITS_PER_BLOCK,
    baseCredits: speakerFramesBaseCredits(frames),
  }
}

const computed = (): { version: 1; cases: PricedCase[] } => ({ version: 1, cases: CASES.map((c) => ({ ...c, expected: price(c) })) })

if (process.env.SF_PRICING_WRITE === "1") writeFileSync(FIXTURE, `${JSON.stringify(computed(), null, 2)}\n`)

const priced = (c: PricedCase) => ("refused" in c.expected ? undefined : c.expected)
const byName = (cases: PricedCase[], name: string) => priced(cases.find((c) => c.name === name)!)!

describe("speaker-frames-pricing-cases.json — the app's frame count, for the plugin's route to match", () => {
  const committed = JSON.parse(readFileSync(FIXTURE, "utf8")) as { version: 1; cases: PricedCase[] }

  it("is exactly what this code computes (regenerate with SF_PRICING_WRITE=1)", () => {
    expect(committed).toEqual(JSON.parse(JSON.stringify(computed())))
  })

  it("the workflow run's reserve counts the same frames from the payload it builds, the probe standing in for a bare video", async () => {
    for (const c of committed.cases) {
      const e = priced(c)
      if (!e) continue
      const payload = { ...(c.edl !== undefined ? { edl: c.edl } : {}), ...(c.videoUrl ? { videoUrl: c.videoUrl } : {}), ...(c.excludeSourceIds ? { excludeSourceIds: c.excludeSourceIds } : {}) }
      expect(await speakerFramesReserveFrames(payload, async () => c.probedSec!), c.name).toBe(e.frames)
    }
  })

  it("covers the block boundary, the minimum, the ceiling and the refusals", () => {
    const blocks = committed.cases.map(priced).filter((e) => e !== undefined).map((e) => e!.blocks)
    expect(byName(committed.cases, "999 frames: one block")).toMatchObject({ frames: 999, blocks: 1 })
    expect(byName(committed.cases, "1,000 frames: one block")).toMatchObject({ frames: 1000, blocks: 1 })
    expect(byName(committed.cases, "1,001 frames: two blocks")).toMatchObject({ frames: 1001, blocks: 2 })
    expect(byName(committed.cases, "the ceiling: 180 minutes on each of 6 cameras").blocks).toBe(SPEAKER_FRAMES_CEILING_BLOCKS)
    expect(Math.min(...blocks)).toBe(1)
    expect(committed.cases.filter((c) => "refused" in c.expected).map((c) => (c.expected as { refused: string }).refused).sort()).toEqual(["invalid_input", "invalid_input", "invalid_input", "too_long"])
  })

  it("holds the docs' worked examples (docs/nodes/processing-video/speaker-frames.md)", () => {
    expect(byName(committed.cases, "docs: a 90-minute episode tightened, one wide camera")).toMatchObject({ frames: 10_616, blocks: 11, baseCredits: 22 })
    expect(byName(committed.cases, "docs: a clip pack of 8 clips, one run over their union")).toMatchObject({ frames: 960, blocks: 1, baseCredits: 2 })
    expect(byName(committed.cases, "docs: a 14-second bare video")).toMatchObject({ frames: 28, blocks: 1, baseCredits: 2 })
  })
})
