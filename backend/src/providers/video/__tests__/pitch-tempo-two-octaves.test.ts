import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The pitch shift a plugin asks of the host (`tk.media.pitchTempo`) takes up
 * to two octaves either way, half steps included, in ONE rubberband pass
 * (a ratio of 4 or 0.25), at the same speed. Beyond ±24 it is clamped, as the
 * Pitch & Tempo node clamps beyond its own ±12. The node itself is untouched:
 * without `maxSemitones` every value is held to ±12 exactly as before.
 *
 * Only the download, the probe and ffmpeg are replaced: the filter and the
 * arguments are the real ones.
 */
const h = vi.hoisted(() => ({ runs: [] as string[][] }))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-utils.js")>()),
  createWorkDir: async () => "/w",
  cleanupWorkDir: async () => {},
  downloadFile: async () => {},
  probeMediaStreams: async () => ({ hasAudio: true, hasVideo: false }),
  runFfmpeg: async (args: string[]) => {
    h.runs.push(args)
  },
}))

const { PITCH_SHIFT_MAX_SEMITONES, buildRubberbandFilter, normalizePitchTempoSettings, pitchTempo } = await import("../pitch-tempo.js")

beforeEach(() => {
  h.runs = []
})

/** The rubberband filter of each ffmpeg run: the first of its audio filter chain (the full argv is pinned in pitch-tempo.test.ts). */
const filters = () => h.runs.map((args) => args[args.indexOf("-af") + 1]!.split(",")[0])
const shift = (semitones: number, maxSemitones?: number) =>
  pitchTempo({ audioUrl: "https://cdn.example/a.mp3", semitones, tempo: 1, preserveFormants: true, ...(maxSemitones === undefined ? {} : { maxSemitones }) })

describe("two octaves in one pass", () => {
  it("is the widest one pass: 24 semitones", () => {
    expect(PITCH_SHIFT_MAX_SEMITONES).toBe(24)
  })

  it("±24 and the half steps are one rubberband filter each, at the same speed", async () => {
    for (const [semitones, ratio] of [
      [24, "4"],
      [-24, "0.25"],
      [0.5, "1.029302"],
      [-0.5, "0.971532"],
      [13.5, "2.181015"],
      [-23.5, "0.257326"],
    ] as const) {
      h.runs = []
      await shift(semitones, PITCH_SHIFT_MAX_SEMITONES)
      expect(h.runs, String(semitones)).toHaveLength(1)
      expect(filters(), String(semitones)).toEqual([`rubberband=pitch=${ratio}:tempo=1:formant=preserved:pitchq=quality`])
    }
  })

  it("clamps beyond ±24, as the node clamps beyond its ±12", async () => {
    await shift(30, PITCH_SHIFT_MAX_SEMITONES)
    await shift(-31.5, PITCH_SHIFT_MAX_SEMITONES)
    expect(filters()).toEqual([
      "rubberband=pitch=4:tempo=1:formant=preserved:pitchq=quality",
      "rubberband=pitch=0.25:tempo=1:formant=preserved:pitchq=quality",
    ])
    expect(normalizePitchTempoSettings({ semitones: "-40" }, PITCH_SHIFT_MAX_SEMITONES).semitones).toBe(-24)
    // Never wider than one pass takes, whatever is asked.
    expect(normalizePitchTempoSettings({ semitones: 36 }, 48).semitones).toBe(24)
  })

  it("leaves the node's ±12 as it was: beyond it clamped, within it the same filter whatever the cap", async () => {
    await shift(24)
    await shift(-20)
    expect(filters()).toEqual([
      "rubberband=pitch=2:tempo=1:formant=preserved:pitchq=quality",
      "rubberband=pitch=0.5:tempo=1:formant=preserved:pitchq=quality",
    ])
    for (const semitones of [-12, -7.5, -0.5, 0, 0.5, 3, 4, 11.5, 12]) {
      const node = normalizePitchTempoSettings({ semitones })
      const wide = normalizePitchTempoSettings({ semitones }, PITCH_SHIFT_MAX_SEMITONES)
      expect(wide, String(semitones)).toEqual(node)
      expect(buildRubberbandFilter(wide)).toBe(buildRubberbandFilter(node))
      h.runs = []
      await shift(semitones)
      await shift(semitones, PITCH_SHIFT_MAX_SEMITONES)
      expect(filters()[1], String(semitones)).toBe(filters()[0])
    }
  })
})
