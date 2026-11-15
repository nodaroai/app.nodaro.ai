import { describe, expect, it } from "vitest"
import {
  ALLOW_LIST_EXEMPT_NODE_TYPES,
  WORLD_IDS,
  isAllowListGatedNodeType,
  listsSet,
  listsWithhold,
  nodeListsWithhold,
  worldOffered,
} from "../entries/runtime-config.js"

const NONE = { allow: [], deny: [] }
const everything = () => true

describe("listsWithhold — a deployment's own allow/deny lists", () => {
  it("lists that are not set withhold nothing", () => {
    expect(listsWithhold(NONE, "generate-image", everything)).toBe(false)
    expect(listsSet(NONE)).toBe(false)
    expect(listsSet(undefined)).toBe(false)
  })

  it("a non-empty allow withholds every governed id outside it", () => {
    const lists = { allow: ["generate-image"], deny: [] }
    expect(listsSet(lists)).toBe(true)
    expect(listsWithhold(lists, "generate-image", everything)).toBe(false)
    expect(listsWithhold(lists, "generate-video", everything)).toBe(true)
  })

  it("an id the allow list does not govern is withheld only by deny", () => {
    const lists = { allow: ["generate-image"], deny: ["preview"] }
    const governed = (id: string) => id !== "sticky-note" && id !== "preview"
    expect(listsWithhold(lists, "sticky-note", governed)).toBe(false)
    expect(listsWithhold(lists, "preview", governed)).toBe(true)
  })

  it("deny withholds what it names, also inside allow", () => {
    const lists = { allow: ["generate-image", "dubbing"], deny: ["dubbing"] }
    expect(listsSet({ allow: [], deny: ["dubbing"] })).toBe(true)
    expect(listsWithhold(lists, "dubbing", everything)).toBe(true)
    expect(listsWithhold(lists, "generate-image", everything)).toBe(false)
  })
})

describe("nodeListsWithhold — the node lists", () => {
  it("a whitelist never withholds a utility node or Site Capture by leaving it out", () => {
    const lists = { allow: ["generate-image"], deny: [] }
    expect(ALLOW_LIST_EXEMPT_NODE_TYPES).toEqual(expect.arrayContaining(["sticky-note", "preview", "group", "site-capture"]))
    for (const type of ALLOW_LIST_EXEMPT_NODE_TYPES) {
      expect(isAllowListGatedNodeType(type), type).toBe(false)
      expect(nodeListsWithhold(lists, type), type).toBe(false)
      expect(nodeListsWithhold({ allow: ["generate-image"], deny: [type] }, type), type).toBe(true)
    }
  })

  it("a whitelist withholds every other node type it does not list, features with no canvas node included", () => {
    const lists = { allow: ["generate-image", "dubbing"], deny: [] }
    for (const type of ["generate-video", "combine-text", "sub-workflow", "cast-swap", "voice-clone-one-off"]) {
      expect(isAllowListGatedNodeType(type), type).toBe(true)
      expect(nodeListsWithhold(lists, type), type).toBe(true)
    }
    expect(nodeListsWithhold(lists, "dubbing")).toBe(false)
  })

  it("a deny of the Voice Clone node withholds a one-off clone too; a whitelist without it does not", () => {
    expect(nodeListsWithhold({ allow: [], deny: ["voice-clone"] }, "voice-clone-one-off")).toBe(true)
    expect(nodeListsWithhold({ allow: ["voice-clone-one-off"], deny: [] }, "voice-clone-one-off")).toBe(false)
  })

  it("takes the caller's own idea of what a whitelist governs", () => {
    const lists = { allow: ["generate-image"], deny: [] }
    expect(nodeListsWithhold(lists, "a-type-the-caller-does-not-know", (type) => type === "generate-video")).toBe(false)
    expect(nodeListsWithhold(lists, "generate-video", (type) => type === "generate-video")).toBe(true)
  })
})

describe("worldOffered — a world, by the profile's allowlist and the node types it runs", () => {
  it("every world, where nothing is withheld and no allowlist is set", () => {
    for (const id of WORLD_IDS) expect(worldOffered(undefined, id, () => false), id).toBe(true)
  })

  it("not a world the allowlist leaves out", () => {
    expect(worldOffered({ allow: ["image"] }, "video", () => false)).toBe(false)
    expect(worldOffered({ allow: ["image"] }, "image", () => false)).toBe(true)
  })

  it("not a world one of whose node types is withheld; a world that runs none follows the allowlist alone", () => {
    const withheld = (type: string) => type === "text-to-video"
    expect(worldOffered(undefined, "video", withheld)).toBe(false)
    expect(worldOffered(undefined, "image", withheld)).toBe(true)
    expect(worldOffered(undefined, "app", () => true)).toBe(true)
  })
})
