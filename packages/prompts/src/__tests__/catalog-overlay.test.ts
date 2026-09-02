/**
 * The resolver-side half of catalog curation: a pack that removes or rewrites
 * an entry must change what the id→entry GETTERS return, because those are
 * what turns a picker id into prompt text at run time. Before this overlay
 * existed, a deployment's curation was visible in /v1/catalogs and invisible
 * in every generated prompt.
 *
 * The totality test at the bottom is the one that keeps this fixed: every
 * catalog with a getter must honor a deny pack, so a new catalog cannot ship
 * with a getter that reads its base constant straight.
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  registerCatalogPack,
  resetCatalogPacks,
  getPickerCatalog,
  PICKER_CATALOGS,
  getSetting,
  getSettingPromptHint,
  getPose,
  getPosePromptHint,
  getParameterPromptHint,
  renderSubjectHints,
  SETTINGS,
  POSES,
} from "../index.js"
import { ANIMALS } from "@nodaro/shared"

afterEach(() => resetCatalogPacks())

describe("overlayEntry — the four outcomes", () => {
  const settingId = SETTINGS[0].id

  it("no packs: the base entry, by identity (mainline byte-identical)", () => {
    expect(getSetting(settingId)).toBe(SETTINGS[0])
  })

  it("deny pack: the id resolves to NOTHING on the prompt path", () => {
    registerCatalogPack({ id: "t-deny", catalogId: "setting", mode: "deny", denyIds: [settingId] })
    expect(getSetting(settingId)).toBeUndefined()
    expect(getSettingPromptHint(settingId)).toBe("")
    // A sibling the pack did not touch still resolves.
    expect(getSetting(SETTINGS[1].id)).toBeDefined()
  })

  it("replace pack with a REWRITE: the composed wording reaches the getter", () => {
    const base = getPickerCatalog("setting")!
    const rewritten = {
      ...base,
      options: base.options!.map((o) =>
        o.id === settingId ? { ...o, label: "Curated Label", promptHint: "curated prompt text" } : o,
      ),
    }
    registerCatalogPack({ id: "t-replace", catalogId: "setting", mode: "replace", catalog: rewritten })
    const s = getSetting(settingId)!
    expect(s.label).toBe("Curated Label")
    expect(s.promptHint).toBe("curated prompt text")
    expect(getSettingPromptHint(settingId)).toBe("curated prompt text")
    // Fields the composed option does not carry survive from the base entry.
    expect(s.id).toBe(settingId)
  })

  it("replace pack that OMITS an entry: the omitted id resolves to nothing", () => {
    const base = getPickerCatalog("setting")!
    registerCatalogPack({
      id: "t-replace-omit",
      catalogId: "setting",
      mode: "replace",
      catalog: { ...base, options: base.options!.filter((o) => o.id !== settingId) },
    })
    expect(getSetting(settingId)).toBeUndefined()
  })

  it("extend pack: a pack-added id resolves to the composed option", () => {
    registerCatalogPack({
      id: "t-extend",
      catalogId: "setting",
      mode: "extend",
      options: [{ id: "curated-only", label: "Curated Only", promptHint: "only in the pack", term: "curated" }],
    })
    expect(getSetting("curated-only")?.promptHint).toBe("only in the pack")
  })
})

describe("the dispatcher honors the overlay end to end", () => {
  it("a denied pose sub-pick contributes nothing to the hint", () => {
    const poseId = POSES[0].id
    const before = getParameterPromptHint({ id: "n", type: "pose", data: { pose: poseId } } as never)
    expect(before).not.toBe("")
    registerCatalogPack({ id: "t-pose", catalogId: "pose", mode: "deny", denyIds: [poseId] })
    expect(getPose(poseId)).toBeUndefined()
    expect(getPosePromptHint(poseId)).toBe("")
    expect(getParameterPromptHint({ id: "n", type: "pose", data: { pose: poseId } } as never)).toBe("")
  })

  it("the @nodaro/shared-owned catalogs are overlaid at the dispatcher", () => {
    const animalId = ANIMALS[0].id
    const before = getParameterPromptHint({ id: "n", type: "animal", data: { animal: animalId } } as never)
    expect(before).not.toBe("")
    registerCatalogPack({ id: "t-animal", catalogId: "animals", mode: "deny", denyIds: [animalId] })
    expect(getParameterPromptHint({ id: "n", type: "animal", data: { animal: animalId } } as never)).toBe("")
  })
})

describe("TOTALITY — every catalog honors a deny pack ON THE PROMPT PATH", () => {
  // Mechanical, not enumerated: walk every catalog, deny its first id, and
  // assert the dispatcher produces NOTHING for a node carrying that id — the
  // same call the orchestrator makes. A getter that still reads its base
  // constant straight fails here whether or not anyone remembered to list it.
  // The field the id lives in comes from the catalog itself (single-dim
  // valueField / multi-dim dimension field), so a catalog cannot slip past by
  // storing its value under a name this test did not know.
  const cases = PICKER_CATALOGS.map((c) => {
    const dim = c.dimensions?.[0]
    const field = c.valueField ?? dim?.field
    // The first REAL entry: a catalog's "auto"/"none" no-op (term "") injects
    // nothing by design, which would make the pre-deny assertion vacuous.
    const opt = (c.options ?? dim?.options ?? []).find((o) => o.term !== "")
    return { nodeType: c.nodeType, catalogId: c.catalogId, field: field!, id: opt?.id ?? "" }
  })

  it.each(cases)("$nodeType", ({ nodeType, catalogId, field, id }) => {
    expect(id, `${catalogId}: catalog has no options to deny`).not.toBe("")
    // `instruments` is the one field whose node value is always an array.
    const node = { id: "n", type: nodeType, data: { [field]: field === "instruments" ? [id] : id } } as never
    const before = getParameterPromptHint(node)
    expect(before, `${nodeType}: the stock id must produce SOME hint for the test to mean anything`).not.toBe("")
    registerCatalogPack({ id: `tot-${catalogId}`, catalogId, mode: "deny", denyIds: [id] })
    expect(getParameterPromptHint(node), `${nodeType}: denied "${id}" still reaches the prompt`).toBe("")
  })

  it("a REWRITE reaches the prompt text end to end, for a prompts-owned and a shared-owned catalog", () => {
    for (const [nodeType, field] of [["setting", "setting"], ["animal", "animal"]] as const) {
      resetCatalogPacks()
      const cat = getPickerCatalog(nodeType)!
      const id = cat.options![0].id
      const stock = getParameterPromptHint({ id: "n", type: nodeType, data: { [field]: id } } as never)
      registerCatalogPack({
        id: `rw-${nodeType}`,
        catalogId: cat.catalogId,
        mode: "replace",
        catalog: { ...cat, options: cat.options!.map((o) => (o.id === id ? { ...o, promptHint: "CURATED WORDING" } : o)) },
      })
      const curated = getParameterPromptHint({ id: "n", type: nodeType, data: { [field]: id } } as never)
      expect(curated, nodeType).toContain("CURATED WORDING")
      expect(curated, nodeType).not.toBe(stock)
    }
  })

  it("the same animal id renders identically through the parameter node and the subject fold", () => {
    const id = getPickerCatalog("animals")!.options![0].id
    registerCatalogPack({
      id: "rw-animal-subject",
      catalogId: "animals",
      mode: "replace",
      catalog: { ...getPickerCatalog("animals")!, options: getPickerCatalog("animals")!.options!.map((o) => (o.id === id ? { ...o, promptHint: "SUBJECT WORDING" } : o)) },
    })
    const viaNode = getParameterPromptHint({ id: "n", type: "animal", data: { animal: id } } as never)
    expect(viaNode).toContain("SUBJECT WORDING")
    const viaSubject = renderSubjectHints({ animal: id }, "image")
    expect(JSON.stringify(viaSubject)).toContain("SUBJECT WORDING")
  })
})
