import { describe, it, expect, vi, beforeEach } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"

const probe = vi.hoisted(() => ({ byUrl: new Map<string, { width: number; height: number }>() }))
vi.mock("@/lib/image-source-size.js", () => ({ probeImageDisplaySize: vi.fn(async (url: string) => probe.byUrl.get(url)) }))
const credits = vi.hoisted(() => ({ on: true }))
vi.mock("@/lib/config.js", () => ({ hasCredits: () => credits.on }))
// The tier rows as migration 627 seeds them (base credits, before the markup).
const BASE: Record<string, number> = { "nodaro-image-upscale:2K": 4, "nodaro-image-upscale:4K": 10, "nodaro-image-upscale:8K": 30, "nodaro-image-upscale": 30 }
vi.mock("@/lib/credit-base-cost.js", () => ({ baseCreditCostFor: vi.fn(async (id: string) => BASE[id]) }))

import {
  NODARO_IMAGE_UPSCALE_CREDIT_IDS,
  NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID,
  NODARO_IMAGE_UPSCALE_MAX_OUTPUT_PIXELS,
  NODARO_IMAGE_UPSCALE_MAX_OUTPUT_SIDE,
  nodaroImageUpscaleCreditId,
  nodaroImageUpscaleSizing,
  nodaroImageUpscaleTierCreditId,
  nodaroImageUpscaleTooLargeMessage,
  UPSCALE_IMAGE_MODELS,
} from "@nodaro/render-rules"
import { getModel } from "@nodaro/shared/model-catalog"
import {
  NODARO_IMAGE_UPSCALE_LANE,
  NODARO_IMAGE_UPSCALE_MAX_INPUT_BYTES,
  inspectLocalImageSize,
  nodaroImageUpscaleReserveId,
  nodaroImageUpscaleSettledBase,
} from "../nodaro-image-upscale-size.js"
import { houseModelLaneProblems } from "../house-model-lanes.js"

const SRC = "https://cdn.example/photo.png"
const OUT = "https://cdn.example/upscaled.png"

beforeEach(() => {
  probe.byUrl.clear()
  credits.on = true
})

describe("the price tier of an output (total pixels, integer math)", () => {
  it("a tier holds every output up to and including its boundary; one pixel more is the next tier", () => {
    expect(nodaroImageUpscaleTierCreditId(1)).toBe("nodaro-image-upscale:2K")
    expect(nodaroImageUpscaleTierCreditId(4_194_304)).toBe("nodaro-image-upscale:2K")
    expect(nodaroImageUpscaleTierCreditId(4_194_305)).toBe("nodaro-image-upscale:4K")
    expect(nodaroImageUpscaleTierCreditId(16_777_216)).toBe("nodaro-image-upscale:4K")
    expect(nodaroImageUpscaleTierCreditId(16_777_217)).toBe("nodaro-image-upscale:8K")
    expect(nodaroImageUpscaleTierCreditId(NODARO_IMAGE_UPSCALE_MAX_OUTPUT_PIXELS)).toBe("nodaro-image-upscale:8K")
    expect(nodaroImageUpscaleTierCreditId(NODARO_IMAGE_UPSCALE_MAX_OUTPUT_PIXELS + 1)).toBeUndefined()
    expect(nodaroImageUpscaleTierCreditId(0)).toBeUndefined()
  })

  it("every id a run can be charged: the three tiers, then the hold", () => {
    expect(NODARO_IMAGE_UPSCALE_CREDIT_IDS).toEqual(["nodaro-image-upscale:2K", "nodaro-image-upscale:4K", "nodaro-image-upscale:8K", "nodaro-image-upscale"])
  })
})

describe("nodaroImageUpscaleSizing — the docs' worked examples", () => {
  // docs/nodes/ai-image/upscale-image.md: a 1024 × 1024 picture.
  it.each([
    ["1", 1024, 1_048_576, "nodaro-image-upscale:2K"],
    ["2", 2048, 4_194_304, "nodaro-image-upscale:2K"],
    ["4", 4096, 16_777_216, "nodaro-image-upscale:4K"],
    ["8", 8192, 67_108_864, "nodaro-image-upscale:8K"],
  ])("1024 × 1024 at %sx → %i² (%i px) → %s", (factor, side, pixels, creditId) => {
    expect(nodaroImageUpscaleSizing({ width: 1024, height: 1024 }, factor)).toEqual({ kind: "sized", width: side, height: side, pixels, creditId })
  })

  it("one pixel past a boundary: 1025 × 1025 at 2x is 2050 × 2050 (4,202,500 px), the 4K tier", () => {
    expect(nodaroImageUpscaleSizing({ width: 1025, height: 1025 }, "2")).toMatchObject({ kind: "sized", pixels: 4_202_500, creditId: "nodaro-image-upscale:4K" })
  })

  it("past the pixel limit: 1100 × 1100 at 8x (77,440,000 px) is refused", () => {
    expect(nodaroImageUpscaleSizing({ width: 1100, height: 1100 }, "8")).toEqual({ kind: "too-large", width: 8800, height: 8800, pixels: 77_440_000 })
  })

  it("past the side limit only: 2100 × 400 at 8x is 16,800 × 3,200 — under the pixel limit, over 16,384 a side", () => {
    const sizing = nodaroImageUpscaleSizing({ width: 2100, height: 400 }, "8")
    expect(sizing).toEqual({ kind: "too-large", width: 16_800, height: 3_200, pixels: 53_760_000 })
    expect(53_760_000).toBeLessThan(NODARO_IMAGE_UPSCALE_MAX_OUTPUT_PIXELS)
    // Exactly at the side limit is allowed.
    expect(nodaroImageUpscaleSizing({ width: 2048, height: 256 }, "8")).toMatchObject({ kind: "sized", width: NODARO_IMAGE_UPSCALE_MAX_OUTPUT_SIDE })
  })

  it("an invalid factor is read as the default, 2 (as the run renders it); a non-size is undefined", () => {
    expect(nodaroImageUpscaleSizing({ width: 1000, height: 1000 }, "16")).toMatchObject({ width: 2000, height: 2000 })
    expect(nodaroImageUpscaleSizing({ width: 1000, height: 1000 }, undefined)).toMatchObject({ width: 2000, height: 2000 })
    expect(nodaroImageUpscaleSizing(undefined, "2")).toBeUndefined()
    expect(nodaroImageUpscaleSizing({ width: 0, height: 10 }, "2")).toBeUndefined()
  })

  it("an estimate's id: the tier when the size is known and within the limits, else the hold", () => {
    expect(nodaroImageUpscaleCreditId({ width: 1024, height: 1024 }, "4")).toBe("nodaro-image-upscale:4K")
    expect(nodaroImageUpscaleCreditId(undefined, "4")).toBe(NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID)
    expect(nodaroImageUpscaleCreditId({ width: 1100, height: 1100 }, "8")).toBe(NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID)
  })

  it("the refusal names the size and what to change", () => {
    const message = nodaroImageUpscaleTooLargeMessage({ width: 8800, height: 8800 })
    expect(message).toContain("8,800 × 8,800")
    expect(message).toContain("67,108,864 pixels")
    expect(message).toContain("16,384 pixels on a side")
    expect(message).toContain("Choose a smaller factor or a smaller image.")
  })
})

describe("the reserve id a stamped payload carries", () => {
  it("the stamped tier, else the hold; every other job none", () => {
    const payload = { provider: "nodaro-image-upscale", imageUrl: SRC, upscaleFactor: "4" }
    expect(nodaroImageUpscaleReserveId("edit-image", { ...payload, nodaroImageUpscaleCreditId: "nodaro-image-upscale:4K" })).toBe("nodaro-image-upscale:4K")
    expect(nodaroImageUpscaleReserveId("edit-image", payload)).toBe("nodaro-image-upscale")
    // A forged stamp that names no Nodaro Image Upscale id is the hold too.
    expect(nodaroImageUpscaleReserveId("edit-image", { ...payload, nodaroImageUpscaleCreditId: "recraft-upscale" })).toBe("nodaro-image-upscale")
    expect(nodaroImageUpscaleReserveId("edit-image", { provider: "recraft-upscale" })).toBeUndefined()
    expect(nodaroImageUpscaleReserveId("image-to-image", { provider: "nodaro-image-upscale" })).toBeUndefined()
  })
})

describe("the lane row", () => {
  it("one input file, the image under imageUrl, at most 20 MB, settled on what it delivered", () => {
    expect(houseModelLaneProblems(NODARO_IMAGE_UPSCALE_LANE)).toEqual([])
    expect(NODARO_IMAGE_UPSCALE_LANE.inputUrlArgs).toEqual(["imageUrl"])
    expect(NODARO_IMAGE_UPSCALE_LANE.input).toEqual({ media: "image", maxBytes: 20_000_000 })
    expect(NODARO_IMAGE_UPSCALE_MAX_INPUT_BYTES).toBe(20_000_000)
    expect(NODARO_IMAGE_UPSCALE_LANE.settledBase).toBe(nodaroImageUpscaleSettledBase)
    expect(NODARO_IMAGE_UPSCALE_LANE.deliver).toBeUndefined()
  })

  it("its failure sentences, in plain words, with no advice about a prompt the run does not have", () => {
    expect(NODARO_IMAGE_UPSCALE_LANE.failureSentences).toEqual({
      contentPolicy:
        "This picture was blocked by the content policy, so Nodaro Image Upscale could not upscale it. Topaz Upscale or Recraft Upscale may accept it.",
      inputRefused:
        "Nodaro Image Upscale could not read this picture. Send a PNG, JPEG or WebP image, or try Topaz Upscale or Recraft Upscale.",
    })
    for (const sentence of Object.values(NODARO_IMAGE_UPSCALE_LANE.failureSentences ?? {})) expect(sentence).not.toMatch(/prompt/i)
  })

  it("names the model and the node's other upscalers by the labels the Upscale Image node shows", () => {
    const labelOf = (id: string) => UPSCALE_IMAGE_MODELS.find((m) => m.value === id)?.label
    const own = getModel("nodaro-image-upscale")?.label
    expect(own).toBe("Nodaro Image Upscale")
    expect(labelOf("nodaro-image-upscale")).toBe(own)
    const others = [labelOf("topaz-image-upscale"), labelOf("recraft-upscale")]
    expect(others).toEqual(["Topaz Upscale", "Recraft Upscale"])
    const { contentPolicy, inputRefused } = NODARO_IMAGE_UPSCALE_LANE.failureSentences ?? {}
    for (const sentence of [contentPolicy, inputRefused]) {
      expect(sentence).toContain(own)
      for (const label of others) expect(sentence).toContain(label)
    }
  })
})

describe("inspectLocalImageSize — the copy helper's measurement of a downloaded copy", () => {
  it("reads the pixel size from the file's first bytes; refuses a file it cannot read; stops on its signal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nodaro-upscale-"))
    try {
      const png = join(dir, "a.png")
      await writeFile(png, await sharp({ create: { width: 300, height: 200, channels: 3, background: "#808080" } }).png().toBuffer())
      expect(await inspectLocalImageSize(png, new AbortController().signal)).toEqual({ width: 300, height: 200 })
      const junk = join(dir, "b.bin")
      await writeFile(junk, Buffer.from("not an image"))
      await expect(inspectLocalImageSize(junk, new AbortController().signal)).rejects.toThrow("could not be read")
      const stopped = new AbortController()
      stopped.abort(new Error("stopped"))
      await expect(inspectLocalImageSize(png, stopped.signal)).rejects.toThrow("stopped")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("nodaroImageUpscaleSettledBase — a held run settles to the delivered output's tier", () => {
  const HELD = { provider: "nodaro-image-upscale" }

  it("the base of the tier the output's own size falls in", async () => {
    probe.byUrl.set(OUT, { width: 2048, height: 2048 })
    expect(await nodaroImageUpscaleSettledBase(HELD, { url: OUT })).toBe(4)
    expect(await nodaroImageUpscaleSettledBase({ ...HELD, nodaroImageUpscaleCreditId: "nodaro-image-upscale" }, { url: OUT })).toBe(4)
    probe.byUrl.set(OUT, { width: 2048, height: 2049 })
    expect(await nodaroImageUpscaleSettledBase(HELD, { url: OUT })).toBe(10)
    probe.byUrl.set(OUT, { width: 8192, height: 8192 })
    expect(await nodaroImageUpscaleSettledBase(HELD, { url: OUT })).toBe(30)
    // The size the run reported wins over the header.
    expect(await nodaroImageUpscaleSettledBase(HELD, { url: OUT, width: 2048, height: 2048 })).toBe(4)
  })

  it("a run that reserved its tier is not settled: its tier was exact", async () => {
    probe.byUrl.set(OUT, { width: 2048, height: 2048 })
    for (const tier of ["nodaro-image-upscale:2K", "nodaro-image-upscale:4K", "nodaro-image-upscale:8K"]) {
      expect(await nodaroImageUpscaleSettledBase({ ...HELD, nodaroImageUpscaleCreditId: tier }, { url: OUT })).toBeUndefined()
    }
  })

  it("nothing to settle on: another model, no credits, an unreadable output or one past the largest tier", async () => {
    probe.byUrl.set(OUT, { width: 2048, height: 2048 })
    expect(await nodaroImageUpscaleSettledBase({ provider: "topaz-image-upscale" }, { url: OUT })).toBeUndefined()
    credits.on = false
    expect(await nodaroImageUpscaleSettledBase(HELD, { url: OUT })).toBeUndefined()
    credits.on = true
    probe.byUrl.clear()
    expect(await nodaroImageUpscaleSettledBase(HELD, { url: OUT })).toBeUndefined()
    probe.byUrl.set(OUT, { width: 9000, height: 9000 })
    expect(await nodaroImageUpscaleSettledBase(HELD, { url: OUT })).toBeUndefined()
  })
})
