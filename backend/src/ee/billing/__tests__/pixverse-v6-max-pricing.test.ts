// @test-units-by-name looks up only the pixverse-v6-max credit rows it names
import { describe, it, expect } from "vitest"
import { buildVideoCreditModelIdentifier, videoGenerationCreditId } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { PRICING_DEFAULT_RESOLUTION, pricedOutputDurationSec } from "@nodaro/shared/models"
import { STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "../credits.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import { resolveVideoRequestNorm } from "../../../lib/video-request-norm.js"
import type { SimpleNode } from "../../../services/workflow-engine/types.js"

/**
 * PixVerse V6 Max — one per-second ladder per quality, with and without native
 * audio, the same on both endpoints, from KIE's published rates (read
 * 2026-11-11), in KIE credits a second:
 *
 *   quality  no audio  audio
 *   360p     4.8       7.2
 *   540p     7.2       8.8
 *   720p     8.8       12
 *   1080p    17.6      22.4
 *
 * Base credits = KIE cr × 2.5, rounded up to the next 10 — the per-second
 * ladder rule. The ×2.5 rates are whole numbers (12/18, 18/22, 22/30, 44/56),
 * so the rule runs in integers and a float can never move a row. The seed
 * migration seeds the same rows (static-costs-match-migrations.test.ts).
 */
const ID = "pixverse-v6-max"
const DURATIONS = Array.from({ length: 15 }, (_, i) => i + 1)
const QUALITIES = ["360p", "540p", "720p", "1080p"] as const
const BASE_PER_SEC: Record<(typeof QUALITIES)[number], readonly [silent: number, audio: number]> = {
  "360p": [12, 18],
  "540p": [18, 22],
  "720p": [22, 30],
  "1080p": [44, 56],
}
const ladder = (q: (typeof QUALITIES)[number], sec: number, audio: boolean) =>
  Math.ceil((BASE_PER_SEC[q][audio ? 1 : 0] * sec) / 10) * 10
const rowId = (q: string, sec: number, audio: boolean) => `${ID}:${sec}s:${q}${audio ? ":audio" : ""}`

describe("pixverse-v6-max static credits", () => {
  it("prices every second 1-15 at every quality, with and without audio, by the ladder rule", () => {
    for (const q of QUALITIES) {
      for (const d of DURATIONS) {
        for (const audio of [false, true]) {
          expect(STATIC_CREDIT_COSTS[rowId(q, d, audio)], rowId(q, d, audio)).toBe(ladder(q, d, audio))
        }
      }
    }
  })

  it("matches the worked examples: 5s base 60/90, 90/110, 110/150, 220/280; 15s 1080p with audio 840", () => {
    expect([STATIC_CREDIT_COSTS[rowId("360p", 5, false)], STATIC_CREDIT_COSTS[rowId("360p", 5, true)]]).toEqual([60, 90])
    expect([STATIC_CREDIT_COSTS[rowId("540p", 5, false)], STATIC_CREDIT_COSTS[rowId("540p", 5, true)]]).toEqual([90, 110])
    expect([STATIC_CREDIT_COSTS[rowId("720p", 5, false)], STATIC_CREDIT_COSTS[rowId("720p", 5, true)]]).toEqual([110, 150])
    expect([STATIC_CREDIT_COSTS[rowId("1080p", 5, false)], STATIC_CREDIT_COSTS[rowId("1080p", 5, true)]]).toEqual([220, 280])
    expect(STATIC_CREDIT_COSTS[rowId("1080p", 15, true)]).toBe(840)
    // A 1s 360p clip still rounds up to a whole 10.
    expect(STATIC_CREDIT_COSTS[rowId("360p", 1, false)]).toBe(20)
  })

  it("carries exactly the bare id plus 15 × 4 × 2 = 120 rows — nothing past 15s, no other quality", () => {
    const keys = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k === ID || k.startsWith(`${ID}:`))
    expect(keys).toHaveLength(1 + 120)
    expect(keys.some((k) => /:(1[6-9]|[2-9]\d)s:/.test(k))).toBe(false)
    expect(keys.filter((k) => k !== ID).every((k) => /^pixverse-v6-max:(\d+)s:(360p|540p|720p|1080p)(:audio)?$/.test(k))).toBe(true)
  })

  it("the bare id equals the default render it stands for (5s @ 720p with audio)", () => {
    expect(PRICING_DEFAULT_RESOLUTION[ID]).toBe("720p")
    expect(pricedOutputDurationSec(ID, undefined)).toBe(5)
    expect(STATIC_CREDIT_COSTS[ID]).toBe(STATIC_CREDIT_COSTS[rowId("720p", 5, true)])
    expect(STATIC_CREDIT_COSTS[ID]).toBe(150)
  })

  it("every id the builder can emit is priced (no price_not_configured)", () => {
    for (const d of [undefined, 0, 1, ...DURATIONS, 16, 30, 60]) {
      for (const r of [undefined, ...QUALITIES, "1080P", "480p", "4k", "garbage"]) {
        for (const sound of [undefined, true, false]) {
          for (const mode of ["image-to-video", "text-to-video"] as const) {
            for (const ref of [false, true]) {
              const credit = buildVideoCreditModelIdentifier(ID, d, sound, mode, undefined, r, ref)
              expect(STATIC_CREDIT_COSTS[credit], `${credit} (d=${d}, r=${r}, sound=${sound}, ref=${ref})`).toBeTypeOf("number")
            }
          }
        }
      }
    }
  })

  it("every catalog pricing row agrees with the static table", () => {
    for (const row of MODEL_CATALOG[ID]!.pricing) {
      expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
    }
  })
})

/**
 * One run, one row, on every surface that prices it. The route (its
 * preHandler normalizes, then builds the id from the body's `sound`), the
 * workflow run (payload-builder), the pre-run estimate (getNodeModelIdentifier)
 * and the editor's shared quote (videoGenerationCreditId — the node pill and
 * the run estimate read it) must name the same row for the same settings, on
 * both lanes and both audio states — and the run must SEND the audio state it
 * reserved.
 */
describe("pixverse-v6-max: reservation = quote = DAG = editor estimate", () => {
  const START = "https://cdn.example/start.png"
  const CASES: Array<{ duration?: number; resolution?: string; sound?: boolean; kling3Sound?: boolean; generateAudio?: boolean; expected: string }> = [
    { expected: rowId("720p", 5, true) },
    { sound: false, expected: rowId("720p", 5, false) },
    { duration: 1, resolution: "360p", sound: false, expected: rowId("360p", 1, false) },
    { duration: 3, resolution: "540p", sound: true, expected: rowId("540p", 3, true) },
    { duration: 8, resolution: "1080p", expected: rowId("1080p", 8, true) },
    { duration: 15, resolution: "1080p", sound: true, expected: rowId("1080p", 15, true) },
    { duration: 12, resolution: "720p", sound: false, expected: rowId("720p", 12, false) },
    // An older node's `kling3Sound` is read where `sound` is unset, on every path.
    { duration: 6, resolution: "540p", kling3Sound: false, expected: rowId("540p", 6, false) },
    // An unknown quality is billed (and sent) as 720p.
    { duration: 4, resolution: "4k", sound: true, expected: rowId("720p", 4, true) },
    // `generateAudio` is read where `sound` is unset, on every path…
    { duration: 5, resolution: "720p", generateAudio: false, expected: rowId("720p", 5, false) },
    { duration: 9, resolution: "1080p", generateAudio: true, expected: rowId("1080p", 9, true) },
    // …and `sound` wins over it.
    { duration: 2, resolution: "360p", sound: true, generateAudio: false, expected: rowId("360p", 2, true) },
    { duration: 2, resolution: "360p", sound: false, generateAudio: true, expected: rowId("360p", 2, false) },
  ]

  function node(data: Record<string, unknown>): SimpleNode {
    return { id: "pv-1", type: "generate-video", data: { provider: ID, prompt: "a lighthouse in a storm", ...data } }
  }

  for (const c of CASES) {
    const settings: Record<string, unknown> = {}
    if (c.duration !== undefined) settings.duration = c.duration
    if (c.resolution !== undefined) settings.resolution = c.resolution
    if (c.sound !== undefined) settings.sound = c.sound
    if (c.kling3Sound !== undefined) settings.kling3Sound = c.kling3Sound
    if (c.generateAudio !== undefined) settings.generateAudio = c.generateAudio
    const label = JSON.stringify(settings)

    it(`${label} → ${c.expected}`, () => {
      const soundIntent = c.sound ?? c.kling3Sound
      const audio = { sound: soundIntent, generateAudio: c.generateAudio }
      // The routes: both lanes normalize first, then build from the body's audio fields.
      for (const mode of ["image-to-video", "text-to-video"] as const) {
        const norm = resolveVideoRequestNorm({ provider: ID, resolution: c.resolution, duration: c.duration })
        expect(buildVideoCreditModelIdentifier(ID, norm.duration ?? c.duration, audio, mode, undefined, norm.resolution, false), `route ${mode}`).toBe(c.expected)
      }
      // The workflow run, with a start frame (image-to-video) and without one (text-to-video).
      const i2v = buildPayload(node(settings), "job-1", { startFrameUrl: START }, undefined, { nodes: [node(settings)], edges: [], nodeStates: {} })
      expect(i2v.jobName).toBe("image-to-video")
      expect(i2v.modelIdentifier, "DAG i2v").toBe(c.expected)
      expect(i2v.payload.sound).toBe(soundIntent)
      expect(i2v.payload.generateAudio).toBe(c.generateAudio)
      const t2v = buildPayload(node(settings), "job-2", {}, undefined, { nodes: [node(settings)], edges: [], nodeStates: {} })
      expect(t2v.jobName).toBe("text-to-video")
      expect(t2v.modelIdentifier, "DAG t2v").toBe(c.expected)
      expect(t2v.payload.sound).toBe(soundIntent)
      expect(t2v.payload.generateAudio).toBe(c.generateAudio)
      // The run sends the quality it reserved.
      expect(i2v.payload.resolution).toBe(c.expected.split(":")[2])
      // The pre-run estimate.
      expect(getNodeModelIdentifier({ id: "pv-1", type: "generate-video", data: { provider: ID, ...settings } }), "estimate").toBe(c.expected)
      expect(getNodeModelIdentifier({ id: "pv-1", type: "text-to-video", data: { provider: ID, ...settings } }), "estimate t2v").toBe(c.expected)
      // The editor's shared quote (node pill + run estimate).
      expect(videoGenerationCreditId({ provider: ID, duration: c.duration, sound: soundIntent, generateAudio: c.generateAudio, resolution: c.resolution }), "editor").toBe(c.expected)
    })
  }
})
