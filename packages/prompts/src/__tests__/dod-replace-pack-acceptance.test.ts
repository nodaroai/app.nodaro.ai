// DoD (spec §8 Phase 0): "SAI resets the 23 catalog files to upstream and
// adopts its vendored packs by registration." In-package form: a full vendored
// copy of a catalog registered as `replace` is adopted everywhere by
// registration alone, with the upstream base left byte-identical.
import { describe, it, expect, beforeEach } from "vitest"
import {
  PICKER_CATALOGS,
  getPickerCatalog,
  getRegisteredPickerCatalogs,
  projectAllCatalogs,
} from "../picker-catalogs.js"
import { registerCatalogPack, resetCatalogPacks } from "../catalog-packs.js"
import type { PickerCatalog } from "../picker-catalogs.js"

beforeEach(() => resetCatalogPacks())

describe("DoD — adopt a vendored replacement pack by registration", () => {
  it("replaces one catalog wholesale across every read; base untouched", () => {
    const upstreamMood = PICKER_CATALOGS.find((c) => c.catalogId === "mood")!
    const upstreamSnapshot = JSON.stringify(PICKER_CATALOGS)

    // SAI's vendored full copy: same shape, curated option set.
    const vendored: PickerCatalog = {
      ...upstreamMood,
      options: [
        { id: "calm", label: "Calm", promptHint: "with a calm mood", term: "calm", category: upstreamMood.options![0].category },
      ],
    }
    registerCatalogPack({ id: "sai/mood", catalogId: "mood", mode: "replace", catalog: vendored })

    // Every funnel/route/enumeration reflects the vendored copy…
    expect(getPickerCatalog("mood")!.options!.map((o) => o.id)).toEqual(["calm"])
    expect(getRegisteredPickerCatalogs().find((c) => c.catalogId === "mood")!.options!.map((o) => o.id)).toEqual([
      "calm",
    ])
    expect(projectAllCatalogs().find((c) => c.catalogId === "mood")!.options!.map((o) => o.id)).toEqual(["calm"])

    // …while the frozen upstream base is byte-identical (invariant: never edited in place).
    expect(JSON.stringify(PICKER_CATALOGS)).toBe(upstreamSnapshot)
  })
})
