import { describe, it, expect } from "vitest"
import { buildPresetTree, presetMatchesQuery, buildResetToDefaultData } from "../preset-tree"
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

describe("buildResetToDefaultData", () => {
  const def = { label: "Generate Image", prompt: "", provider: "nano-banana-pro", style: "", aspectRatio: "16:9", fieldMappings: {} }

  it("resets config to defaults, clears extra config + the active preset, preserves label/wiring/results", () => {
    const current = {
      label: "My Node",
      prompt: "a cat",
      provider: "flux",
      seed: 5, // extra (not in default) → cleared
      resolution: "4K", // extra → cleared
      fieldMappings: { prompt: "node_3" }, // wiring → preserved (not in payload)
      generatedResults: [{ url: "x" }], // result → preserved (not in payload)
      __activePresetId: "u1",
    }
    const payload = buildResetToDefaultData(current, def)
    // default-defined config reset to defaults
    expect(payload.prompt).toBe("")
    expect(payload.provider).toBe("nano-banana-pro")
    expect(payload.style).toBe("")
    expect(payload.aspectRatio).toBe("16:9")
    // extras cleared
    expect(payload.seed).toBeUndefined()
    expect("seed" in payload).toBe(true)
    expect(payload.resolution).toBeUndefined()
    // active preset cleared
    expect(payload.__activePresetId).toBeUndefined()
    expect("__activePresetId" in payload).toBe(true)
    // label / fieldMappings / results NOT in the payload (so the merge preserves them)
    expect("label" in payload).toBe(false)
    expect("fieldMappings" in payload).toBe(false)
    expect("generatedResults" in payload).toBe(false)
  })

  it("clears generated composer-plan state (motionPlan/lottieUrl) even though capture excludes it", () => {
    const current = {
      motionPrompt: "old prompt",
      motionPlan: { planType: "lottie-graphic" },
      lottieUrl: "https://cdn.example/lottie/x.json",
    }
    const payload = buildResetToDefaultData(current, { motionPrompt: "" })
    expect("motionPlan" in payload).toBe(true)
    expect(payload.motionPlan).toBeUndefined()
    expect("lottieUrl" in payload).toBe(true)
    expect(payload.lottieUrl).toBeUndefined()
  })

  it("handles an undefined default (no defaults to apply, still clears active)", () => {
    const payload = buildResetToDefaultData({ prompt: "x", __activePresetId: "u1" }, undefined)
    expect(payload.prompt).toBeUndefined()
    expect(payload.__activePresetId).toBeUndefined()
  })
})
