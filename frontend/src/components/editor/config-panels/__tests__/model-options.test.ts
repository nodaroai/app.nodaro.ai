import { describe, it, expect, vi } from "vitest"

// The credit-badge formatters self-gate on the edition (#645) — with no mock,
// the test env's community default would make every formatter return
// undefined and the rate assertions below would test nothing. Pin credits ON;
// the gate itself gets its own explicit case.
const editionMock = vi.hoisted(() => ({ hasCredits: vi.fn(() => true) }))
vi.mock("@/lib/edition", () => editionMock)

import { SUNO_MODELS as SUNO_MODELS_SHARED, DIALOGUE_PROVIDERS } from "@nodaro/shared/models"
import { VIDEO_DEPTH_PROVIDERS } from "@nodaro/shared/media"
import {
  IMAGE_QUALITY_OPTIONS,
  IMAGE_OUTPUT_FORMAT_OPTIONS,
  IMAGE_SVG_LEVEL_OPTIONS,
  gifFramesFor,
  gifFrameDurationFor,
  outputFormatOf,
  writesGif,
  keepsTransparentBackground,
  imageFormatFailSafe,
  defaultQualityFor,
  firstFixedQuality,
  SUNO_MODELS,
  DIALOGUE_MODELS,
  IMAGE_GEN_MODELS,
  IMAGE_I2I_MODELS,
  VIDEO_I2V_MODELS,
  VIDEO_T2V_MODELS,
  KLING3_DURATIONS,
  KIE_VIDEO_DURATIONS,
  KIE_T2V_DURATIONS,
  PROVIDERS_WITH_END_FRAME,
  formatPerSecondCreditBadge,
  VIDEO_DEPTH_MODELS,
  MODEL_DESCRIPTIONS,
} from "../model-options"

describe("IMAGE_GEN_MODELS", () => {
  it("has at least 3 models", () => {
    expect(IMAGE_GEN_MODELS.length).toBeGreaterThanOrEqual(3)
  })

  it("every model has value, label, desc", () => {
    for (const m of IMAGE_GEN_MODELS) {
      expect(m.value).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.desc).toBeTruthy()
    }
  })

  it("has no duplicate values", () => {
    const values = IMAGE_GEN_MODELS.map((m) => m.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe("IMAGE_I2I_MODELS", () => {
  it("has at least 3 models", () => {
    expect(IMAGE_I2I_MODELS.length).toBeGreaterThanOrEqual(3)
  })

  it("every model has value, label, desc", () => {
    for (const m of IMAGE_I2I_MODELS) {
      expect(m.value).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.desc).toBeTruthy()
    }
  })

  it("has no duplicate values", () => {
    const values = IMAGE_I2I_MODELS.map((m) => m.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe("VIDEO_I2V_MODELS", () => {
  it("has at least 5 models", () => {
    expect(VIDEO_I2V_MODELS.length).toBeGreaterThanOrEqual(5)
  })

  it("every model has value, label, desc", () => {
    for (const m of VIDEO_I2V_MODELS) {
      expect(m.value).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.desc).toBeTruthy()
    }
  })

  it("has no duplicate values", () => {
    const values = VIDEO_I2V_MODELS.map((m) => m.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe("VIDEO_T2V_MODELS", () => {
  it("has at least 5 models", () => {
    expect(VIDEO_T2V_MODELS.length).toBeGreaterThanOrEqual(5)
  })

  it("every model has value, label, desc", () => {
    for (const m of VIDEO_T2V_MODELS) {
      expect(m.value).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.desc).toBeTruthy()
    }
  })

  it("has no duplicate values", () => {
    const values = VIDEO_T2V_MODELS.map((m) => m.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe("KLING3_DURATIONS", () => {
  it("contains integers from 3 to 15", () => {
    expect(KLING3_DURATIONS).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  it("has 13 entries", () => {
    expect(KLING3_DURATIONS).toHaveLength(13)
  })
})

describe("KIE_VIDEO_DURATIONS", () => {
  it("minimax supports only 5s", () => {
    expect(KIE_VIDEO_DURATIONS["minimax"]).toEqual([5])
  })

  it("veo3 supports 4/6/8s", () => {
    expect(KIE_VIDEO_DURATIONS["veo3"]).toEqual([4, 6, 8])
  })

  it("kling supports 5 and 10s", () => {
    expect(KIE_VIDEO_DURATIONS["kling"]).toEqual([5, 10])
  })

  it("kling-3.0 uses KLING3_DURATIONS (3-15)", () => {
    expect(KIE_VIDEO_DURATIONS["kling-3.0"]).toEqual([...KLING3_DURATIONS])
  })

  it("every provider has at least one duration", () => {
    for (const [, durations] of Object.entries(KIE_VIDEO_DURATIONS)) {
      expect(durations.length).toBeGreaterThan(0)
    }
  })
})

describe("KIE_T2V_DURATIONS", () => {
  it("has entries for text-to-video providers", () => {
    expect(Object.keys(KIE_T2V_DURATIONS).length).toBeGreaterThan(0)
  })

  it("kling-3.0 uses KLING3_DURATIONS", () => {
    expect(KIE_T2V_DURATIONS["kling-3.0"]).toEqual([...KLING3_DURATIONS])
  })

  it("every provider has at least one duration", () => {
    for (const [, durations] of Object.entries(KIE_T2V_DURATIONS)) {
      expect(durations.length).toBeGreaterThan(0)
    }
  })
})

describe("formatPerSecondCreditBadge", () => {
  it("renders the per-second rate from the 15s bucket (÷15)", () => {
    // volcengine / kling-avatar :15s = 30 → 2 CR/s
    expect(formatPerSecondCreditBadge(30)).toBe("≈2 CR/s")
    // sync-lipsync-v3 :15s = 100 → 6.67 → ≈7 CR/s
    expect(formatPerSecondCreditBadge(100)).toBe("≈7 CR/s")
    // omnihuman-1-5 :15s = 102 → 6.8 → ≈7 CR/s
    expect(formatPerSecondCreditBadge(102)).toBe("≈7 CR/s")
  })

  it("floors at 1 CR/s for tiny rates and hides on zero/unknown", () => {
    expect(formatPerSecondCreditBadge(5)).toBe("≈1 CR/s") // 5/15 rounds to 0 → clamped to 1
    expect(formatPerSecondCreditBadge(0)).toBeUndefined()
    expect(formatPerSecondCreditBadge(-1)).toBeUndefined()
  })

  it("renders nothing on an edition without a credit system (#645)", () => {
    editionMock.hasCredits.mockReturnValueOnce(false)
    expect(formatPerSecondCreditBadge(30)).toBeUndefined()
  })
})

describe("PROVIDERS_WITH_END_FRAME", () => {
  it("is a non-empty array", () => {
    expect(PROVIDERS_WITH_END_FRAME.length).toBeGreaterThan(0)
  })

  it("includes minimax and kling-3.0", () => {
    expect(PROVIDERS_WITH_END_FRAME).toContain("minimax")
    expect(PROVIDERS_WITH_END_FRAME).toContain("kling-3.0")
  })

  it("has no duplicates", () => {
    expect(new Set(PROVIDERS_WITH_END_FRAME).size).toBe(PROVIDERS_WITH_END_FRAME.length)
  })
})

/**
 * Suno: @nodaro/shared owns which versions exist and the order they are offered
 * in. The dropdown table here is display copy for that list — never a second
 * source of truth — so both membership and order are pinned to it. Adding or
 * retiring a version in the shared constant fails this until the picker follows.
 */
describe("SUNO_MODELS mirrors the shared list", () => {
  it("offers exactly SUNO_MODELS from @nodaro/shared, in order", () => {
    expect(SUNO_MODELS.map((m) => m.value)).toEqual([...SUNO_MODELS_SHARED])
  })

  it("every row has a label and a desc", () => {
    for (const m of SUNO_MODELS) {
      expect(m.label).toBeTruthy()
      expect(m.desc).toBeTruthy()
    }
  })
})

/**
 * The dialogue model dropdown (panel + quick strip) offers exactly the route's
 * enum, `DIALOGUE_PROVIDERS` in `@nodaro/shared`, in its order — a model the
 * route takes but the picker hides, or the reverse, fails here.
 */
describe("DIALOGUE_MODELS mirrors the shared list", () => {
  it("offers exactly DIALOGUE_PROVIDERS, in that order", () => {
    expect(DIALOGUE_MODELS.map((m) => m.value)).toEqual([...DIALOGUE_PROVIDERS])
  })

  it("every row has a label and a desc", () => {
    for (const m of DIALOGUE_MODELS) {
      expect(m.label).toBeTruthy()
      expect(m.desc).toBeTruthy()
    }
  })
})

describe("auto video duration option", () => {
  it("rides LAST on every model that declares the capability, so options[0] stays a real length", async () => {
    const { VIDEO_DURATION_OPTIONS, getVideoModelCapabilitiesTooltip } = await import("../model-options")
    const { MODEL_CATALOG, VIDEO_DURATION_AUTO } = await import("@nodaro/shared/model-catalog")
    const capable = Object.keys(MODEL_CATALOG).filter((id) => MODEL_CATALOG[id]!.autoDuration === true)
    expect(capable.length).toBeGreaterThan(0)
    for (const id of capable) {
      const options = VIDEO_DURATION_OPTIONS[id]!
      expect(options.at(-1), id).toEqual({ value: VIDEO_DURATION_AUTO, label: "Auto" })
      expect(options[0]!.value, id).toBeGreaterThan(0)
      expect(options.filter((o) => o.value === VIDEO_DURATION_AUTO), id).toHaveLength(1)
      expect(getVideoModelCapabilitiesTooltip(id)).toContain("Auto")
      expect(getVideoModelCapabilitiesTooltip(id)).not.toContain("-1s")
    }
    for (const [id, options] of Object.entries(VIDEO_DURATION_OPTIONS)) {
      if (!capable.includes(id)) expect(options.some((o) => o.value === VIDEO_DURATION_AUTO), id).toBe(false)
    }
  })
})

describe("getSourcePhotoAspectRatios / withPhotoAuto — the ratio tiles on the image nodes whose \"auto\" keeps a photo's shape", () => {
  it("offers Auto first on every Modify Image model, then every ratio the model lists", async () => {
    const { MODIFY_IMAGE_MODELS, getAspectRatiosForModel, getSourcePhotoAspectRatios, SOURCE_PHOTO_AUTO_LABEL } = await import("../model-options")
    for (const { value: provider } of MODIFY_IMAGE_MODELS) {
      const options = getSourcePhotoAspectRatios(provider)
      expect(options[0], provider).toEqual({ value: "auto", label: SOURCE_PHOTO_AUTO_LABEL })
      expect(options.filter((o) => o.value === "auto"), provider).toHaveLength(1)
      expect(options.slice(1), provider).toEqual(getAspectRatiosForModel(provider).filter((o) => o.value !== "auto"))
    }
  })

  it("says what Auto does", async () => {
    const { SOURCE_PHOTO_AUTO_LABEL } = await import("../model-options")
    expect(SOURCE_PHOTO_AUTO_LABEL).toBe("Auto (match the photo)")
  })

  it("leaves the catalog's own list (what a stale ratio snaps to) as the catalog has it", async () => {
    const { getAspectRatiosForModel } = await import("../model-options")
    expect(getAspectRatiosForModel("seedream-5-pro").some((o) => o.value === "auto")).toBe(false)
  })

  it("offers Auto first on every Generate Image model, then every ratio the model lists", async () => {
    const { IMAGE_GEN_MODELS, getAspectRatiosForModel, getSourcePhotoAspectRatios, SOURCE_PHOTO_AUTO_LABEL } = await import("../model-options")
    for (const { value: provider } of IMAGE_GEN_MODELS) {
      const options = getSourcePhotoAspectRatios(provider)
      expect(options[0], provider).toEqual({ value: "auto", label: SOURCE_PHOTO_AUTO_LABEL })
      expect(options.filter((o) => o.value === "auto"), provider).toHaveLength(1)
      expect(options.slice(1), provider).toEqual(getAspectRatiosForModel(provider).filter((o) => o.value !== "auto"))
    }
  })

  it("folds a list's own \"auto\" into the one Auto tile (several models selected)", async () => {
    const { withPhotoAuto, SOURCE_PHOTO_AUTO_LABEL } = await import("../model-options")
    const shared = [
      { value: "1:1", label: "1:1 (Square)" },
      { value: "auto", label: "Auto" },
      { value: "16:9", label: "16:9 (Landscape)" },
    ]
    expect(withPhotoAuto(shared)).toEqual([
      { value: "auto", label: SOURCE_PHOTO_AUTO_LABEL },
      { value: "1:1", label: "1:1 (Square)" },
      { value: "16:9", label: "16:9 (Landscape)" },
    ])
    expect(withPhotoAuto([])).toEqual([{ value: "auto", label: SOURCE_PHOTO_AUTO_LABEL }])
  })

  it("with no photo, Auto is the model's own auto where it has one, else its first listed ratio", async () => {
    // What the docs promise for Generate Image with nothing wired in: the
    // platform's no-photo answer for "auto" is the ratio the panel lists first.
    const { IMAGE_GEN_MODELS, getAspectRatiosForModel } = await import("../model-options")
    const { MODEL_CATALOG, normalizeModelInput } = await import("@nodaro/shared/model-catalog")
    let pinned = 0
    for (const { value: provider } of IMAGE_GEN_MODELS) {
      const ratios = MODEL_CATALOG[provider]?.aspectRatios
      if (!ratios?.length) continue
      const native = ratios.includes("auto")
      const expected = native ? "auto" : getAspectRatiosForModel(provider)[0]?.value
      expect(normalizeModelInput(provider, { aspectRatio: "auto" }).aspectRatio, provider).toBe(expected)
      if (!native) pinned++
    }
    expect(pinned).toBeGreaterThan(10)
  })
})

describe("VIDEO_DEPTH_MODELS", () => {
  it("lists exactly the shared Video Depth providers, in order", () => {
    expect(VIDEO_DEPTH_MODELS.map((m) => m.value)).toEqual([...VIDEO_DEPTH_PROVIDERS])
  })

  it("feeds the description lookup", () => {
    for (const m of VIDEO_DEPTH_MODELS) expect(MODEL_DESCRIPTIONS[m.value]).toBe(m.desc)
  })
})

describe("firstFixedQuality", () => {
  it("skips Auto, which is only chosen on purpose", () => {
    expect(firstFixedQuality(IMAGE_QUALITY_OPTIONS["gpt-image-2-6-flare"])).toBe("low")
    expect(firstFixedQuality([{ value: "auto", label: "Auto" }])).toBe("auto")
    expect(firstFixedQuality(undefined)).toBeUndefined()
  })

  it("GPT Image 2.6 defaults to medium though Auto is listed first", () => {
    expect(IMAGE_QUALITY_OPTIONS["gpt-image-2-6-flare"]?.[0]?.value).toBe("auto")
    expect(defaultQualityFor("gpt-image-2-6-flare")).toBe("medium")
    expect(defaultQualityFor("gpt-image")).toBeUndefined()
  })
})

describe("GPT Image 2.6's output formats", () => {
  const values = (o: readonly { value: string }[] | undefined) => o?.map((x) => x.value)

  it("Flare and Sunburst write five formats, PNG first, from a prompt and from an edit", () => {
    for (const id of ["gpt-image-2-6-flare", "gpt-image-2-6-sunburst", "gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i"]) {
      expect(values(IMAGE_OUTPUT_FORMAT_OPTIONS[id])).toEqual(["png", "jpeg", "webp", "gif", "svg"])
      expect(values(IMAGE_SVG_LEVEL_OPTIONS[id])).toEqual(["standard", "detailed", "max"])
    }
    expect(IMAGE_OUTPUT_FORMAT_OPTIONS["gpt-image-2-6-flare"]?.find((o) => o.value === "gif")?.label).toBe("GIF (animated)")
  })

  it("Economy writes PNG or GIF, its edit PNG only (no setting), and no model without the lever has one", () => {
    expect(values(IMAGE_OUTPUT_FORMAT_OPTIONS["gpt-image-2-6-economy"])).toEqual(["png", "gif"])
    expect(IMAGE_SVG_LEVEL_OPTIONS["gpt-image-2-6-economy"]).toBeUndefined()
    expect(IMAGE_OUTPUT_FORMAT_OPTIONS["gpt-image-2-6-economy-i2i"]).toBeUndefined()
    expect(IMAGE_OUTPUT_FORMAT_OPTIONS["gpt-image-2"]).toBeUndefined()
    expect(IMAGE_OUTPUT_FORMAT_OPTIONS["nano-banana-pro"]).toBeUndefined()
  })

  it("a GIF's frames and speed come from the catalog", () => {
    expect(gifFramesFor("gpt-image-2-6-flare")).toMatchObject({ min: 2, max: 16, default: 9 })
    expect(gifFramesFor("gpt-image-2-6-economy")?.values).toEqual([4, 9, 16])
    expect(gifFrameDurationFor("gpt-image-2-6-sunburst")).toEqual({ min: 20, max: 2000, step: 10, default: 200 })
    expect(gifFramesFor("gpt-image-2")).toBeUndefined()
  })

  it("the format a node writes: its own when listed, else the model's default, none without the lever", () => {
    expect(outputFormatOf("gpt-image-2-6-flare", undefined)).toBe("png")
    expect(outputFormatOf("gpt-image-2-6-flare", "svg")).toBe("svg")
    expect(outputFormatOf("gpt-image-2-6-economy", "svg")).toBe("png")
    expect(outputFormatOf("gpt-image-2", "gif")).toBeUndefined()
    expect(writesGif("gpt-image-2-6-flare", "gif")).toBe(true)
    expect(writesGif("gpt-image-2", "gif")).toBe(false)
    expect(writesGif(undefined, "gif")).toBe(false)
  })

  it("only PNG and WebP keep a transparent background", () => {
    expect(keepsTransparentBackground(undefined)).toBe(true)
    expect(keepsTransparentBackground("png")).toBe(true)
    expect(keepsTransparentBackground("webp")).toBe(true)
    for (const f of ["jpeg", "gif", "svg"]) expect(keepsTransparentBackground(f)).toBe(false)
  })
})

describe("imageFormatFailSafe", () => {
  it("leaves a valid node alone and never writes a lever the node does not hold", () => {
    expect(imageFormatFailSafe("gpt-image-2-6-flare", {})).toEqual({})
    expect(imageFormatFailSafe("gpt-image-2-6-flare", { outputFormat: "gif" })).toEqual({})
    expect(imageFormatFailSafe("gpt-image-2-6-flare", { outputFormat: "svg", svgLevel: "max" })).toEqual({})
    expect(imageFormatFailSafe("gpt-image-2-6-flare", { outputFormat: "webp", background: "transparent" })).toEqual({})
  })

  it("clears a format the new model does not write, and any format with several models selected", () => {
    expect(imageFormatFailSafe("gpt-image-2", { outputFormat: "gif" })).toEqual({ outputFormat: undefined })
    expect(imageFormatFailSafe("gpt-image-2-6-economy", { outputFormat: "svg" })).toEqual({ outputFormat: undefined })
    expect(imageFormatFailSafe("gpt-image-2-6-economy-i2i", { outputFormat: "gif" })).toEqual({ outputFormat: undefined })
    expect(imageFormatFailSafe(undefined, { outputFormat: "jpeg" })).toEqual({ outputFormat: undefined })
  })

  it("keeps a GIF's and an SVG's levers while another format is chosen", () => {
    expect(imageFormatFailSafe("gpt-image-2-6-flare", { outputFormat: "png", gifFrames: 40, gifFrameDurationMs: 5, svgLevel: "ultra" })).toEqual({})
    expect(imageFormatFailSafe("gpt-image-2", { gifFrames: 40, svgLevel: "ultra" })).toEqual({})
  })

  it("moves them into the model's range while that format is the one written", () => {
    expect(imageFormatFailSafe("gpt-image-2-6-flare", { outputFormat: "gif", gifFrames: 40, gifFrameDurationMs: 2345 })).toEqual({ gifFrames: 16, gifFrameDurationMs: 2000 })
    expect(imageFormatFailSafe("gpt-image-2-6-flare", { outputFormat: "gif", gifFrames: 1, gifFrameDurationMs: 205 })).toEqual({ gifFrames: 2, gifFrameDurationMs: 210 })
    // Economy takes 4, 9 or 16 frames: the catalog's nearest.
    expect(imageFormatFailSafe("gpt-image-2-6-economy", { outputFormat: "gif", gifFrames: 7 })).toEqual({ gifFrames: 9 })
    expect(imageFormatFailSafe("gpt-image-2-6-sunburst", { outputFormat: "svg", svgLevel: "ultra" })).toEqual({ svgLevel: "standard" })
  })

  it("a transparent background becomes auto with a format that cannot keep it", () => {
    for (const outputFormat of ["jpeg", "gif", "svg"]) {
      expect(imageFormatFailSafe("gpt-image-2-6-flare", { outputFormat, background: "transparent" })).toEqual({ background: "auto" })
    }
    expect(imageFormatFailSafe("gpt-image-2-6-flare", { outputFormat: "jpeg", background: "opaque" })).toEqual({})
    // A format the model does not write is cleared first: its own PNG keeps transparency.
    expect(imageFormatFailSafe("gpt-image-2-6-economy", { outputFormat: "svg", background: "transparent" })).toEqual({ outputFormat: undefined })
  })
})
