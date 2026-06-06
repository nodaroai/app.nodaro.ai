import { describe, it, expect } from "vitest"
import { FACTORY_PRESETS, getFactoryPresets, groupFactoryPresets } from "../factory-presets.js"
import { extractPresetData } from "../node-preset-extract.js"
import { IMAGE_GEN_PROVIDERS, MODIFY_IMAGE_PROVIDERS, STYLE_IDS, aspectRatioOptionsByKind } from "../index.js"

describe("FACTORY_PRESETS", () => {
  it("has presets for generate-image", () => {
    expect(getFactoryPresets("generate-image").length).toBeGreaterThan(0)
  })

  it("returns [] for an unknown node type", () => {
    expect(getFactoryPresets("does-not-exist")).toEqual([])
  })

  it("every factory preset has a stable unique id, name, and object data", () => {
    const ids = new Set<string>()
    for (const [, presets] of Object.entries(FACTORY_PRESETS)) {
      for (const p of presets) {
        expect(p.id).toMatch(/.+\/.+/) // "<nodeType>/<slug>"
        expect(ids.has(p.id)).toBe(false)
        ids.add(p.id)
        expect(typeof p.name).toBe("string")
        expect(p.name.length).toBeGreaterThan(0)
        expect(typeof p.data).toBe("object")
      }
    }
  })

  it("factory preset data never contains excluded/runtime keys", () => {
    for (const [, presets] of Object.entries(FACTORY_PRESETS)) {
      for (const p of presets) {
        // extract is a no-op iff data already excludes runtime/label/fieldMappings
        expect(extractPresetData(p.data)).toEqual(p.data)
      }
    }
  })

  it("generate-image factory presets use a known image provider", () => {
    for (const p of getFactoryPresets("generate-image")) {
      if (p.data.provider !== undefined) {
        expect(IMAGE_GEN_PROVIDERS).toContain(p.data.provider as never)
      }
    }
  })
})

describe("groupFactoryPresets", () => {
  it("returns a single null bucket when nothing is grouped", () => {
    const out = groupFactoryPresets([
      { id: "a/1", name: "One", data: {} },
      { id: "a/2", name: "Two", data: {} },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.group).toBeNull()
    expect(out[0]!.presets.map((p) => p.id)).toEqual(["a/1", "a/2"])
  })

  it("buckets presets by group, preserving first-appearance order", () => {
    const out = groupFactoryPresets([
      { id: "a/1", name: "One", group: "Folder A", data: {} },
      { id: "a/2", name: "Two", group: "Folder B", data: {} },
      { id: "a/3", name: "Three", group: "Folder A", data: {} },
    ])
    expect(out.map((g) => g.group)).toEqual(["Folder A", "Folder B"])
    expect(out[0]!.presets.map((p) => p.id)).toEqual(["a/1", "a/3"])
    expect(out[1]!.presets.map((p) => p.id)).toEqual(["a/2"])
  })

  it("keeps ungrouped presets in their own leading null bucket", () => {
    const out = groupFactoryPresets([
      { id: "a/1", name: "One", data: {} },
      { id: "a/2", name: "Two", group: "Folder A", data: {} },
    ])
    expect(out.map((g) => g.group)).toEqual([null, "Folder A"])
  })

  it("defaults groupKind to folder and respects an explicit section", () => {
    const out = groupFactoryPresets([
      { id: "a/1", name: "One", group: "F", data: {} },
      { id: "a/2", name: "Two", group: "S", groupKind: "section", data: {} },
    ])
    expect(out[0]!.groupKind).toBe("folder")
    expect(out[1]!.groupKind).toBe("section")
  })
})

describe("generate-image factory preset data validity", () => {
  const imageAR = aspectRatioOptionsByKind("image")
  // Mirrors the frontend's getAspectRatiosForModel fallback (model-options.ts).
  const DEFAULT_AR = ["1:1", "16:9", "9:16", "4:3"]
  const presets = getFactoryPresets("generate-image")

  it("pairs every aspectRatio with a provider that actually supports it", () => {
    for (const p of presets) {
      const provider = p.data.provider as string | undefined
      const ar = p.data.aspectRatio as string | undefined
      if (!provider || !ar || ar === "auto") continue
      const valid = imageAR[provider]?.map((o) => o.value) ?? DEFAULT_AR
      expect(
        valid,
        `${p.id}: aspectRatio "${ar}" is not supported by provider "${provider}" — valid: ${valid.join(", ")}`,
      ).toContain(ar)
    }
  })

  it("only references known style ids", () => {
    for (const p of presets) {
      const style = p.data.style as string | undefined
      if (style === undefined) continue
      expect(STYLE_IDS, `${p.id}: unknown style "${style}"`).toContain(style)
    }
  })

  it("respects prompt (2000) and negativePrompt (5000) length caps", () => {
    for (const p of presets) {
      const prompt = (p.data.prompt as string | undefined) ?? ""
      const neg = (p.data.negativePrompt as string | undefined) ?? ""
      expect(prompt.length, `${p.id}: prompt exceeds 2000 chars`).toBeLessThanOrEqual(2000)
      expect(neg.length, `${p.id}: negativePrompt exceeds 5000 chars`).toBeLessThanOrEqual(5000)
    }
  })

  it("groups every preset under a folder (no stray ungrouped presets)", () => {
    for (const p of presets) {
      expect(p.group, `${p.id}: missing group`).toBeTruthy()
    }
  })
})

describe("modify-image factory preset data validity", () => {
  const presets = getFactoryPresets("modify-image")

  it("uses a known modify-image provider", () => {
    for (const p of presets) {
      if (p.data.provider === undefined) continue
      expect(MODIFY_IMAGE_PROVIDERS, `${p.id}: unknown provider`).toContain(p.data.provider as never)
    }
  })

  it("only references known style ids", () => {
    for (const p of presets) {
      const style = p.data.style as string | undefined
      if (style === undefined) continue
      expect(STYLE_IDS, `${p.id}: unknown style "${style}"`).toContain(style)
    }
  })

  it("respects the prompt 2000-char cap", () => {
    for (const p of presets) {
      const prompt = (p.data.prompt as string | undefined) ?? ""
      expect(prompt.length, `${p.id}: prompt exceeds 2000 chars`).toBeLessThanOrEqual(2000)
    }
  })
})
