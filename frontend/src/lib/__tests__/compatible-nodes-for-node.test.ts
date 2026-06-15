import { describe, it, expect } from "vitest"
import { getCompatibleNodesForNode } from "../node-compatibility"
import { handleIdsFromBounds } from "../enumerate-connection-options"
import { NODE_DEFINITIONS } from "@/types/nodes"

const pool = NODE_DEFINITIONS.map((d) => ({ type: d.type, label: d.label, icon: null, category: d.category }))
const giHandles = handleIdsFromBounds(undefined, "generate-image") // out: image; in: prompt/elements/…

describe("getCompatibleNodesForNode", () => {
  it("downstream from an image producer offers image consumers (union over outputs)", () => {
    const { directTypes } = getCompatibleNodesForNode("generate-image", giHandles, "downstream", pool)
    // cinematic-avatar accepts an image on a ref handle (see connection-validation suite)
    expect(directTypes.has("cinematic-avatar")).toBe(true)
  })

  it("upstream into generate-image finds producers that feed its inputs", () => {
    const { direct, compatible } = getCompatibleNodesForNode("generate-image", giHandles, "upstream", pool)
    expect(direct.length + compatible.length).toBeGreaterThan(0)
  })

  it("a node is never in both direct and compatible (direct wins)", () => {
    const { direct, compatible } = getCompatibleNodesForNode("generate-image", giHandles, "downstream", pool)
    const directSet = new Set(direct.map((n) => n.type))
    expect(compatible.every((n) => !directSet.has(n.type))).toBe(true)
  })

  it("preserves pool order in each tier", () => {
    const { direct } = getCompatibleNodesForNode("generate-image", giHandles, "downstream", pool)
    const idx = (t: string) => pool.findIndex((p) => p.type === t)
    for (let i = 1; i < direct.length; i++) expect(idx(direct[i].type)).toBeGreaterThan(idx(direct[i - 1].type))
  })
})
