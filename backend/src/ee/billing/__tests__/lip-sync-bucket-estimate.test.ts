// @test-units-by-name prices only the lip-sync bucket rows and the lip-sync / upload-audio nodes it builds
/**
 * The server's run estimate of a Lip Sync on a model priced by a length bucket
 * (decided 2026-11-13): never below what the run can hold. With the audio's
 * length known to the estimate (its wire: an upload's recorded length), it is
 * the bucket the run holds for that length (`lipSyncHeldCreditId` of
 * `lipSyncHeldSecondsOf`, the route's and the workflow run's rule); with it
 * unknown, the model's largest bucket — the most any run of it holds. The same
 * figure an app or a template lists for a run whose audio its user replaces.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { settings } = vi.hoisted(() => ({
  settings: { current: { cost_markup_percent: 10, service_margin_percent: {} as Record<string, number> } },
}))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true }
})
// No database rows: every price is the static row.
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => {
      const query = {
        select: () => query,
        order: () => query,
        eq: () => query,
        single: async () => ({ data: null, error: { code: "PGRST116" } }),
        range: async () => ({ data: [], error: null }),
      }
      return query
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => settings.current }))

import { LIP_SYNC_DURATION_BUCKETS, getLipSyncMaxAudioSeconds } from "@nodaro/shared/credits"
import { CreditsService, chargedCredits, estimateWorkflowCreditsDetailed, getChargedPriceTable, invalidateModelPricingCache } from "../credits.js"
import { lipSyncAudioPricingOf, lipSyncHeldCreditId, lipSyncHeldSecondsOf } from "../../../lib/lip-sync-inputs.js"

const BUCKETED = ["kling-avatar", "kling-avatar-pro", "omnihuman-1-5", "heygen-lipsync-precision", "lipsync-2-pro", "sync-lipsync-v3", "volcengine-lipsync"] as const

/** The charged credits the run holds for audio that measures `sec` on `provider` (the route's and the workflow run's rule). */
async function holdFor(provider: string, sec: number): Promise<number> {
  const pricing = lipSyncAudioPricingOf(provider)!
  const held = lipSyncHeldSecondsOf(pricing, { overCap: false, samples: Math.round(sec * 44_100), seconds: sec })!
  return chargedCredits(await getChargedPriceTable(), lipSyncHeldCreditId(pricing, held))!
}

/** The server's run estimate of one Lip Sync on `provider`, its audio an upload of `sec` seconds (undefined: not known). */
function estimate(provider: string | undefined, sec: number | undefined): Promise<number> {
  const node = { id: "x", type: "lip-sync", data: provider ? { provider } : {} }
  if (sec === undefined) return CreditsService.estimateWorkflowCredits([node], [])
  const upload = { id: "a", type: "upload-audio", data: { url: "https://m.test/a.mp3", metadata: { durationSeconds: sec } } }
  return CreditsService.estimateWorkflowCredits([upload, node], [{ source: "a", target: "x", targetHandle: "audio" }])
}

beforeEach(() => {
  settings.current = { cost_markup_percent: 10, service_margin_percent: {} }
  invalidateModelPricingCache()
})

describe("the server's run estimate of a Lip Sync priced by a length bucket", () => {
  it.each(BUCKETED)("%s: with the audio's length known, it is what the run holds for it", async (provider) => {
    for (const sec of [3.2, 12, 42, 90, 240, 400]) {
      expect(await estimate(provider, sec), `${provider} @ ${sec}`).toBe(await holdFor(provider, Math.min(sec, getLipSyncMaxAudioSeconds(provider))))
    }
  })

  it.each(BUCKETED)("%s: with it unknown, the largest bucket — at or above any hold the run can make", async (provider) => {
    const max = getLipSyncMaxAudioSeconds(provider)
    const unknown = await estimate(provider, undefined)
    expect(unknown).toBe(await holdFor(provider, max))
    // Every length a run can measure — each bucket's edges, and past the maximum (priced at it).
    for (const sec of [...LIP_SYNC_DURATION_BUCKETS.flatMap((b) => [b, b + 0.03, b + 0.06]), 0.5, max * 2]) {
      expect(unknown, `${provider} @ ${sec}`).toBeGreaterThanOrEqual(await holdFor(provider, sec))
    }
  })

  it("a Lip Sync naming no model is quoted as the default model it runs (Kling Avatar), never the node-type row", async () => {
    expect(await estimate(undefined, undefined)).toBe(await estimate("kling-avatar", undefined))
    expect(await estimate(undefined, 42)).toBe(await holdFor("kling-avatar", 42))
  })

  it("Kling Avatar with its audio unknown is quoted at 5 minutes, no longer at the bare row's ~14 s", async () => {
    const table = await getChargedPriceTable()
    expect(await estimate("kling-avatar", undefined)).toBe(chargedCredits(table, "kling-avatar:300s"))
    expect(chargedCredits(table, "kling-avatar:300s")!).toBeGreaterThan(chargedCredits(table, "kling-avatar")!)
  })

  it.each(BUCKETED)("%s in a published app whose user uploads the audio: listed at the top tier, never at the creator's sample", async (provider) => {
    const node = { id: "x", type: "lip-sync", data: { provider } }
    const upload = (sec: number) => ({ id: "a", type: "upload-audio", data: { url: "https://m.test/a.mp3", metadata: { durationSeconds: sec } } })
    const edges = [{ source: "a", target: "x", targetHandle: "audio" }]
    const listing = (sec: number, replaced: string[]) =>
      CreditsService.estimateWorkflowBaseListing([upload(sec), node], edges, "app", { replaceableMediaNodeIds: new Set(replaced) })
    // The creator's 10 s sample, replaced by the app's user: the most a run can hold (a sample past the maximum lists the same).
    const replaced = await listing(10, ["a"])
    expect(replaced).toEqual(await listing(getLipSyncMaxAudioSeconds(provider) * 2, []))
    expect(replaced.preview).toBeGreaterThan((await listing(10, [])).preview)
    expect(replaced.previewPerMinute).toBe(0)
  })

  describe("the audio priced is the audio a server run plays (decided 2026-11-13)", () => {
    const upload = (id: string, sec: number) => ({ id, type: "upload-audio", data: { url: `https://m.test/${id}.mp3`, metadata: { durationSeconds: sec } } })
    const lipSyncLine = async (lipSyncData: Record<string, unknown>, nodes: object[], edges: object[]) =>
      (await estimateWorkflowCreditsDetailed([...nodes, { id: "x", type: "lip-sync", data: { provider: "kling-avatar", ...lipSyncData } }] as never, edges as never)).perNode.x!.credits
    const wire = (source: string) => ({ source, target: "x", targetHandle: "audio" })

    it("two audios wired: the LAST one (each wire's output overwrites the one before), never the first", async () => {
      const line = await lipSyncLine({}, [upload("a", 10), upload("b", 240)], [wire("a"), wire("b")])
      expect(line).toBe(await holdFor("kling-avatar", 240))
      expect(line).toBeGreaterThan(await holdFor("kling-avatar", 10))
      // Wired the other way round, the 10 s clip is the one played and priced.
      expect(await lipSyncLine({}, [upload("a", 10), upload("b", 240)], [wire("b"), wire("a")])).toBe(await holdFor("kling-avatar", 10))
    })

    it("a picked audio counts only with none wired (the server run's fallback); a wire wins over it", async () => {
      const nodes = [upload("a", 10), upload("b", 240)]
      expect(await lipSyncLine({ selectedAudioNodeId: "b" }, nodes, [wire("a")])).toBe(await holdFor("kling-avatar", 10))
      expect(await lipSyncLine({ selectedAudioNodeId: "b" }, nodes, [])).toBe(await holdFor("kling-avatar", 240))
      // A pick naming no node on the canvas reads as no audio: the top tier.
      expect(await lipSyncLine({ selectedAudioNodeId: "gone" }, nodes, [])).toBe(await holdFor("kling-avatar", 300))
    })

    it("a length the Lip Sync node itself carries is never priced: with no audio node, the top tier", async () => {
      expect(await lipSyncLine({ audioUrl: "https://m.test/five-minutes.mp3", audioDurationSec: 1 }, [], [])).toBe(await holdFor("kling-avatar", 300))
    })

    it("a voice made again in the run (Text to Speech feeding Kling Avatar) is estimated at its last take — 12 s lists the 15 s tier, not 5 minutes; the run holds what it measures", async () => {
      const tts = { id: "v", type: "text-to-speech", data: { text: "Hello there.", generatedResults: [{ url: "https://m.test/take.mp3", duration: 12 }], activeResultIndex: 0 } }
      const table = await getChargedPriceTable()
      expect(await lipSyncLine({}, [tts], [wire("v")])).toBe(chargedCredits(table, "kling-avatar:15s"))
      // A voice that has no take yet is unknown: the top tier.
      const fresh = { ...tts, data: { text: "Hello there." } }
      expect(await lipSyncLine({}, [fresh], [wire("v")])).toBe(chargedCredits(table, "kling-avatar:300s"))
    })
  })

  it("OmniHuman 2.0's estimate is unchanged: the wired audio's billed seconds, else the 5-minute ceiling", async () => {
    expect(await estimate("omnihuman-2-0", 3.2)).toBe(154)
    expect(await estimate("omnihuman-2-0", undefined)).toBe(11550)
  })
})
