/**
 * GPT Image 2.6's output formats on the wire: what each format sends of the
 * KIE schema (`inputFieldsByFormat` in models.ts, `applyOutputFormat` in
 * image.ts). The schemas are `additionalProperties: false`, so a field sent to
 * a format that does not take it is a refused task.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  mockRunKieTask: vi.fn(),
  mockSafeFetch: vi.fn(),
  mockUploadBufferToR2: vi.fn(),
}))

vi.mock("../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client.js")>()
  return { ...actual, runKieTask: mocks.mockRunKieTask }
})
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.mockSafeFetch }))
vi.mock("../../../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage.js")>()),
  uploadBufferToR2: mocks.mockUploadBufferToR2,
}))

import sharp from "sharp"
import { KieImageProvider, applyOutputFormat } from "../image.js"
import { KIE_IMAGE_MODELS } from "../models.js"
import { outputFormatParams } from "../../../workers/handlers/image-ai.js"

let provider: KieImageProvider
let png: Buffer

beforeAll(async () => {
  png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockRunKieTask.mockResolvedValue({
    resultJson: { resultUrls: ["https://result.example/out"] },
    rawRecordInfo: { code: 200, message: "success", data: { taskId: "t1", creditsConsumed: 11.25 } },
  })
  mocks.mockSafeFetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => png })
  provider = new KieImageProvider()
})

/** The `input` sent for one call through the worker's own param builder. */
async function sent(model: string, refs: string[] | undefined, levers: Parameters<typeof outputFormatParams>[0], extra: Record<string, unknown> = {}) {
  await provider.generateImage("a waving flag", refs, model, { aspect_ratio: "16:9", resolution: "2K", quality: "high", ...extra, ...outputFormatParams(levers) })
  const [modelId, input] = mocks.mockRunKieTask.mock.calls[0]!
  return { modelId: modelId as string, input: input as Record<string, unknown>, keys: Object.keys(input as object).sort() }
}

describe("GPT Image 2.6 formats on the wire (Flare and Sunburst)", () => {
  it("PNG sends no output_format: the request is the one it always was", async () => {
    const png = await sent("gpt-image-2-6-flare", undefined, { outputFormat: "png" }, { background: "transparent" })
    expect(png.keys).toEqual(["aspect_ratio", "background", "prompt", "quality", "resolution"])
    const none = await (async () => { vi.clearAllMocks(); mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://r"] } }); return sent("gpt-image-2-6-flare", undefined, {}) })()
    expect(none.keys).toEqual(png.keys.filter((k) => k !== "background"))
  })

  it("JPEG and WebP add the format and never a compression", async () => {
    for (const outputFormat of ["jpeg", "webp"]) {
      vi.clearAllMocks()
      mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://r"] } })
      const { input, keys } = await sent("gpt-image-2-6-flare", undefined, { outputFormat }, { output_compression: 80 })
      expect(keys).toEqual(["aspect_ratio", "output_format", "prompt", "quality", "resolution"])
      expect(input.output_format).toBe(outputFormat)
    }
  })

  it("a GIF from a prompt sends its frames, its speed and a 512x512 frame, no ratio or size", async () => {
    const { input, keys } = await sent("gpt-image-2-6-flare", undefined, { outputFormat: "gif", gifFrames: 12, gifFrameDurationMs: 150, svgLevel: "max" }, { background: "opaque", mask_url: "https://m.png" })
    expect(keys).toEqual(["background", "frame_count", "frame_duration_ms", "output_format", "prompt", "quality", "size"])
    expect(input).toMatchObject({ output_format: "gif", frame_count: 12, frame_duration_ms: 150, size: "512x512", quality: "high" })
  })

  it("a GIF edit sends no size: the edit schema has none", async () => {
    const { modelId, keys } = await sent("gpt-image-2-6-flare", ["https://a.png"], { outputFormat: "gif", gifFrames: 4, gifFrameDurationMs: 200 })
    expect(modelId).toBe("gpt-image-2-6/flare-image-to-image")
    expect(keys).toEqual(["frame_count", "frame_duration_ms", "input_urls", "output_format", "prompt", "quality"])
  })

  it("an SVG sends its writer for the level, its ratio and size, and no background or GIF field", async () => {
    const levels = { standard: "gpt-5.6-luna", detailed: "gpt-5.6-terra", max: "gpt-6-sol" }
    for (const [svgLevel, model] of Object.entries(levels)) {
      vi.clearAllMocks()
      mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://r"] } })
      const { input, keys } = await sent("gpt-image-2-6-sunburst-i2i", ["https://a.png"], { outputFormat: "svg", svgLevel, gifFrames: 9 }, { background: "auto" })
      expect(keys).toEqual(["aspect_ratio", "input_urls", "output_format", "prompt", "quality", "resolution", "svg"])
      expect(input.svg).toEqual({ model })
    }
  })

  it("an SVG with no level is drawn at Standard", async () => {
    const { input } = await sent("gpt-image-2-6-flare", undefined, { outputFormat: "svg" })
    expect(input.svg).toEqual({ model: "gpt-5.6-luna" })
  })

  it("the worker never hands the provider an SVG level of its own", async () => {
    const { input } = await sent("gpt-image-2-6-flare", undefined, { outputFormat: "svg", svgLevel: "detailed" })
    expect(input.svg_level).toBeUndefined()
  })
})

describe("GPT Image 2.6 Economy formats", () => {
  it("a GIF sends its frame count as the string its schema takes, and no ratio", async () => {
    const { modelId, input, keys } = await sent("gpt-image-2-6-economy", undefined, { outputFormat: "gif", gifFrames: 9, gifFrameDurationMs: 200 })
    expect(modelId).toBe("gpt-image-2-6/economy-text-to-image")
    expect(keys).toEqual(["frame_count", "frame_duration_ms", "output_format", "prompt"])
    expect(input.frame_count).toBe("9")
  })

  it("an edit writes PNG only: any other format sends a PNG request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { keys } = await sent("gpt-image-2-6-economy-i2i", ["https://a.png"], { outputFormat: "gif", gifFrames: 9 })
    expect(keys).toEqual(["aspect_ratio", "input_urls", "prompt"])
    warn.mockRestore()
  })
})

describe("another model is untouched by the format levers", () => {
  it("a model without formats keeps its own output_format and loses only the SVG level", () => {
    const input: Record<string, unknown> = { prompt: "x", output_format: "jpg", svg_level: "max" }
    applyOutputFormat({ model: "nano-banana-2", cost: 0, credits: 0, extraParams: { output_format: "jpg" } }, input)
    expect(input).toEqual({ prompt: "x", output_format: "jpg" })
  })

  it("only the six 2.6 configs, MiniMax H3 Image's two and Seedream 5.5's two declare per-format fields", () => {
    const declaring = Object.entries(KIE_IMAGE_MODELS).filter(([, c]) => c.inputFieldsByFormat).map(([id]) => id).sort()
    expect(declaring).toEqual([
      "gpt-image-2-6-economy", "gpt-image-2-6-economy-i2i", "gpt-image-2-6-flare", "gpt-image-2-6-flare-i2i",
      "gpt-image-2-6-sunburst", "gpt-image-2-6-sunburst-i2i", "minimax-h3-image", "minimax-h3-image-i2i",
      "seedream-5-5", "seedream-5-5-i2i",
    ])
  })

  it("no format sends a markup or a compression", () => {
    for (const [id, config] of Object.entries(KIE_IMAGE_MODELS)) {
      for (const [format, fields] of Object.entries(config.inputFieldsByFormat ?? {})) {
        for (const never of ["markup", "output_compression"]) expect(fields, `${id} ${format}`).not.toContain(never)
      }
    }
  })

  // KIE refuses a mask with a GIF or an SVG; only a model that reads a mask in
  // its own form (`maskFormat`) sends one, and then with PNG, JPEG and WebP.
  it("a mask is sent only by a model with a maskFormat, never with a GIF or an SVG", () => {
    for (const [id, config] of Object.entries(KIE_IMAGE_MODELS)) {
      for (const [format, fields] of Object.entries(config.inputFieldsByFormat ?? {})) {
        const sendsMask = config.maskFormat !== undefined && ["png", "jpeg", "webp"].includes(format)
        expect(fields.includes("mask_url"), `${id} ${format}`).toBe(sendsMask)
      }
    }
  })
})

describe("the worker's format params", () => {
  it("PNG and no format send nothing", () => {
    expect(outputFormatParams({})).toEqual({})
    expect(outputFormatParams({ outputFormat: "png", gifFrames: 9, svgLevel: "max" })).toEqual({})
  })

  it("a GIF's frames and speed ride only a GIF, an SVG's level only an SVG", () => {
    expect(outputFormatParams({ outputFormat: "gif", gifFrames: 9, gifFrameDurationMs: 200, svgLevel: "max" })).toEqual({ output_format: "gif", frame_count: 9, frame_duration_ms: 200 })
    expect(outputFormatParams({ outputFormat: "svg", gifFrames: 9, svgLevel: "max" })).toEqual({ output_format: "svg", svg_level: "max" })
    expect(outputFormatParams({ outputFormat: "jpeg", gifFrames: 9 })).toEqual({ output_format: "jpeg" })
  })
})
