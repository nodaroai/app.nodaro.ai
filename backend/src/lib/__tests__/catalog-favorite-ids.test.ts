import { describe, expect, it } from "vitest"
import { getRegisteredPickerCatalogs } from "@nodaro/prompts/picker-catalogs"
import { STYLE_PRESETS } from "@nodaro/prompts/presets"
import { BLUEPRINT_IDS } from "../../services/shot-sequence/blueprint-params.js"
import {
  EXTRA_CATALOGS,
  canonicalCatalogId,
  catalogOptionLabel,
  favoritableCatalogIds,
  resolveCatalogFavorite,
} from "../catalog-favorite-ids.js"

const catalog = (id: string) => {
  const c = getRegisteredPickerCatalogs().find((x) => x.catalogId === id)
  if (!c) throw new Error(`no catalog ${id}`)
  return c
}

describe("which picker options can be favorited", () => {
  it("every served picker catalog, plus the shot shapes and the Style Gallery looks, each by its own id", () => {
    const ids = favoritableCatalogIds()
    for (const c of getRegisteredPickerCatalogs()) expect(ids).toContain(c.catalogId)
    expect(ids).toContain("shot-shapes")
    expect(ids).toContain("style-presets")
    expect(new Set(ids).size).toBe(ids.length)
    // An extra catalog never shadows a picker catalog's id or node type.
    for (const extra of EXTRA_CATALOGS) {
      expect(getRegisteredPickerCatalogs().some((c) => c.catalogId === extra.id || c.nodeType === extra.id)).toBe(false)
    }
  })

  it("covers the catalogs the product asks for: looks, music, camera moves, Person", () => {
    for (const id of ["style", "color-look", "music-genre", "music-mood", "instrumentation", "voice-character", "voice-delivery", "camera-motions", "person"]) {
      expect(favoritableCatalogIds()).toContain(id)
    }
  })

  it("a single catalog's own option is stored by its bare id", () => {
    const style = catalog("style")
    const first = style.options![0]!
    expect(resolveCatalogFavorite("style", first.id)).toEqual({ ok: true, key: { catalog: "style", optionId: first.id, label: first.label } })
    // `<valueField>:<id>` names the same option and is stored bare.
    expect(resolveCatalogFavorite("style", `${style.valueField}:${first.id}`)).toMatchObject({ ok: true, key: { optionId: first.id } })
  })

  it("a node type is another spelling of its catalog, stored as the catalogId", () => {
    const motions = catalog("camera-motions")
    const option = motions.options![0]!
    expect(motions.nodeType).toBe("camera-motion")
    expect(resolveCatalogFavorite("camera-motion", option.id)).toMatchObject({ ok: true, key: { catalog: "camera-motions", optionId: option.id } })
    expect(canonicalCatalogId("camera-motion")).toBe("camera-motions")
  })

  it("a multi-field option is <field>:<id>; a bare id that names one option is put in that form", () => {
    const genre = catalog("music-genre")
    const dim = genre.dimensions![0]!
    const option = dim.options[0]!
    const stored = `${dim.field}:${option.id}`
    expect(resolveCatalogFavorite("music-genre", stored)).toEqual({ ok: true, key: { catalog: "music-genre", optionId: stored, label: option.label } })
    expect(resolveCatalogFavorite("music-genre", option.id)).toMatchObject({ ok: true, key: { optionId: stored } })
  })

  it("the documented example: music-genre's genre:jazz, also as a bare id", () => {
    expect(resolveCatalogFavorite("music-genre", "genre:jazz")).toMatchObject({ ok: true, key: { catalog: "music-genre", optionId: "genre:jazz" } })
    expect(resolveCatalogFavorite("music-genre", "jazz")).toMatchObject({ ok: true, key: { optionId: "genre:jazz" } })
  })

  it("a bare id is the catalog's own option first; a secondary field's option of the same id is <field>:<id>", () => {
    // `auto` is a transition AND an option of its secondary fields (position, duration, ...).
    const transitions = catalog("transitions")
    expect(transitions.options!.some((o) => o.id === "auto")).toBe(true)
    expect(resolveCatalogFavorite("transitions", "auto")).toMatchObject({ ok: true, key: { optionId: "auto" } })
    const field = transitions.dimensions!.find((d) => d.options.some((o) => o.id === "auto"))!.field
    expect(resolveCatalogFavorite("transitions", `${field}:auto`)).toMatchObject({ ok: true, key: { optionId: `${field}:auto` } })
  })

  it("the shot shapes and the Style Gallery looks validate against their own catalogs", () => {
    expect(resolveCatalogFavorite("shot-shapes", BLUEPRINT_IDS[0])).toMatchObject({ ok: true, key: { catalog: "shot-shapes", optionId: BLUEPRINT_IDS[0] } })
    expect(resolveCatalogFavorite("style-presets", STYLE_PRESETS[0]!.id)).toMatchObject({ ok: true, key: { label: STYLE_PRESETS[0]!.label } })
    expect(resolveCatalogFavorite("shot-shapes", "no-such-shape")).toMatchObject({ ok: false, reason: "unknown_option" })
  })

  it("refuses an unknown catalog or option", () => {
    expect(resolveCatalogFavorite("no-such-catalog", "x")).toMatchObject({ ok: false, reason: "unknown_catalog" })
    expect(resolveCatalogFavorite("style", "no-such-style")).toMatchObject({ ok: false, reason: "unknown_option" })
    expect(resolveCatalogFavorite("music-genre", "genre:no-such-genre")).toMatchObject({ ok: false, reason: "unknown_option" })
    expect(resolveCatalogFavorite("music-genre", "nofield:x")).toMatchObject({ ok: false, reason: "unknown_option" })
    expect(canonicalCatalogId("no-such-catalog")).toBeNull()
  })

  it("labels a stored option, and says null for one its catalog dropped", () => {
    const option = catalog("mood").options![0]!
    expect(catalogOptionLabel("mood", option.id)).toBe(option.label)
    expect(catalogOptionLabel("mood", "dropped-long-ago")).toBeNull()
  })

  it("every option id fits the stored column (1–200 characters) in its stored form", () => {
    for (const c of getRegisteredPickerCatalogs()) {
      for (const o of c.options ?? []) expect(o.id.length).toBeLessThanOrEqual(200)
      for (const d of c.dimensions ?? []) for (const o of d.options) expect(`${d.field}:${o.id}`.length).toBeLessThanOrEqual(200)
    }
  })
})
