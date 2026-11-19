import { describe, it, expect } from "vitest"
import {
  MODEL_CATALOG,
  resolutionOptionsByKind,
  aspectRatioOptionsByKind,
  durationsByMode,
} from "../model-catalog.js"
import { VIDEO_GEN_PROVIDERS, VIDEO_TO_VIDEO_PROVIDERS } from "../model-constants.js"

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
 * Every /v1/video-to-video model is listed too, as a video entry: `/v1/models`
 * and MCP `list_models` read only the catalog, so a model outside it is one no
 * client can offer (luma-modify was, until 2026-10-19).
 *
 * The mode "v2v" means the model EDITS the clip it is given: it is what the
 * surfaces that list "edit" models read. So every Video to Video provider
 * carries it EXCEPT the reference-to-video ones named here, which take the
 * clip's subject and make a NEW clip of the scene the prompt describes. Those
 * stay Video to Video providers (the route takes them, the node's menu offers
 * them) and are picked there by id; they are not listed as edit models.
 *
 * A new Video to Video provider must be an edit model with "v2v", or be added
 * to this list with its reason: it cannot be neither unnoticed.
 */
const REFERENCE_TO_VIDEO_PROVIDERS: Readonly<Record<string, string>> = {
  "wan": "Wan 2.6 video-to-video makes a new clip featuring the input video's subject; it does not edit the clip",
  "wan-flash": "the faster tier of the same Wan 2.6 reference-to-video model",
}

describe("MODEL_CATALOG covers every video-to-video provider", () => {
  it.each([...VIDEO_TO_VIDEO_PROVIDERS])("%s has a video entry", (p) => {
    const entry = MODEL_CATALOG[p]
    expect(entry, `Add a MODEL_CATALOG entry for ${p}`).toBeDefined()
    expect(entry!.kind).toBe("video")
  })

  it("every provider is an edit model (\"v2v\") except the named reference-to-video ones", () => {
    const others = VIDEO_TO_VIDEO_PROVIDERS.filter((p) => !MODEL_CATALOG[p]!.modes.includes("v2v"))
    expect([...others].sort()).toEqual(Object.keys(REFERENCE_TO_VIDEO_PROVIDERS).sort())
    for (const id of ["happyhorse-edit", "luma-modify", "runway-aleph", "wan-videoedit"]) {
      expect(MODEL_CATALOG[id]!.modes, id).toContain("v2v")
    }
  })

  it("a reference-to-video model is a Video to Video provider and no edit model", () => {
    for (const id of Object.keys(REFERENCE_TO_VIDEO_PROVIDERS)) {
      expect(VIDEO_TO_VIDEO_PROVIDERS as readonly string[]).toContain(id)
      expect(MODEL_CATALOG[id]!.modes).not.toContain("v2v")
    }
    // The shared id keeps its text-to-video listing; the fast tier has no other lane.
    expect(MODEL_CATALOG["wan"]!.modes).toEqual(["t2v"])
    expect(MODEL_CATALOG["wan-flash"]!.modes).toEqual([])
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
