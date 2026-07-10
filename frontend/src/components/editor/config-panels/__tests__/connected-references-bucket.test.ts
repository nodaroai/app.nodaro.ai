import { describe, expect, it } from "vitest"
import { buildImageConnectedReferences } from "../connected-references"
import type { SourceNodeInfo } from "../types"

// Boards-first picker ordering (Task 10): the BUILDER stamps a display-only
// `bucket` field onto every character variant entry it expands. The DATA
// order (this array, which feeds `{image:N}` / `@name:N` positional
// numbering) must stay untouched — only the picker MENUS reorder for
// display via `sortCharacterEntriesForDisplay`. Mirrors the helper convention
// in the sibling `connected-references-character-assets.test.ts`.

function wiredCharacter(nodeData: Record<string, unknown>): SourceNodeInfo {
  return { id: "char1", type: "character", label: "Kira", value: "", nodeData }
}

describe("buildImageConnectedReferences bucket stamping", () => {
  it("stamps each character variant entry with its source bucket and keeps boards LAST in data order", () => {
    const nodeData = {
      characterName: "Kira",
      sourceImageUrl: "https://r2/p.png",
      expressions: [{ name: "smile", url: "https://r2/s.png" }],
      boards: [{ name: "Base", url: "https://r2/b.png" }],
    }
    const refs = buildImageConnectedReferences({
      data: {},
      sources: [wiredCharacter(nodeData)],
      nodes: [],
      attachedChars: [],
    })
    const kira = refs.filter((r) => r.characterSlug === "kira")
    expect(kira[0].bucket).toBeUndefined() // canonical
    const smile = kira.find((r) => r.url === "https://r2/s.png")
    const board = kira.find((r) => r.url === "https://r2/b.png")
    expect(smile?.bucket).toBe("expressions")
    expect(board?.bucket).toBe("boards")
    // DATA order (payload-bearing) still has boards last — display sorts, data doesn't.
    expect(kira.indexOf(smile!)).toBeLessThan(kira.indexOf(board!))
  })
})
