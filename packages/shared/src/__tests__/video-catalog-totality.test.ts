import { describe, it, expect } from "vitest"
import {
  MODEL_CATALOG,
  resolutionOptionsByKind,
  aspectRatioOptionsByKind,
  durationsByMode,
} from "../model-catalog.js"
import { VIDEO_GEN_PROVIDERS } from "../model-constants.js"

/**
 * Every video model a user can pick must have a catalog entry. The catalog is
 * what `normalizeModelInput` / `normalizeVideoRequestParams` snap against, what
 * `VIDEO_PROVIDERS_REQUIRING_IMAGE` derives from, and what the frontend option
 * menus are built from — a model outside it silently opts out of all three and
 * gets its option lists hand-spliced into the frontend instead. That is exactly
 * how ltx-2.3-fast reached Replicate with a 720p resolution and a 422 came back
 * (app-reports triage 2026-09-01, P3).
 */
describe("MODEL_CATALOG covers every generatable video provider", () => {
  it("has an entry for every VIDEO_GEN_PROVIDERS member", () => {
    const missing = VIDEO_GEN_PROVIDERS.filter((p) => !MODEL_CATALOG[p])
    expect(
      missing,
      `Add a MODEL_CATALOG entry (modes / aspectRatios / resolutions / durations / pricing) for: ${missing.join(", ")}`,
    ).toEqual([])
  })

  // Deliberately a KEY-PRESENCE check, not `kind === "video"`. `grok`'s entry
  // lives in IMAGE_MODELS with `kind: "image"` (it is a t2v provider whose
  // catalog row is the image sibling), so tightening this assertion would fail
  // on `grok` for a reason unrelated to LTX. Fix that entry first if you ever
  // want the stronger form.

  it("every video entry's pricing identifiers are unique and non-empty", () => {
    for (const p of VIDEO_GEN_PROVIDERS) {
      const entry = MODEL_CATALOG[p]
      if (!entry) continue
      const ids = entry.pricing.map((v) => v.identifier)
      expect(ids.length, `${p} has no pricing rows`).toBeGreaterThan(0)
      expect(new Set(ids).size, `${p} has duplicate pricing identifiers`).toBe(ids.length)
    }
  })
})

/**
 * Deleting the LTX hand-splices in frontend/model-options.ts (Task 7 step 5)
 * hands resolution/aspect/duration option rendering to these catalog-derived
 * helpers. Pin their LTX output to exactly what the deleted splices used to
 * hard-code, so the refactor is provably UI-neutral — including the "2k"
 * label regression (R24) the brief called out: MODEL_VALUE_LABELS had no
 * "2k" entry, so the derived option rendered lowercase "2k" where the spliced
 * literal rendered "2K" until that label was added.
 */
describe("LTX catalog-derived options match the deleted frontend splices exactly", () => {
  const RESOLUTION_OPTIONS = [
    { value: "1080p", label: "1080p" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
  ]
  const ASPECT_OPTIONS = [
    { value: "16:9", label: "16:9 (Landscape)" },
    { value: "9:16", label: "9:16 (Portrait)" },
  ]

  it("resolutionOptionsByKind('video') renders both LTX ids identically to the deleted VIDEO_RESOLUTION_OPTIONS splice", () => {
    const options = resolutionOptionsByKind("video")
    expect(options["ltx-2.3-pro"]).toEqual(RESOLUTION_OPTIONS)
    expect(options["ltx-2.3-fast"]).toEqual(RESOLUTION_OPTIONS)
  })

  it("aspectRatioOptionsByKind('video') renders both LTX ids identically to the deleted _VIDEO_ASPECT_BY_PROVIDER splice", () => {
    const options = aspectRatioOptionsByKind("video")
    expect(options["ltx-2.3-pro"]).toEqual(ASPECT_OPTIONS)
    expect(options["ltx-2.3-fast"]).toEqual(ASPECT_OPTIONS)
  })

  it("durationsByMode merges to the same duration lists the deleted out[\"ltx-2.3-*\"] splice hard-coded", () => {
    const i2v = durationsByMode("i2v")
    const t2v = durationsByMode("t2v")
    const merge = (id: string) =>
      Array.from(new Set([...(i2v[id] ?? []), ...(t2v[id] ?? [])])).sort((a, b) => a - b)
    expect(merge("ltx-2.3-pro")).toEqual([6, 8, 10])
    expect(merge("ltx-2.3-fast")).toEqual([6, 8, 10, 12, 14, 16, 18, 20])
  })
})
