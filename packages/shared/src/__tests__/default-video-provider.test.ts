import { describe, it, expect } from "vitest"
import {
  DEFAULT_VIDEO_PROVIDER,
  DEFAULT_VIDEO_DURATION_SEC,
  applyDefaultVideoSelection,
  buildVideoCreditModelIdentifier,
  MODEL_CATALOG,
} from "../index.js"

// Guards the platform-wide default video model. If the default is ever
// retired from the catalog, loses a mode, or its cheapest tier stops
// resolving, this fails BEFORE users hit price/validation errors.
describe("DEFAULT_VIDEO_PROVIDER", () => {
  it("exists in the catalog and supports BOTH t2v and i2v (unified-node default)", () => {
    const entry = MODEL_CATALOG[DEFAULT_VIDEO_PROVIDER]
    expect(entry).toBeDefined()
    expect(entry.modes).toContain("t2v")
    expect(entry.modes).toContain("i2v")
  })

  it("supports the 480p tier the omitted-resolution path lands on", () => {
    expect(MODEL_CATALOG[DEFAULT_VIDEO_PROVIDER].resolutions).toContain("480p")
  })

  it("nothing-specified request resolves to the cheapest seeded composite", () => {
    const sel = applyDefaultVideoSelection({})
    const id = buildVideoCreditModelIdentifier(
      sel.provider, sel.duration, undefined, "image-to-video", undefined, undefined, false,
    )
    expect(id).toBe(`${DEFAULT_VIDEO_PROVIDER}:${DEFAULT_VIDEO_DURATION_SEC}s:480p`)
  })
})

describe("applyDefaultVideoSelection", () => {
  it("omitted both → default provider + default duration", () => {
    expect(applyDefaultVideoSelection({})).toEqual({
      provider: DEFAULT_VIDEO_PROVIDER,
      duration: DEFAULT_VIDEO_DURATION_SEC,
    })
  })

  it("explicit provider keeps its own duration semantics (no forced duration)", () => {
    expect(applyDefaultVideoSelection({ provider: "kling" })).toEqual({
      provider: "kling",
      duration: undefined,
    })
  })

  it("explicit duration is never overridden", () => {
    expect(applyDefaultVideoSelection({ duration: 10 })).toEqual({
      provider: DEFAULT_VIDEO_PROVIDER,
      duration: 10,
    })
    expect(applyDefaultVideoSelection({ provider: "veo3.1", duration: 8 })).toEqual({
      provider: "veo3.1",
      duration: 8,
    })
  })

  it("empty-string provider counts as omitted", () => {
    expect(applyDefaultVideoSelection({ provider: "" }).provider).toBe(DEFAULT_VIDEO_PROVIDER)
  })
})
