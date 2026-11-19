/**
 * Real-ffmpeg e2e for `runSilenceDetectOnFile` (silence-detect.ts).
 *
 * Same lavfi fixture idiom as trim-edge-frames.e2e.test.ts / slideshow.e2e —
 * spawns the actual ffmpeg binary. A 6 s tone muted between t=2..4 must recover
 * exactly one silence range near [2 s, 4 s], shrunk inward by the pad. The pure
 * parse/pad logic is covered hermetically in silence-detect.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { runFfmpeg } from "../../video/ffmpeg-utils.js"
import { runSilenceDetectOnFile } from "../silence-detect.js"

describe("runSilenceDetectOnFile (e2e, real ffmpeg)", () => {
  let dir: string
  beforeAll(async () => { dir = await fs.mkdtemp(join(tmpdir(), "silence-detect-e2e-")) })
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}) })

  // A 6 s 440 Hz tone, muted (volume=0) for t in [2, 4] → a 2 s silent gap.
  async function makeToneWithGap(path: string): Promise<void> {
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
      "-af", "volume=enable='between(t,2,4)':volume=0",
      path,
    ])
  }

  it("recovers a single silence range near [2s, 4s], padded inward", async () => {
    const src = join(dir, `${randomUUID()}.wav`)
    await makeToneWithGap(src)

    const result = await runSilenceDetectOnFile(src, { thresholdDb: -35, minSilenceMs: 700, padMs: 120 })

    expect(result.version).toBe(1)
    // ~6 s duration.
    expect(Math.abs(result.durationMs - 6000)).toBeLessThan(250)
    // Exactly one silence span.
    expect(result.ranges).toHaveLength(1)
    const r = result.ranges[0]!
    // Raw silence ~[2000, 4000]; padMs 120 shrinks each end. Generous tolerance
    // for silencedetect's RMS-window latency.
    expect(r.startMs).toBeGreaterThan(1950)
    expect(r.startMs).toBeLessThan(2400)
    expect(r.endMs).toBeGreaterThan(3600)
    expect(r.endMs).toBeLessThan(3950)
    expect(r.endMs).toBeGreaterThan(r.startMs)
  }, 60_000)

  it("reports no silence in a continuous tone", async () => {
    const src = join(dir, `${randomUUID()}.wav`)
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", src])

    const result = await runSilenceDetectOnFile(src, { thresholdDb: -35, minSilenceMs: 700, padMs: 120 })
    expect(result.ranges).toHaveLength(0)
    expect(Math.abs(result.durationMs - 4000)).toBeLessThan(250)
  }, 60_000)

  // A 6 s tone muted for 0.12 s at t=1 and for 0.6 s at t=3: a breath and a pause.
  async function makeToneWithTwoGaps(path: string): Promise<void> {
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
      "-af", "volume=enable='between(t,1,1.12)+between(t,3,3.6)':volume=0",
      path,
    ])
  }

  it("with allRangesMinMs, lists every silence unpadded beside the long ones padded — from one pass", async () => {
    const src = join(dir, `${randomUUID()}.wav`)
    await makeToneWithTwoGaps(src)

    const result = await runSilenceDetectOnFile(src, { thresholdDb: -35, minSilenceMs: 350, padMs: 110, allRangesMinMs: 50 })

    // The pause alone is long enough to cut, shrunk by 110 ms at each end.
    expect(result.ranges).toHaveLength(1)
    expect(result.ranges[0]!.startMs).toBeGreaterThan(3050)
    expect(result.ranges[0]!.endMs).toBeLessThan(3550)
    // Both silences, unpadded, in order.
    expect(result.allRanges).toHaveLength(2)
    const [breath, pause] = result.allRanges!
    expect(breath!.startMs).toBeGreaterThan(950)
    expect(breath!.endMs).toBeLessThan(1170)
    expect(pause!.startMs).toBeLessThan(result.ranges[0]!.startMs)
    expect(pause!.endMs).toBeGreaterThan(result.ranges[0]!.endMs)
    // The long one is the same span either way: its padded copy sits 110 ms inside it.
    expect(result.ranges[0]!.startMs - pause!.startMs).toBe(110)
    expect(pause!.endMs - result.ranges[0]!.endMs).toBe(110)
  }, 60_000)

  it("without allRangesMinMs the result is the one it always was: no list", async () => {
    const src = join(dir, `${randomUUID()}.wav`)
    await makeToneWithTwoGaps(src)

    const result = await runSilenceDetectOnFile(src, { thresholdDb: -35, minSilenceMs: 350, padMs: 110 })
    expect(result).not.toHaveProperty("allRanges")
    expect(result.ranges).toHaveLength(1)
  }, 60_000)
})
