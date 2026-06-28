import { describe, it, expect } from "vitest"
import { buildConnectedRefsFromSources } from "../connected-refs-builder"
import type { SourceNodeInfo } from "../types"

function entitySource(type: string, sourceHandle: string): SourceNodeInfo {
  return {
    id: "s1", type, label: "Kira", value: "",
    sourceHandle, targetHandle: "in",
    nodeData: { characterName: "Kira", sourceImageUrl: "https://r2/kira.png", generatedResults: [{ url: "https://r2/active.png" }], activeResultIndex: 0 },
  }
}

describe("buildConnectedRefsFromSources — entity image handle (Gap C)", () => {
  it("characterRef handle → wired-character identity ref", () => {
    const refs = buildConnectedRefsFromSources([entitySource("character", "characterRef")])
    expect(refs.some((r) => r.source === "wired-character")).toBe(true)
  })

  it.each(["character", "object", "location", "creature"])(
    "%s image handle → plain wired-image with the active result url",
    (type) => {
      const refs = buildConnectedRefsFromSources([entitySource(type, "image")])
      expect(refs).toHaveLength(1)
      expect(refs[0].source).toBe("wired-image")
      expect(refs[0].url).toBe("https://r2/active.png")
    },
  )
})
