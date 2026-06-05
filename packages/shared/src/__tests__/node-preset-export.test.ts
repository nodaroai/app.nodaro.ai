import { describe, it, expect } from "vitest"
import {
  buildNodePresetExport,
  parseNodePresetExport,
  NODE_PRESET_EXPORT_KIND,
} from "../node-preset-export.js"

describe("node preset export/import", () => {
  it("builds a versioned envelope", () => {
    const env = buildNodePresetExport(
      [{ nodeType: "generate-image", name: "X", data: { prompt: "a" } }],
      "2026-06-05T00:00:00.000Z",
    )
    expect(env.kind).toBe(NODE_PRESET_EXPORT_KIND)
    expect(env.version).toBe(1)
    expect(env.exportedAt).toBe("2026-06-05T00:00:00.000Z")
    expect(env.presets).toHaveLength(1)
  })

  it("parses a valid envelope and strips runtime keys from data", () => {
    const parsed = parseNodePresetExport({
      kind: NODE_PRESET_EXPORT_KIND,
      version: 1,
      exportedAt: "2026-06-05T00:00:00.000Z",
      presets: [
        { nodeType: "generate-image", name: "X", data: { prompt: "a", generatedResults: [1] } },
      ],
    })
    expect(parsed.presets[0].data).toEqual({ prompt: "a" }) // runtime key stripped
  })

  it("rejects wrong kind / version / shape", () => {
    expect(() => parseNodePresetExport({ kind: "nope", version: 1, presets: [] })).toThrow()
    expect(() =>
      parseNodePresetExport({ kind: NODE_PRESET_EXPORT_KIND, version: 2, presets: [] }),
    ).toThrow()
    expect(() => parseNodePresetExport(null)).toThrow()
    expect(() =>
      parseNodePresetExport({
        kind: NODE_PRESET_EXPORT_KIND,
        version: 1,
        presets: [{ name: "no type", data: {} }],
      }),
    ).toThrow()
  })
})
