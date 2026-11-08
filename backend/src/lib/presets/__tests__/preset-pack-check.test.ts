/**
 * The boot check on registered preset packs (lib/presets/preset-pack-check.ts):
 * every preset names only models this deployment's surface profile offers,
 * only picker ids its COMPOSED catalogs offer (base catalogs with every
 * registered catalog pack applied), and an https example picture or none.
 *
 * What the loader does with the problems (exit 1, one message) is covered in
 * lib/overlay/__tests__/load-preset-packs.test.ts.
 */
import { afterEach, describe, expect, it } from "vitest"
import { registerCatalogPack, resetCatalogPacks } from "@nodaro/prompts/catalog-packs"
import { getRegisteredPickerCatalogs, PICKER_CATALOGS } from "@nodaro/prompts/picker-catalogs"
import {
  DIRECTION_FIELDS,
  SUBJECT_CUSTOM_AGE_KEY,
  getRegisteredSubjectKeys,
  renderDirectionHints,
  renderSubjectHints,
} from "@nodaro/prompts/prompt-builder"
import { __resetSurfaceProfileCacheForTests } from "../../surface-profile.js"
import { __resetModelSwitchForTests } from "../../model-switch.js"
import { __resetAvailabilityOverridesForTests } from "../../availability-override.js"
import { isModelDenied } from "../../surface-deny.js"
import { registerPresetPack, resetPresetPacks, type PackPreset } from "../app-presets.js"
import { DIRECTION_KEY_CATALOG, presetPackProblems, subjectKeyCatalog } from "../preset-pack-check.js"

const preset = (slug: string, data: Record<string, unknown>, extra: Partial<PackPreset> = {}): PackPreset => ({
  id: `generate-image/${slug}`,
  name: slug,
  data: { provider: "gpt-image-2", prompt: "a calm lake at dawn", ...data },
  ...extra,
})

const pack = (...presets: PackPreset[]) => registerPresetPack({ nodeType: "generate-image", presets })

function withProfile(profile: Record<string, unknown>): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

afterEach(() => {
  resetPresetPacks()
  resetCatalogPacks()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  __resetModelSwitchForTests()
  __resetAvailabilityOverridesForTests()
})

describe("presetPackProblems — nothing registered", () => {
  it("has nothing to say", () => {
    expect(presetPackProblems()).toEqual([])
  })
})

describe("presetPackProblems — a pack that fits", () => {
  it("passes with real models, real picker ids and an https picture", () => {
    pack(
      preset(
        "fits",
        {
          style: "anime",
          quality: "high",
          aspectRatio: "auto",
          direction: { lens: "wide-24mm", shotSize: "wide-shot", timeOfDay: ["dawn"] },
          subject: { type: "woman", age: "age-toddler", [SUBJECT_CUSTOM_AGE_KEY]: 30, heldProp: "smartphone" },
        },
        { previewUrl: "https://media.example.test/presets/fits.webp" },
      ),
    )
    expect(presetPackProblems()).toEqual([])
  })

  it("leaves a node's own fields alone where they share a picker field's name", () => {
    registerPresetPack({
      nodeType: "combine-videos",
      presets: [{ id: "combine-videos/soft", name: "Soft", data: { transition: "dissolve", transitionDuration: 0.5 } }],
    })
    registerPresetPack({
      nodeType: "add-captions",
      presets: [{ id: "add-captions/bold", name: "Bold", data: { style: "karaoke", look: "outline" } }],
    })
    expect(presetPackProblems()).toEqual([])
  })
})

describe("presetPackProblems — models", () => {
  it("names a model the profile denies", () => {
    withProfile({ models: { deny: ["gpt-image-2"] } })
    pack(preset("denied", {}))
    expect(presetPackProblems()).toEqual([
      'generate-image/denied: data.provider names model "gpt-image-2", which this deployment does not offer',
    ])
  })

  it("names a model outside the profile's allowlist, and passes one inside it", () => {
    withProfile({ models: { allow: ["seedream-5-pro"] } })
    pack(preset("outside", {}), preset("inside", { provider: "seedream-5-pro" }))
    expect(presetPackProblems()).toEqual([
      'generate-image/outside: data.provider names model "gpt-image-2", which this deployment does not offer',
    ])
  })

  it("reads every field a run names its model by", () => {
    withProfile({ models: { deny: ["gpt-image-2", "seedream-5-pro", "claude-opus-5.5"] } })
    pack(preset("fan-out", { provider: undefined, providers: ["seedream-5-pro"], models: ["gpt-image-2"] }))
    registerPresetPack({
      nodeType: "llm-chat",
      presets: [{ id: "llm-chat/careful", name: "Careful", data: { llmModel: "claude-opus-5.5" } }],
    })
    expect(presetPackProblems()).toEqual([
      'generate-image/fan-out: data.providers names model "seedream-5-pro", which this deployment does not offer',
      'generate-image/fan-out: data.models names model "gpt-image-2", which this deployment does not offer',
      'llm-chat/careful: data.llmModel names model "claude-opus-5.5", which this deployment does not offer',
    ])
  })

  it("judges the profile alone: an admin's switch or override does not fail a boot", () => {
    __resetModelSwitchForTests(["gpt-image-2"])
    __resetAvailabilityOverridesForTests({ models: new Set(["seedream-5-pro"]) })
    expect(isModelDenied("gpt-image-2")).toBe(true)
    pack(preset("switched-off", {}))
    expect(presetPackProblems()).toEqual([])
  })
})

describe("presetPackProblems — picker ids", () => {
  it("names a direction id the catalog does not have", () => {
    pack(preset("typo", { direction: { lens: "no-such-lens", shotSize: ["wide-shot", "no-such-shot"] } }))
    expect(presetPackProblems()).toEqual([
      'generate-image/typo: data.direction.lens "no-such-lens" is not an option of this deployment\'s "lens" catalog',
      'generate-image/typo: data.direction.shotSize "no-such-shot" is not an option of this deployment\'s "framing" catalog',
    ])
  })

  it("reads the composed catalogs: an id a catalog pack removed is refused", () => {
    pack(preset("styled", { style: "anime", direction: { style: "anime" } }))
    expect(presetPackProblems()).toEqual([])
    registerCatalogPack({ id: "test-deny-anime", catalogId: "style", mode: "deny", denyIds: ["anime"] })
    expect(presetPackProblems()).toEqual([
      'generate-image/styled: data.style "anime" is not an option of this deployment\'s "style" catalog',
      'generate-image/styled: data.direction.style "anime" is not an option of this deployment\'s "style" catalog',
    ])
  })

  it("refuses a reference to a user's own saved item", () => {
    pack(preset("mine", { direction: { colorLook: "palette:00000000-0000-4000-8000-000000000001" } }))
    expect(presetPackProblems()).toEqual([
      'generate-image/mine: data.direction.colorLook "palette:00000000-0000-4000-8000-000000000001" is not an option of this deployment\'s "color-look" catalog',
    ])
  })

  it("checks a subject field against its own dimension", () => {
    pack(preset("subject", { subject: { age: "woman", material: "no-such-material" } }))
    expect(presetPackProblems()).toEqual([
      'generate-image/subject: data.subject.age "woman" is not an option of this deployment\'s "person" catalog',
      'generate-image/subject: data.subject.material "no-such-material" is not an option of this deployment\'s "materials" catalog',
    ])
  })

  it("checks a picker node's own value fields", () => {
    registerPresetPack({
      nodeType: "setting",
      presets: [
        { id: "setting/cafe", name: "Cafe", data: { setting: "coffee-shop" } },
        { id: "setting/nowhere", name: "Nowhere", data: { setting: "no-such-place" } },
      ],
    })
    expect(presetPackProblems()).toEqual([
      'setting/nowhere: data.setting "no-such-place" is not an option of this deployment\'s "setting" catalog',
    ])
  })

  it("ignores keys a run ignores, and empty picks", () => {
    pack(preset("loose", { style: "", direction: { notADirectionKey: "x", lens: "" }, subject: { notASubjectKey: "y" } }))
    expect(presetPackProblems()).toEqual([])
  })
})

describe("presetPackProblems — example picture", () => {
  it("accepts https or none, and names anything else", () => {
    pack(
      preset("https", {}, { previewUrl: "https://media.example.test/a.webp" }),
      preset("none", {}),
      preset("http", {}, { previewUrl: "http://media.example.test/a.webp" }),
      preset("relative", {}, { previewUrl: "/preset-previews/a.webp" }),
    )
    expect(presetPackProblems()).toEqual([
      'generate-image/http: previewUrl must be absent or an absolute https URL (got "http://media.example.test/a.webp")',
      'generate-image/relative: previewUrl must be absent or an absolute https URL (got "/preset-previews/a.webp")',
    ])
  })
})

describe("presetPackProblems — reports everything at once", () => {
  it("lists every problem of every pack", () => {
    withProfile({ models: { deny: ["gpt-image-2"] } })
    pack(preset("one", { direction: { lens: "no-such-lens" } }, { previewUrl: "ftp://x.test/a.webp" }))
    registerPresetPack({ nodeType: "setting", presets: [{ id: "setting/two", name: "Two", data: { setting: "nope" } }] })
    expect(presetPackProblems()).toHaveLength(4)
  })
})

// The key → catalog tables are hand-written; these pin them to the registries
// they mirror, so a new direction or subject key cannot go unchecked.
describe("the key → catalog tables", () => {
  const catalogIds = new Set(PICKER_CATALOGS.map((c) => c.catalogId))
  const surfaceOf = (s: string): "image" | "video" => (s === "video" ? "video" : "image")
  /** A handful of ids of `catalogId` — of the dimension named `field` when it has one. */
  function idsFor(catalogId: string, field: string): string[] {
    const c = getRegisteredPickerCatalogs().find((x) => x.catalogId === catalogId)!
    const dim = c.dimensions?.find((d) => d.field === field)
    const options = dim?.options ?? c.options ?? c.dimensions?.[0]?.options ?? []
    return options.slice(0, 5).map((o) => o.id)
  }

  it("names a catalog for every direction key, and only real catalogs", () => {
    expect(new Set(DIRECTION_KEY_CATALOG.keys())).toEqual(new Set(DIRECTION_FIELDS.map((f) => f.key)))
    for (const [key, catalogId] of DIRECTION_KEY_CATALOG) expect(catalogIds.has(catalogId), key).toBe(true)
  })

  it("names the catalog each direction key really renders from", () => {
    for (const f of DIRECTION_FIELDS) {
      const ids = idsFor(DIRECTION_KEY_CATALOG.get(f.key)!, f.key)
      const rendered = ids.some((id) => renderDirectionHints({ [f.key]: id }, { surface: surfaceOf(f.surface) }).length > 0)
      expect(rendered, `${f.key} → ${DIRECTION_KEY_CATALOG.get(f.key)}`).toBe(true)
    }
  })

  it("resolves every subject key to the catalog it renders from", () => {
    for (const key of getRegisteredSubjectKeys()) {
      if (key === SUBJECT_CUSTOM_AGE_KEY) continue
      const catalogId = subjectKeyCatalog(key, getRegisteredPickerCatalogs())
      expect(catalogId, key).toBeDefined()
      const ids = idsFor(catalogId!, key)
      const rendered = ids.some((id) => renderSubjectHints({ [key]: id }, { surface: "image" }).length > 0)
      expect(rendered, `${key} → ${catalogId}`).toBe(true)
    }
  })
})
