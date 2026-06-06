import { describe, it, expect } from "vitest"
import { buildPresetTree, presetMatchesQuery } from "../preset-tree"
import type { NodePreset, NodePresetGroup } from "@/lib/api"

const preset = (over: Partial<NodePreset> & { id: string; name: string }): NodePreset => ({
  nodeType: "generate-image",
  data: {},
  tags: [],
  sortOrder: 0,
  createdAt: "",
  updatedAt: "",
  ...over,
})
const group = (over: Partial<NodePresetGroup> & { id: string; name: string }): NodePresetGroup => ({
  nodeType: "generate-image",
  kind: "folder",
  sortOrder: 0,
  ...over,
})

describe("buildPresetTree", () => {
  it("interleaves groups and root presets by sortOrder", () => {
    const tree = buildPresetTree(
      [preset({ id: "p1", name: "Loose", sortOrder: 1 })],
      [group({ id: "g1", name: "Folder", sortOrder: 0 })],
    )
    expect(tree.map((n) => (n.kind === "group" ? n.group.id : n.preset.id))).toEqual(["g1", "p1"])
  })

  it("nests presets under their group, ordered", () => {
    const tree = buildPresetTree(
      [
        preset({ id: "p2", name: "B", groupId: "g1", sortOrder: 1 }),
        preset({ id: "p1", name: "A", groupId: "g1", sortOrder: 0 }),
      ],
      [group({ id: "g1", name: "Folder" })],
    )
    expect(tree).toHaveLength(1)
    expect(tree[0].kind).toBe("group")
    if (tree[0].kind === "group") expect(tree[0].presets.map((p) => p.id)).toEqual(["p1", "p2"])
  })

  it("falls a dangling group_id back to root", () => {
    const tree = buildPresetTree([preset({ id: "p1", name: "Orphan", groupId: "gone" })], [])
    expect(tree).toHaveLength(1)
    expect(tree[0].kind).toBe("preset")
  })
})

describe("presetMatchesQuery", () => {
  it("matches name, description, and tags case-insensitively", () => {
    const p = preset({ id: "p1", name: "Cinematic", description: "moody", tags: ["portrait", "hero"] })
    expect(presetMatchesQuery(p, "cine")).toBe(true)
    expect(presetMatchesQuery(p, "MOODY")).toBe(true)
    expect(presetMatchesQuery(p, "hero")).toBe(true)
    expect(presetMatchesQuery(p, "landscape")).toBe(false)
    expect(presetMatchesQuery(p, "")).toBe(true)
  })
})
