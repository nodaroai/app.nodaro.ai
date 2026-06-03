import { describe, it, expect } from "vitest"
import {
  buildModelMenu,
  resolutionOptionsByKind,
  aspectRatioOptionsByKind,
  durationsByMode,
} from "../model-catalog.js"

// Real catalog ids (asserted to exist, kinds asserted) — no catalog mocking, so
// the test pins behavior against the live catalog and the accessor helpers it
// composes. Expected capabilities are DERIVED from those accessors below so the
// assertions track catalog changes instead of hardcoding seconds/resolutions.
const IMG_A = "flux-2-max"
const IMG_B = "nano-banana-pro"
const VID = "veo3"

describe("buildModelMenu", () => {
  it("preserves allowlist order and drops ids absent from the catalog", () => {
    const rows = buildModelMenu("image", [IMG_A, "does-not-exist", IMG_B])
    expect(rows.map((r) => r.id)).toEqual([IMG_A, IMG_B])
  })

  it("drops ids of the wrong kind (a video id under kind: image)", () => {
    expect(buildModelMenu("image", [VID])).toEqual([])
  })

  it("derives resolutions / aspectRatios from the kind-scoped accessors", () => {
    const [row] = buildModelMenu("image", [IMG_B])
    expect(row.resolutions).toEqual(resolutionOptionsByKind("image")[IMG_B])
    expect(row.aspectRatios).toEqual(aspectRatioOptionsByKind("image")[IMG_B])
    // Image models have no i2v/t2v modes → no duration lever.
    expect(row.durations).toEqual([])
  })

  it("derives video durations as the sorted-unique i2v+t2v union, mapped to {value,label}", () => {
    const i2v = durationsByMode("i2v")
    const t2v = durationsByMode("t2v")
    const expected = Array.from(new Set([...(i2v[VID] ?? []), ...(t2v[VID] ?? [])]))
      .sort((a, b) => a - b)
      .map((n) => ({ value: n, label: `${n}s` }))
    // Guard the fixture itself: VID must actually carry durations, else the
    // assertion would pass vacuously on an empty union.
    expect(expected.length).toBeGreaterThan(0)

    const [row] = buildModelMenu("video", [VID])
    expect(row.durations).toEqual(expected)
  })

  it("returns fresh arrays — mutating one row never affects a later call", () => {
    const first = buildModelMenu("image", [IMG_B])
    first[0].resolutions.push({ value: "tampered", label: "tampered" })
    first[0].aspectRatios.push({ value: "tampered", label: "tampered" })

    const second = buildModelMenu("image", [IMG_B])
    expect(second[0].resolutions).toEqual(resolutionOptionsByKind("image")[IMG_B])
    expect(second[0].aspectRatios).toEqual(aspectRatioOptionsByKind("image")[IMG_B])
  })
})
