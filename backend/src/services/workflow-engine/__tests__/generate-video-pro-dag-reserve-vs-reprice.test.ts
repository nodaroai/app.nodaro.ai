/**
 * A workflow run's Generate Video Pro reservation covers every price the pro
 * engine re-computes for that run.
 *
 * On the workflow (DAG) path the app reserves before the engine runs
 * (`computeGenerateVideoProCreditOverride`, which stamps `payload.proPricing`).
 * The engine then prices the run again with the audio its segments are SENT
 * with, and refuses a natural-segment plan whose price exceeds the reservation
 * ("Natural plan exceeds its original credit reservation"). The engine's audio
 * rule (its `segment-audio.ts`, mirrored below) is:
 *   - `false` on the silent music-video lane (a `lipSync` soundtrack, on by default);
 *   - else on the keyframes transport, on unless the lever is `false`;
 *   - else (extend, the single call) the lever as given — unset keeps the model's default.
 *
 * For each case the reservation's `reserveBase` must be at or above the
 * engine's, so the natural re-price never refuses a run: equal where both price
 * the same audio. The music-video lane is the one case the reservation cannot
 * see (it prices the payload's `generateAudio`, not the lane): there it is
 * ABOVE the engine's price, and since a keyframes run settles on the hold's
 * `segmentCosts`, that difference would be an overcharge, not an over-hold
 * settled down. It cannot happen today: a workflow payload carries no
 * soundtrack, so a workflow run never rides that lane. The lane's cases below
 * pin the direction only (never a refused run). Real pricing throughout;
 * model_pricing lookups miss, so the static credit table answers.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const miss = { data: null, error: { code: "PGRST116" } }
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "in", "is", "order", "limit", "insert", "update", "delete", "upsert", "match", "neq", "gte", "lte"]) chain[m] = () => chain
  chain.single = () => Promise.resolve(miss)
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  return { supabase: { from: () => chain, rpc: () => Promise.resolve({ data: null, error: null }) } }
})

vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: vi.fn().mockResolvedValue({}) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))

import { computeGenerateVideoProCreditOverride } from "../node-executor.js"
import { computeGenerateVideoProPricing, type GenerateVideoProPricing } from "../../../ee/billing/generate-video-pro-credits.js"

/** The pro engine's segment audio (`segment-audio.ts` `segmentGenerateAudio`, music-video silence on). */
function engineSegmentAudio(lever: { generateAudio?: boolean; keyframes: boolean; lipSync: boolean }): boolean | undefined {
  if (lever.lipSync) return false
  return lever.keyframes ? lever.generateAudio !== false : lever.generateAudio
}

interface Case {
  name: string
  provider: string
  renderMethod?: "keyframes"
  generateAudio?: boolean
  lipSync?: boolean
}

const CASES: Case[] = [
  { name: "PixVerse V6 Max, audio on", provider: "pixverse-v6-max", renderMethod: "keyframes", generateAudio: true },
  { name: "PixVerse V6 Max, audio off", provider: "pixverse-v6-max", renderMethod: "keyframes", generateAudio: false },
  { name: "PixVerse V6 Max, audio unset", provider: "pixverse-v6-max", renderMethod: "keyframes" },
  { name: "PixVerse V6 Max, music-video lane (audio on)", provider: "pixverse-v6-max", renderMethod: "keyframes", generateAudio: true, lipSync: true },
  { name: "PixVerse V6 Max, music-video lane (audio unset)", provider: "pixverse-v6-max", renderMethod: "keyframes", lipSync: true },
  { name: "Kling 3.0, audio on", provider: "kling-3.0", renderMethod: "keyframes", generateAudio: true },
  { name: "Kling 3.0, audio off", provider: "kling-3.0", renderMethod: "keyframes", generateAudio: false },
  { name: "Kling 3.0, audio unset", provider: "kling-3.0", renderMethod: "keyframes" },
  { name: "Seedance 2, extend, audio unset (the model default)", provider: "seedance-2" },
  { name: "Seedance 2, keyframes, audio unset (on)", provider: "seedance-2", renderMethod: "keyframes" },
  { name: "MiniMax H3, extend, audio unset (the model default)", provider: "minimax-h3" },
]

function dagPayload(c: Case, durationSec: number, segmentMode?: "short" | "long"): Record<string, unknown> {
  return {
    type: "generate-video-pro",
    provider: c.provider,
    duration: durationSec,
    resolution: "720p",
    aspectRatio: "adaptive",
    ...(c.renderMethod ? { renderMethod: c.renderMethod } : {}),
    ...(c.generateAudio !== undefined ? { generateAudio: c.generateAudio } : {}),
    // A workflow payload carries no soundtrack today; the case states the lane anyway.
    ...(c.lipSync ? { soundtrack: { lipSync: true } } : {}),
    ...(segmentMode ? { segmentMode } : {}),
  }
}

async function reserveOf(payload: Record<string, unknown>): Promise<GenerateVideoProPricing> {
  const r = await computeGenerateVideoProCreditOverride(payload)
  expect(r).toBeDefined()
  return r!.pricing as GenerateVideoProPricing
}

/** Natural source spans the engine's packer may choose inside the reserved bounds. */
function packings(bounds: NonNullable<GenerateVideoProPricing["segmentPlanning"]>): number[][] {
  const out: number[][] = []
  const D = bounds.durationSec
  const fewest = Math.ceil(D / bounds.maxSeg)
  for (let n = fewest; n <= fewest + 3; n++) {
    const base = Math.floor(D / n)
    const parts = Array.from({ length: n }, (_, i) => base + (i < D - base * n ? 1 : 0))
    if (parts.every((p) => p >= bounds.minSeg && p <= bounds.maxSeg)) out.push(parts)
  }
  return out
}

describe("the workflow reserve covers the pro engine's re-price", () => {
  for (const c of CASES) {
    for (const segmentMode of ["short", "long"] as const) {
      it(`${c.name} — natural segments (${segmentMode})`, async () => {
        const reserve = await reserveOf(dagPayload(c, 40, segmentMode))
        const bounds = reserve.segmentPlanning!
        expect(bounds.mode).toBe(segmentMode)
        const plans = packings(bounds)
        expect(plans.length).toBeGreaterThan(0)
        for (const sourceSegmentDurations of plans) {
          // The engine's natural re-price, argument for argument (natural-segments.ts).
          const reprice = await computeGenerateVideoProPricing({
            provider: c.provider,
            resolution: "720p",
            durationSec: bounds.durationSec,
            generateAudio: engineSegmentAudio({ generateAudio: c.generateAudio, keyframes: c.renderMethod === "keyframes", lipSync: c.lipSync === true }),
            segmentMode,
            sourceSegmentDurations,
            ...(c.renderMethod ? { renderMethod: c.renderMethod } : {}),
            aspectRatio: "16:9",
          })
          expect(reprice.reserveBase, `${sourceSegmentDurations}`).toBeLessThanOrEqual(reserve.reserveBase)
        }
      })
    }

    it(`${c.name} — fixed segments: the engine prices what was reserved, or less`, async () => {
      const reserve = await reserveOf(dagPayload(c, 40))
      const engine = await computeGenerateVideoProPricing({
        provider: c.provider,
        resolution: "720p",
        durationSec: 40,
        generateAudio: engineSegmentAudio({ generateAudio: c.generateAudio, keyframes: c.renderMethod === "keyframes", lipSync: c.lipSync === true }),
        ...(c.renderMethod ? { renderMethod: c.renderMethod } : {}),
      })
      expect(engine.reserveBase).toBeLessThanOrEqual(reserve.reserveBase)
    })
  }

  it("the music-video lane (which no workflow payload carries today) prices above the engine, never below it", async () => {
    const lane = CASES.find((c) => c.name === "PixVerse V6 Max, music-video lane (audio on)")!
    const reserve = await reserveOf(dagPayload(lane, 40))
    const engine = await computeGenerateVideoProPricing({ provider: lane.provider, resolution: "720p", durationSec: 40, generateAudio: false, renderMethod: "keyframes" })
    expect(engine.reserveBase).toBeLessThan(reserve.reserveBase)
  })

  it("PixVerse with audio off reserves exactly what the engine prices; on and unset, the same audio rows", async () => {
    for (const generateAudio of [true, false, undefined]) {
      const c: Case = { name: "", provider: "pixverse-v6-max", renderMethod: "keyframes", ...(generateAudio === undefined ? {} : { generateAudio }) }
      const reserve = await reserveOf(dagPayload(c, 40))
      const engine = await computeGenerateVideoProPricing({ provider: c.provider, resolution: "720p", durationSec: 40, generateAudio: engineSegmentAudio({ generateAudio, keyframes: true, lipSync: false }), renderMethod: "keyframes" })
      expect(engine.reserveBase, String(generateAudio)).toBe(reserve.reserveBase)
    }
  })
})
