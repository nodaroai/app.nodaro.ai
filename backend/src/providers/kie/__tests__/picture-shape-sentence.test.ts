import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

// A picture too wide or too tall for a model is refused before anything is
// sent, by the shared image check (`ensureImageForProvider`). The person reads
// what is wrong with the picture and what the model takes, never a ratio
// setting to change: no setting would make that picture fit.

const safeFetch = vi.fn()
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch }))

const uploadBufferToR2 = vi.fn()
vi.mock("../../../lib/storage.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  uploadBufferToR2,
}))

const picture = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#fff" } }).png().toBuffer()

async function serve(buffer: Buffer) {
  safeFetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => buffer })
}

async function refusal(w: number, h: number, min: number, max: number) {
  await serve(await picture(w, h))
  const { ensureImageForProvider } = await import("../video.js")
  return ensureImageForProvider("https://cdn.test/frame.png", "kling-2.6-motion", {
    context: "Video generation",
    minAspectRatio: min,
    maxAspectRatio: max,
  }).then(
    () => undefined,
    (e: unknown) => e as Error & { internalDetails?: string; requestRefused?: boolean },
  )
}

describe("a picture the model cannot take, by its shape", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("too wide: says so, with its size and the range the model takes", async () => {
    const err = await refusal(2400, 600, 0.4, 2.5)
    expect(err?.message).toBe(
      "This picture is too wide for this model (2400×600). It takes pictures between 2:5 and 5:2. Crop it and run again.",
    )
    // The log keeps our own words about it.
    expect(err?.internalDetails).toMatch(/requires aspect ratio between 0\.4:1 and 2\.5:1 \(got 2400:600\)/)
    // Unchanged: our own check refusing a picture is no refusal by the provider.
    expect(err?.requestRefused).toBe(false)
  })

  it("too tall", async () => {
    const err = await refusal(600, 2400, 2 / 5, 5 / 2)
    expect(err?.message).toBe(
      "This picture is too tall for this model (600×2400). It takes pictures between 2:5 and 5:2. Crop it and run again.",
    )
  })

  it("a wider range is named as it is", async () => {
    const err = await refusal(1000, 100, 0.125, 8)
    expect(err?.message).toBe(
      "This picture is too wide for this model (1000×100). It takes pictures between 1:8 and 8:1. Crop it and run again.",
    )
  })

  it("a picture inside the range passes", async () => {
    const err = await refusal(1600, 900, 0.4, 2.5)
    expect(err).toBeUndefined()
  })
})
