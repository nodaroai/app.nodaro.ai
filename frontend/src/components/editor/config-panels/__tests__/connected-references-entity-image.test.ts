import { describe, it, expect } from "vitest"
import { buildImageConnectedReferences } from "../connected-references"
import type { SourceNodeInfo } from "../types"

function entitySource(type: string, sourceHandle: string): SourceNodeInfo {
  return {
    id: "s1", type, label: "Kira", value: "",
    sourceHandle, targetHandle: "references",
    nodeData: {
      characterName: "Kira",
      sourceImageUrl: "https://r2/kira.png",
      generatedResults: [{ url: "https://r2/active.png" }],
      activeResultIndex: 0,
      canonicalDescription: "tall",
    },
  }
}

// Minimal valid params for the generate-image builder.
const base = { data: {}, nodes: [], attachedChars: [] }

describe("buildImageConnectedReferences — entity image handle (Gap C, generate-image)", () => {
  it("characterRef handle → a wired-character identity ref", () => {
    const refs = buildImageConnectedReferences({ ...base, sources: [entitySource("character", "characterRef")] })
    expect(refs.some((r) => r.source === "wired-character")).toBe(true)
  })

  it.each(["character", "object", "location", "creature"])(
    "%s image handle → plain wired-image with the active result url, no identity",
    (type) => {
      const refs = buildImageConnectedReferences({ ...base, sources: [entitySource(type, "image")] })
      const identity = ["wired-character", "wired-object", "wired-location", "wired-creature"]
      expect(refs.some((r) => identity.includes(r.source))).toBe(false)
      expect(refs.some((r) => r.source === "wired-image" && r.url === "https://r2/active.png")).toBe(true)
    },
  )
})
