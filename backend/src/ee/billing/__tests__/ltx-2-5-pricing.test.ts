// @test-units-by-name looks up only the ltx-2.5 credit rows it names
// @test-watches supabase/migrations/687_ltx_2_5_pricing.sql
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
import { buildVideoCreditModelIdentifier, pricedVideoSelection, videoGenerationCreditId } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { PRICING_DEFAULT_RESOLUTION, pricedOutputDurationSec } from "@nodaro/shared/models"
import { STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "../credits.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import { resolveVideoRequestNorm } from "../../../lib/video-request-norm.js"
import type { SimpleNode } from "../../../services/workflow-engine/types.js"

/**
 * LTX 2.5 — one per-second ladder per tier and resolution, the same on both
 * endpoints and at every frame rate, from KIE's published rates (read
 * 2026-11-22), in KIE credits a second:
 *
 *   tier  720p   1080p  1440p
 *   Fast  10.8   15.6   22.8   (1440p: 6-10 s only)
 *   Pro   14.4   20.4   —
 *
 * Base credits = KIE cr/s × seconds × 2.5, rounded up to the next 10 — the
 * per-second ladder rule (decided 2026-11-22). Computed here in integer tenths
 * of a KIE credit, so a float can never move a row that lands exactly on a ten
 * (270, 390, 540, 570, 780, 360, 510). The seed migration seeds the same rows
 * (static-costs-match-migrations.test.ts; read here too).
 */
const RATE_TENTHS: Record<string, Record<string, number>> = {
  "ltx-2.5-fast": { "720p": 108, "1080p": 156, "1440p": 228 },
  "ltx-2.5-pro": { "720p": 144, "1080p": 204 },
}
const LENGTHS: Record<string, Record<string, readonly number[]>> = {
  "ltx-2.5-fast": { "720p": [6, 8, 10, 12, 14, 16, 18, 20], "1080p": [6, 8, 10, 12, 14, 16, 18, 20], "1440p": [6, 8, 10] },
  "ltx-2.5-pro": { "720p": [6, 8, 10], "1080p": [6, 8, 10] },
}
const ladder = (id: string, res: string, sec: number) => Math.ceil((RATE_TENTHS[id]![res]! * sec * 25) / 1000) * 10
const rowId = (id: string, sec: number, res: string) => `${id}:${sec}s:${res}`

/** The approved rows, as listed (decided 2026-11-22). */
const APPROVED: Record<string, Record<string, readonly number[]>> = {
  "ltx-2.5-fast": {
    "720p": [170, 220, 270, 330, 380, 440, 490, 540],
    "1080p": [240, 320, 390, 470, 550, 630, 710, 780],
    "1440p": [350, 460, 570],
  },
  "ltx-2.5-pro": { "720p": [220, 290, 360], "1080p": [310, 410, 510] },
}

describe("ltx-2.5 static credits", () => {
  it("prices every length each tier renders at every resolution by the ladder rule, and that is the approved table", () => {
    for (const id of Object.keys(LENGTHS)) {
      for (const [res, lengths] of Object.entries(LENGTHS[id]!)) {
        lengths.forEach((sec, i) => {
          expect(STATIC_CREDIT_COSTS[rowId(id, sec, res)], rowId(id, sec, res)).toBe(ladder(id, res, sec))
          expect(STATIC_CREDIT_COSTS[rowId(id, sec, res)], rowId(id, sec, res)).toBe(APPROVED[id]![res]![i])
        })
      }
    }
  })

  it("carries exactly the bare ids plus 19 Fast and 6 Pro rows — no 1440p row past 10 s, no 1440p on Pro", () => {
    const fast = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k === "ltx-2.5-fast" || k.startsWith("ltx-2.5-fast:"))
    const pro = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k === "ltx-2.5-pro" || k.startsWith("ltx-2.5-pro:"))
    expect(fast).toHaveLength(1 + 19)
    expect(pro).toHaveLength(1 + 6)
    expect(fast.some((k) => /:(1[2-9]|20)s:1440p$/.test(k))).toBe(false)
    expect(pro.some((k) => k.endsWith(":1440p"))).toBe(false)
  })

  it("the bare ids equal the default render they stand for (10 s @ 1080p)", () => {
    for (const id of ["ltx-2.5-fast", "ltx-2.5-pro"]) {
      expect(PRICING_DEFAULT_RESOLUTION[id]).toBe("1080p")
      expect(pricedOutputDurationSec(id, undefined)).toBe(10)
      expect(STATIC_CREDIT_COSTS[id]).toBe(STATIC_CREDIT_COSTS[rowId(id, 10, "1080p")])
    }
    expect(STATIC_CREDIT_COSTS["ltx-2.5-fast"]).toBe(390)
    expect(STATIC_CREDIT_COSTS["ltx-2.5-pro"]).toBe(510)
  })

  it("every id the builder can emit is priced (no price_not_configured), at any length and resolution", () => {
    for (const id of ["ltx-2.5-fast", "ltx-2.5-pro"]) {
      for (const d of [undefined, -1, 0, 1, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 19, 20, 21, 30, "14"]) {
        for (const r of [undefined, "720p", "1080p", "1440p", "1440P", "2k", "4k", "480p", "garbage"]) {
          for (const mode of ["image-to-video", "text-to-video"] as const) {
            for (const sound of [undefined, true, false]) {
              const credit = buildVideoCreditModelIdentifier(id, d, sound, mode, undefined, r, false)
              expect(STATIC_CREDIT_COSTS[credit], `${credit} (d=${d}, r=${r})`).toBeTypeOf("number")
            }
          }
        }
      }
    }
  })

  it("the sound adds nothing: the identifier never carries an audio suffix", () => {
    expect(buildVideoCreditModelIdentifier("ltx-2.5-fast", 8, true, "image-to-video", undefined, "720p")).toBe("ltx-2.5-fast:8s:720p")
    expect(buildVideoCreditModelIdentifier("ltx-2.5-fast", 8, false, "image-to-video", undefined, "720p")).toBe("ltx-2.5-fast:8s:720p")
    expect(buildVideoCreditModelIdentifier("ltx-2.5-pro", 6, { sound: true, generateAudio: true }, "text-to-video", undefined, "1080p")).toBe("ltx-2.5-pro:6s:1080p")
  })

  it("every catalog pricing row agrees with the static table", () => {
    for (const id of ["ltx-2.5-fast", "ltx-2.5-pro"]) {
      for (const row of MODEL_CATALOG[id]!.pricing) {
        expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
      }
    }
  })

  it("the seed migration seeds exactly these rows at these prices", () => {
    const sql = readFileSync(resolve(__dirname, "../../../../../supabase/migrations/687_ltx_2_5_pricing.sql"), "utf8")
    const seeded = Object.fromEntries([...sql.matchAll(/\('(ltx-2\.5-[^']+)', (\d+), true, 'video'\)/g)].map((m) => [m[1]!, Number(m[2])]))
    const statics = Object.fromEntries(Object.entries(STATIC_CREDIT_COSTS).filter(([k]) => k.startsWith("ltx-2.5-")))
    expect(seeded).toEqual(statics)
  })
})

/**
 * One run, one row, on every surface that prices it — the routes (their
 * preHandler normalizes through `resolveVideoRequestNorm`, frame rate
 * included), the workflow run (payload-builder), the pre-run estimate
 * (getNodeModelIdentifier) and the editor's shared quote
 * (videoGenerationCreditId) — and the run SENDS the length, resolution and
 * frame rate it reserved.
 */
describe("ltx-2.5: reservation = quote = DAG = editor estimate", () => {
  const START = "https://cdn.example/start.png"
  const CASES: Array<{ id: string; duration?: number; resolution?: string; fps?: number; expected: string; sentFps: number }> = [
    { id: "ltx-2.5-fast", expected: rowId("ltx-2.5-fast", 10, "1080p"), sentFps: 24 },
    { id: "ltx-2.5-pro", expected: rowId("ltx-2.5-pro", 10, "1080p"), sentFps: 24 },
    { id: "ltx-2.5-fast", duration: 6, resolution: "720p", expected: rowId("ltx-2.5-fast", 6, "720p"), sentFps: 24 },
    { id: "ltx-2.5-fast", duration: 20, resolution: "1080p", fps: 25, expected: rowId("ltx-2.5-fast", 20, "1080p"), sentFps: 25 },
    // The long-clip limit: 1440p, or 48 / 50 fps, on Fast → 10 s at most.
    { id: "ltx-2.5-fast", duration: 16, resolution: "1440p", expected: rowId("ltx-2.5-fast", 10, "1440p"), sentFps: 24 },
    { id: "ltx-2.5-fast", duration: 20, resolution: "720p", fps: 50, expected: rowId("ltx-2.5-fast", 10, "720p"), sentFps: 50 },
    { id: "ltx-2.5-fast", duration: 12, resolution: "1080p", fps: 48, expected: rowId("ltx-2.5-fast", 10, "1080p"), sentFps: 48 },
    { id: "ltx-2.5-fast", duration: 8, resolution: "1440p", fps: 50, expected: rowId("ltx-2.5-fast", 8, "1440p"), sentFps: 50 },
    // A length between rungs moves to the nearest one.
    { id: "ltx-2.5-fast", duration: 7, resolution: "720p", expected: rowId("ltx-2.5-fast", 6, "720p"), sentFps: 24 },
    // Pro: no cap at 48 / 50 fps; 1440p (not its own) runs at 1080p.
    { id: "ltx-2.5-pro", duration: 8, resolution: "720p", fps: 48, expected: rowId("ltx-2.5-pro", 8, "720p"), sentFps: 48 },
    { id: "ltx-2.5-pro", duration: 6, resolution: "1440p", expected: rowId("ltx-2.5-pro", 6, "1080p"), sentFps: 24 },
    // A frame rate it does not render runs at its default.
    { id: "ltx-2.5-fast", duration: 20, resolution: "720p", fps: 30, expected: rowId("ltx-2.5-fast", 20, "720p"), sentFps: 24 },
  ]

  function node(id: string, data: Record<string, unknown>): SimpleNode {
    return { id: "ltx-1", type: "generate-video", data: { provider: id, prompt: "a baker knocks on a loaf", ...data } }
  }

  for (const c of CASES) {
    const settings: Record<string, unknown> = {}
    if (c.duration !== undefined) settings.duration = c.duration
    if (c.resolution !== undefined) settings.resolution = c.resolution
    if (c.fps !== undefined) settings.fps = c.fps
    const label = `${c.id} ${JSON.stringify(settings)}`

    it(`${label} → ${c.expected}`, () => {
      const [, sentSec, sentRes] = /:(\d+)s:(\d+p)$/.exec(c.expected)!
      // The routes: both lanes normalize first (frame rate included), then build the id.
      for (const mode of ["image-to-video", "text-to-video"] as const) {
        const norm = resolveVideoRequestNorm({ provider: c.id, resolution: c.resolution, duration: c.duration, fps: c.fps })
        expect(buildVideoCreditModelIdentifier(c.id, norm.duration ?? c.duration, undefined, mode, undefined, norm.resolution, false), `route ${mode}`).toBe(c.expected)
        expect(norm.duration, "route sends the priced length").toBe(Number(sentSec))
        expect(norm.fps, "route sends the frame rate").toBe(c.sentFps)
      }
      // The workflow run, with a start frame (image-to-video) and without one (text-to-video).
      for (const [inputs, jobName] of [[{ startFrameUrl: START }, "image-to-video"], [{}, "text-to-video"]] as const) {
        const built = buildPayload(node(c.id, settings), "job-1", inputs, undefined, { nodes: [node(c.id, settings)], edges: [], nodeStates: {} })
        expect(built.jobName).toBe(jobName)
        expect(built.modelIdentifier, `DAG ${jobName}`).toBe(c.expected)
        expect(built.payload.duration, `DAG ${jobName} length`).toBe(Number(sentSec))
        expect(built.payload.resolution, `DAG ${jobName} resolution`).toBe(sentRes)
        expect(built.payload.fps, `DAG ${jobName} frame rate`).toBe(c.sentFps)
      }
      // The pre-run estimate, on the unified node and both legacy nodes.
      for (const type of ["generate-video", "image-to-video", "text-to-video"]) {
        expect(getNodeModelIdentifier({ id: "ltx-1", type, data: { provider: c.id, ...settings } }), `estimate ${type}`).toBe(c.expected)
      }
      // The editor's shared quote (node pill + run estimate).
      expect(videoGenerationCreditId({ provider: c.id, duration: c.duration, resolution: c.resolution, fps: c.fps }), "editor").toBe(c.expected)
    })
  }

  it("a capped request is disclosed, and the frame rate the model does not render too", () => {
    const capped = resolveVideoRequestNorm({ provider: "ltx-2.5-fast", resolution: "720p", duration: 20, fps: 50 })
    expect(capped.adjustments.map((a) => [a.field, a.from, a.to])).toEqual([["duration", 20, 10]])
    const offRate = resolveVideoRequestNorm({ provider: "ltx-2.5-pro", duration: 6, fps: 30 })
    expect(offRate.adjustments.map((a) => [a.field, a.from, a.to])).toEqual([["fps", "30", 24]])
    expect(pricedVideoSelection({ provider: "ltx-2.5-fast", resolution: "1440p", duration: 18 }).duration).toBe(10)
  })

  it("the workflow run reads a stored frame rate as the routes do: a numeric string, a fraction, 0", () => {
    const run = (fps: unknown) => buildPayload(node("ltx-2.5-fast", { duration: 20, resolution: "720p", fps }), "job-1", {}, undefined, { nodes: [node("ltx-2.5-fast", { duration: 20, resolution: "720p", fps })], edges: [], nodeStates: {} })
    expect(run("50")).toMatchObject({ modelIdentifier: "ltx-2.5-fast:10s:720p", payload: { fps: 50, duration: 10 } })
    expect(run(29.97)).toMatchObject({ modelIdentifier: "ltx-2.5-fast:20s:720p", payload: { fps: 24, duration: 20 } })
    expect(run(0)).toMatchObject({ modelIdentifier: "ltx-2.5-fast:20s:720p", payload: { fps: 24, duration: 20 } })
    // The editor's quote reads it the same way.
    expect(videoGenerationCreditId({ provider: "ltx-2.5-fast", duration: 20, resolution: "720p", fps: "50" })).toBe("ltx-2.5-fast:10s:720p")
  })

  it("LTX 2.3's workflow payload still carries the stored frame rate, from its own branch", () => {
    for (const provider of ["ltx-2.3-pro", "ltx-2.3-fast"]) {
      const n = node(provider, { duration: 6, resolution: "1080p", fps: 50 })
      const built = buildPayload(n, "job-1", {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
      expect(built.payload.fps, provider).toBe(50)
    }
  })

  it("a model without a frame-rate setting is sent none, whatever the request carries (LTX 2.3 included)", () => {
    for (const provider of ["ltx-2.3-pro", "ltx-2.3-fast", "seedance-2-fast", "pixverse-v6-max"]) {
      expect(resolveVideoRequestNorm({ provider, duration: 8, fps: 50 }).fps, provider).toBeUndefined()
    }
  })
})
