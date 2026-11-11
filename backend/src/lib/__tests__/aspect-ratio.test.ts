import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { CHARACTER_ASPECT_OPTIONS } from "@nodaro/shared/entities"
import { IMAGE_ASPECT_RATIO_VALUES } from "@nodaro/shared/models"
import { aspectRatioForStrictModel, clampAspectRatioToModel } from "../aspect-ratio.js"

// Character/entity smart-defaults pick framing by asset type (portrait → "3:4",
// poses → "9:16", …) without knowing which model will run. Not every model
// supports every ratio: Grok exposes ["1:1","16:9","9:16","3:2","2:3"] and has
// NO "3:4", so an un-clamped "3:4" gets silently dropped/defaulted by KIE.
// clampAspectRatioToModel maps the desired ratio to the catalog-nearest one the
// model actually supports — data-driven, so it stays correct for any model.

describe("clampAspectRatioToModel", () => {
  it("clamps an unsupported ratio to the catalog-nearest one (Grok: 3:4 → 2:3)", () => {
    // 3:4 = 0.75. Grok's nearest is 2:3 (0.667, Δ0.083) — closer than 9:16
    // (0.5625, Δ0.188) or 1:1 (1.0, Δ0.25).
    expect(clampAspectRatioToModel("3:4", "grok")).toBe("2:3")
  })

  it("clamps for any model missing the ratio, not just Grok (gpt-image: 3:4 → 2:3)", () => {
    // gpt-image supports only ["1:1","3:2","2:3"] — proves the fix is
    // capability-driven, not a hardcoded Grok special-case.
    expect(clampAspectRatioToModel("3:4", "gpt-image")).toBe("2:3")
  })

  it("never hands auto to a model whose ratios have none (Seedream 5.5 text to image requires a real one)", () => {
    // An entity run with no source image stays on the text-to-image id, which
    // KIE refuses `auto` on; the edit id takes it (its own default).
    expect(clampAspectRatioToModel("auto", "seedream-5-5")).toBe("1:1")
    expect(clampAspectRatioToModel("auto", "seedream-5-5-i2i")).toBe("auto")
    expect(clampAspectRatioToModel("4:5", "seedream-5-5")).toBe("3:4")
  })

  it("leaves a supported ratio unchanged (Flux supports 3:4)", () => {
    expect(clampAspectRatioToModel("3:4", "flux")).toBe("3:4")
  })

  it("leaves the default character model's portrait ratio unchanged (nano-banana supports 3:4)", () => {
    // nano-banana is the route default — the common path must stay a no-op.
    expect(clampAspectRatioToModel("3:4", "nano-banana")).toBe("3:4")
  })

  it("returns ratios Grok already supports verbatim", () => {
    expect(clampAspectRatioToModel("1:1", "grok")).toBe("1:1")
    expect(clampAspectRatioToModel("9:16", "grok")).toBe("9:16")
    expect(clampAspectRatioToModel("16:9", "grok")).toBe("16:9")
  })

  it("leaves the ratio unchanged for an unknown model id", () => {
    expect(clampAspectRatioToModel("3:4", "does-not-exist")).toBe("3:4")
  })

  it("leaves the ratio unchanged when no model id is given", () => {
    expect(clampAspectRatioToModel("3:4", undefined)).toBe("3:4")
  })

  it("passes through undefined / empty ratio without crashing", () => {
    expect(clampAspectRatioToModel(undefined, "grok")).toBeUndefined()
    expect(clampAspectRatioToModel("", "grok")).toBe("")
  })
})


// The entity lanes send their ratio through this clamp, and so does
// `aspectRatioForStrictModel` on a strict model: a ratio a model lists must
// reach it exactly as stored.
describe("clampAspectRatioToModel keeps every listed ratio, on every model", () => {
  for (const m of Object.values(MODEL_CATALOG)) {
    if (!m.aspectRatios?.length) continue
    it(`${m.id}`, () => {
      for (const ratio of m.aspectRatios!) expect(clampAspectRatioToModel(ratio, m.id), ratio).toBe(ratio)
    })
  }
})


// The Scene node and the surround continuation pass a stored ratio straight on.
// Only a model whose endpoint refuses a ratio it does not list (`strictAspectRatios`,
// read from its schema) has that ratio checked; every other model's goes as
// stored, since a catalog list is not a record of what the provider refuses
// (GPT Image 2 renders 21:9 and 4:5, which its list omits).
describe("aspectRatioForStrictModel", () => {
  // Every ratio the Scene panel offers (scene-config.tsx) and the surround route
  // takes (CHARACTER_ASPECT_OPTIONS), plus every ratio the routes know and "auto".
  const SCENE_PANEL_RATIOS = ["16:9", "9:16", "1:1", "4:3", "21:9", "4:5"]
  const SENDABLE = [...new Set(["auto", ...SCENE_PANEL_RATIOS, ...CHARACTER_ASPECT_OPTIONS, ...IMAGE_ASPECT_RATIO_VALUES])]

  it("is declared by Seedream 5.5's two ids and no other model", () => {
    const strict = Object.values(MODEL_CATALOG).filter((m) => m.strictAspectRatios).map((m) => m.id).sort()
    expect(strict).toEqual(["seedream-5-5", "seedream-5-5-i2i"])
  })

  it("sends every ratio as stored on every model without the flag", () => {
    for (const m of Object.values(MODEL_CATALOG)) {
      if (m.strictAspectRatios) continue
      for (const ratio of SENDABLE) expect(aspectRatioForStrictModel(ratio, m.id), `${m.id} ${ratio}`).toBe(ratio)
    }
    expect(aspectRatioForStrictModel("21:9", "gpt-image-2")).toBe("21:9")
    expect(aspectRatioForStrictModel("4:5", "gpt-image-2")).toBe("4:5")
    expect(aspectRatioForStrictModel("4:5", "not-a-model")).toBe("4:5")
    expect(aspectRatioForStrictModel("4:5", undefined)).toBe("4:5")
    expect(aspectRatioForStrictModel(undefined, "seedream-5-5")).toBeUndefined()
  })

  it("moves a ratio Seedream 5.5 does not list to the nearest it does, on the model the request reaches", () => {
    // Text to image takes no "auto"; the edit does.
    expect(aspectRatioForStrictModel("auto", "seedream-5-5")).toBe("1:1")
    expect(aspectRatioForStrictModel("auto", "seedream-5-5-i2i")).toBe("auto")
    expect(aspectRatioForStrictModel("4:5", "seedream-5-5")).toBe("3:4")
    expect(aspectRatioForStrictModel("4:5", "seedream-5-5-i2i")).toBe("3:4")
    for (const id of ["seedream-5-5", "seedream-5-5-i2i"]) {
      for (const ratio of MODEL_CATALOG[id]!.aspectRatios!) expect(aspectRatioForStrictModel(ratio, id), `${id} ${ratio}`).toBe(ratio)
    }
    // Text to image never gets "auto", whatever is stored.
    for (const ratio of SENDABLE) expect(aspectRatioForStrictModel(ratio, "seedream-5-5")).not.toBe("auto")
  })
})
