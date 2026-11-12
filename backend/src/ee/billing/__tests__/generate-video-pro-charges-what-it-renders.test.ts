// @test-units-by-name looks up only the pixverse-v6-max and kling credit rows it names
/**
 * Generate Video Pro charges every segment the audio it RENDERS.
 *
 * A pro segment reaches its provider through the plugin toolkit: the engine
 * passes `generateAudio` (the run's effective audio) in the segment's options,
 * `toProviderOptions` turns them into the provider's options, and the KIE
 * runner renders from those. The pricing call receives the same
 * `generateAudio`. This test runs both halves on the real code — the toolkit
 * mapping, the real runners (only the KIE task submission is mocked, to read
 * the body sent) and the real pricing — and holds the row each segment is
 * priced at to the audio its body asks for, on every audio-priced model:
 * PixVerse V6 Max (its switch reads `generateAudio`), Kling 3.0 (reads only
 * `sound`, so it renders sound whatever `generateAudio` says) and Kling 2.6
 * (the same, silent by default).
 *
 * model_pricing lookups MISS, so `getModelCreditBaseCost` reads the real
 * STATIC_CREDIT_COSTS.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  runKieTask: vi.fn(),
  kling3Generate: vi.fn(),
}))

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: { code: "PGRST116" } }),
        }),
      }),
    }),
  },
}))

vi.mock("../../../providers/kie/client.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runKieTask: mocks.runKieTask,
}))

vi.mock("../../../providers/kie/kling3-client.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  kling3Generate: mocks.kling3Generate,
}))

vi.mock("../../../lib/credit-audit.js", () => ({
  logCreditAudit: vi.fn(),
  extractCreditFields: () => undefined,
}))

import { toProviderOptions } from "../../../lib/private-plugins/toolkit.js"
import { KieVideoProvider } from "../../../providers/kie/video.js"
import { computeGenerateVideoProPricing, computeGenerateVideoProContinuationPricing } from "../generate-video-pro-credits.js"
import { STATIC_CREDIT_COSTS, invalidateModelPricingCache } from "../credits.js"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { GVP_GENERATE_AUDIO_DEFAULT, gvpSegmentAudio, pluginVideoAudioRequest } from "@nodaro/render-rules"

function primeProviders(): void {
  vi.clearAllMocks()
  mocks.runKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1", providerMs: 1 })
  mocks.kling3Generate.mockResolvedValue({ url: "https://x/out.mp4", taskId: "t1" })
}

beforeEach(() => {
  primeProviders()
  invalidateModelPricingCache()
})

/** Render one segment the way the pro engine does, and read the audio its body asks for. */
async function renderedAudio(provider: string, generateAudio: boolean): Promise<boolean> {
  primeProviders()
  await new KieVideoProvider().textToVideo("a lighthouse in a storm", provider, 10, "16:9", toProviderOptions({ generateAudio }))
  if (provider === "kling-3.0") return mocks.kling3Generate.mock.calls[0]![0].sound as boolean
  const input = mocks.runKieTask.mock.calls[0]![1] as Record<string, unknown>
  return (provider === "pixverse-v6-max" ? input.generate_audio_switch : input.sound) as boolean
}

const rowFor = (provider: string, durationSec: number, resolution: string, audio: boolean): number =>
  STATIC_CREDIT_COSTS[buildVideoCreditModelIdentifier(provider, durationSec, { sound: audio }, "image-to-video", undefined, resolution, false)]!

const CASES = [
  { provider: "pixverse-v6-max", segmentDurations: [10, 8, 6], durationSec: 23 },
  { provider: "kling-3.0", segmentDurations: [11, 10], durationSec: 20 },
  { provider: "kling", segmentDurations: [10, 10], durationSec: 19 },
] as const

describe("the Pro audio rule (render-rules)", () => {
  it("a segment is priced with exactly the audio fields its provider is handed, on when the run names none", () => {
    expect(GVP_GENERATE_AUDIO_DEFAULT).toBe(true)
    expect(gvpSegmentAudio(undefined)).toEqual({ generateAudio: true })
    for (const generateAudio of [true, false]) {
      expect(gvpSegmentAudio(generateAudio)).toEqual(pluginVideoAudioRequest(generateAudio))
      // The toolkit builds a segment's provider options from the same mapping.
      const opts = toProviderOptions({ generateAudio })
      expect({ sound: opts.sound, generateAudio: opts.generateAudio }).toEqual({ sound: undefined, ...pluginVideoAudioRequest(generateAudio) })
    }
  })
})

describe("Generate Video Pro: the row a segment is priced at is the audio its provider renders", () => {
  for (const { provider, segmentDurations, durationSec } of CASES) {
    for (const generateAudio of [true, false, undefined]) {
      it(`${provider}, generateAudio ${String(generateAudio)}`, async () => {
        // What the engine hands each segment: the run's audio, on when the request names none.
        const sent = generateAudio ?? GVP_GENERATE_AUDIO_DEFAULT
        const audio = await renderedAudio(provider, sent)
        const pricing = await computeGenerateVideoProPricing({
          provider,
          resolution: "720p",
          durationSec,
          segmentDurations: [...segmentDurations],
          renderMethod: "keyframes",
          aspectRatio: "16:9",
          ...(generateAudio === undefined ? {} : { generateAudio }),
        })
        const res = pricing.resolution!
        expect(pricing.segmentCosts).toEqual(segmentDurations.map((d) => rowFor(provider, d, res, audio)))
      })
    }
  }

  it("so Kling 3.0 is charged its sound rows whatever generateAudio says, and Kling 2.6 its silent ones", async () => {
    for (const generateAudio of [true, false]) {
      expect(await renderedAudio("kling-3.0", generateAudio)).toBe(true)
      expect(await renderedAudio("kling", generateAudio)).toBe(false)
    }
    const k3 = await computeGenerateVideoProPricing({ provider: "kling-3.0", resolution: "720p", durationSec: 20, segmentDurations: [11, 10], renderMethod: "keyframes", aspectRatio: "16:9", generateAudio: false })
    expect(k3.segmentCosts).toEqual([STATIC_CREDIT_COSTS["kling-3.0:15s:audio"], STATIC_CREDIT_COSTS["kling-3.0:10s:audio"]])
  })

  it("a continuation re-prices its segments at the same rendered audio", async () => {
    for (const generateAudio of [true, false, undefined]) {
      const k3 = await computeGenerateVideoProContinuationPricing({
        provider: "kling-3.0", resolution: "720p", segmentDurations: [10, 8, 5], fromSegment: 1, renderMethod: "keyframes",
        ...(generateAudio === undefined ? {} : { generateAudio }),
      })
      expect(k3.segmentCosts, String(generateAudio)).toEqual([
        STATIC_CREDIT_COSTS["kling-3.0:10s:audio"], STATIC_CREDIT_COSTS["kling-3.0:10s:audio"], STATIC_CREDIT_COSTS["kling-3.0:5s:audio"],
      ])
    }
  })
})
