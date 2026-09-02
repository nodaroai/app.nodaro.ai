/**
 * The wall. What it must do: refuse an id the deployment does not offer, on
 * every shape a run can carry one in — a parameter node's own field, a pose
 * sub-pick, a consumer node's folded `direction`/`subject`, a request body —
 * and refuse NOTHING on a deployment with no packs.
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  registerCatalogPack,
  resetCatalogPacks,
  findForeignCatalogIds,
  findForeignCatalogIdsInBody,
  foreignCatalogIdMessage,
  catalogGuardActive,
  getPickerCatalog,
  SETTINGS,
  POSES,
  __resetCatalogIdGuardForTests,
} from "../index.js"

const setting0 = SETTINGS[0].id
const setting1 = SETTINGS[1].id
const pose0 = POSES[0].id

afterEach(() => {
  resetCatalogPacks()
  __resetCatalogIdGuardForTests()
})

describe("inert without packs", () => {
  it("refuses nothing, even garbage — a deployment that curates nothing offers everything", () => {
    expect(catalogGuardActive()).toBe(false)
    expect(findForeignCatalogIds([{ id: "a", type: "setting", data: { setting: "not-a-real-id" } }])).toEqual([])
    expect(findForeignCatalogIdsInBody("generate-image", { direction: { setting: "nope" } })).toEqual([])
  })
})

describe("with a deny pack on `setting`", () => {
  const deny = () => registerCatalogPack({ id: "g-deny", catalogId: "setting", mode: "deny", denyIds: [setting0] })

  it("a parameter node carrying the denied id is named", () => {
    deny()
    const found = findForeignCatalogIds([{ id: "n1", type: "setting", data: { setting: setting0 } }])
    expect(found).toEqual([{ nodeId: "n1", nodeType: "setting", field: "setting", id: setting0, catalogId: "setting" }])
  })

  it("a sibling id the pack left alone passes", () => {
    deny()
    expect(findForeignCatalogIds([{ id: "n1", type: "setting", data: { setting: setting1 } }])).toEqual([])
  })

  it("an id that never existed anywhere is refused too (not only denied ones)", () => {
    deny()
    expect(findForeignCatalogIds([{ id: "n1", type: "setting", data: { setting: "made-up" } }])).toHaveLength(1)
  })

  it("empty / absent values are not ids", () => {
    deny()
    expect(findForeignCatalogIds([{ id: "n1", type: "setting", data: { setting: "" } }])).toEqual([])
    expect(findForeignCatalogIds([{ id: "n1", type: "setting", data: {} }])).toEqual([])
    expect(findForeignCatalogIds([{ id: "n1", type: "setting", data: { setting: null } }])).toEqual([])
  })

  it("free-text fields on the same node are never validated", () => {
    deny()
    expect(
      findForeignCatalogIds([{ id: "n1", type: "setting", data: { setting: setting1, preText: setting0, customText: "anything" } }]),
    ).toEqual([])
  })

  it("a CONSUMER node's folded direction record is checked against the same catalog", () => {
    deny()
    const found = findForeignCatalogIds([{ id: "g1", type: "generate-image", data: { direction: { setting: setting0 } } }])
    expect(found).toEqual([{ nodeId: "g1", nodeType: "generate-image", field: "setting", id: setting0, catalogId: "setting" }])
  })

  it("a request body's direction record is checked (the single-node routes)", () => {
    deny()
    expect(findForeignCatalogIdsInBody("generate-image", { direction: { setting: setting0 } })).toHaveLength(1)
    expect(findForeignCatalogIdsInBody("generate-image", { direction: { setting: setting1 } })).toEqual([])
  })

  it("nodes of unrelated types are ignored", () => {
    deny()
    expect(findForeignCatalogIds([{ id: "t", type: "text-prompt", data: { text: setting0 } }])).toEqual([])
  })
})

describe("the field contract covers the shapes the resolvers actually read", () => {
  it("pose sub-picks (handPosition/bodyLean/headTilt/activity) resolve against `pose`", () => {
    registerCatalogPack({ id: "g-pose", catalogId: "pose", mode: "deny", denyIds: [pose0] })
    const found = findForeignCatalogIds([{ id: "p", type: "pose", data: { handPosition: pose0 } }])
    expect(found.map((f) => f.field)).toEqual(["handPosition"])
  })

  it("array-valued multi-pick fields are checked per element", () => {
    registerCatalogPack({ id: "g-pose2", catalogId: "pose", mode: "deny", denyIds: [pose0] })
    // `pose` is single, but the guard's value reader must handle arrays for
    // the multi catalogs; exercise it on a field that accepts both.
    const found = findForeignCatalogIds([{ id: "p", type: "pose", data: { pose: [POSES[1].id, pose0] } }])
    expect(found.map((f) => f.id)).toEqual([pose0])
  })

  it("a multi-dim catalog checks every dimension field", () => {
    const framing = getPickerCatalog("framing")!
    const dim = framing.dimensions![0]
    const victim = dim.options[0].id
    registerCatalogPack({ id: "g-framing", catalogId: "framing", mode: "deny", denyIds: [victim] })
    const found = findForeignCatalogIds([{ id: "f", type: "framing", data: { [dim.field]: victim } }])
    expect(found).toHaveLength(1)
    expect(found[0].catalogId).toBe("framing")
  })

  it("legacy direction aliases map to their catalogs", () => {
    const lens = getPickerCatalog("lens")!
    const victim = lens.options![0].id
    registerCatalogPack({ id: "g-lens", catalogId: "lens", mode: "deny", denyIds: [victim] })
    expect(findForeignCatalogIdsInBody("generate-image", { direction: { lensId: victim } })).toHaveLength(1)
  })

  it("a field a REPLACE pack dropped entirely still counts as an id field — any value fails", () => {
    const base = getPickerCatalog("framing")!
    const dropped = base.dimensions![0]
    registerCatalogPack({
      id: "g-replace-drop",
      catalogId: "framing",
      mode: "replace",
      catalog: { ...base, dimensions: base.dimensions!.slice(1), fields: base.fields!.slice(1) },
    })
    const found = findForeignCatalogIds([{ id: "f", type: "framing", data: { [dropped.field]: dropped.options[0].id } }])
    expect(found).toHaveLength(1)
  })
})

describe("the message", () => {
  it("names every offending value once, by field", () => {
    const msg = foreignCatalogIdMessage([
      { nodeType: "setting", field: "setting", id: "x", catalogId: "setting" },
      { nodeType: "setting", field: "setting", id: "x", catalogId: "setting" },
      { nodeType: "pose", field: "pose", id: "y", catalogId: "pose" },
    ])
    expect(msg).toContain('setting="x"')
    expect(msg).toContain('pose="y"')
    expect(msg.split('setting="x"').length).toBe(2)
  })
})
