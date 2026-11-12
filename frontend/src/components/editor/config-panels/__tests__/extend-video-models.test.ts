/**
 * The Extend Video model menu (`EXTEND_VIDEO_MODELS`, `@nodaro/render-rules`):
 * Seedance is two rows, one per model, first in the menu (decided 2026-11-11),
 * then Kling 4; new Extend nodes still start on VEO (`EXTEND_VIDEO_DEFAULT_PROVIDER`).
 */
import { describe, it, expect } from "vitest"
import { EXTEND_VIDEO_DEFAULT_PROVIDER, EXTEND_VIDEO_MODELS } from "@nodaro/render-rules"
import { EXTEND_VIDEO_PROVIDERS } from "@nodaro/shared/models"

describe("the Extend Video model menu", () => {
  it("offers them in the picker in the decided order", () => {
    expect(EXTEND_VIDEO_MODELS.map((m) => m.value)).toEqual(["seedance-2-5-extend", "seedance-2-0-extend", "kling-4-extend", "veo-extend", "runway-extend", "ltx-2.3-pro"])
  })

  it("names each Seedance row by its model version, and Kling 4 by its model", () => {
    const label = (value: string) => EXTEND_VIDEO_MODELS.find((m) => m.value === value)?.label
    expect(label("seedance-2-5-extend")).toBe("Seedance 2.5")
    expect(label("seedance-2-0-extend")).toBe("Seedance 2.0")
    expect(label("kling-4-extend")).toBe("Kling 4")
  })

  it("offers every extend provider and nothing else", () => {
    expect(EXTEND_VIDEO_MODELS.map((m) => m.value).sort()).toEqual([...EXTEND_VIDEO_PROVIDERS].sort())
  })

  it("keeps VEO as the model a new Extend node starts on", () => {
    expect(EXTEND_VIDEO_DEFAULT_PROVIDER).toBe("veo-extend")
  })
})
