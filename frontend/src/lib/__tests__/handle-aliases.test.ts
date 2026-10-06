import { describe, it, expect } from "vitest"
import { LEGACY_SOURCE_HANDLE_ALIASES, LEGACY_TARGET_HANDLE_ALIASES, canonicalSourceHandle, canonicalTargetHandle } from "@nodaro/shared"
import { NODE_DEF_MAP } from "@/types/nodes"

/**
 * The legacy handle alias tables (`@nodaro/shared` handle-aliases.ts) are read
 * by the editor on load AND by the server when an MCP client writes a
 * workflow. Each alias must point at a handle the node declares today, and
 * no "legacy" spelling may still be a declared handle (that would rewrite a
 * live id into another live id).
 *
 * Nodes with no creatable definition (edit-image, image-to-image — legacy,
 * superseded by modify-image) are skipped: their aliases serve saved graphs.
 */
/** Node types with aliases but no creatable definition: legacy image nodes, superseded by modify-image. */
const LEGACY_UNDEFINED_TYPES: ReadonlySet<string> = new Set(["edit-image", "image-to-image"])

function check(tables: Readonly<Record<string, Readonly<Record<string, string>>>>, side: "inputs" | "outputs") {
  const problems: string[] = []
  for (const [type, aliases] of Object.entries(tables)) {
    const def = NODE_DEF_MAP.get(type)
    if (!def) {
      if (!LEGACY_UNDEFINED_TYPES.has(type)) problems.push(`${type}: aliases for a node type with no definition (a misspelled key?)`)
      continue
    }
    const declared = new Set(def[side])
    for (const [legacy, canonical] of Object.entries(aliases)) {
      if (!declared.has(canonical)) problems.push(`${type}: alias ${legacy} → ${canonical}, but ${canonical} is not a declared ${side.slice(0, -1)}`)
      if (declared.has(legacy)) problems.push(`${type}: ${legacy} is still a declared ${side.slice(0, -1)} — not legacy`)
    }
  }
  return problems
}

describe("legacy handle aliases agree with NODE_DEFINITIONS", () => {
  it("every source alias lands on a declared output, and no legacy source id is still declared", () => {
    expect(check(LEGACY_SOURCE_HANDLE_ALIASES, "outputs")).toEqual([])
  })

  it("every target alias lands on a declared input, and no legacy target id is still declared", () => {
    expect(check(LEGACY_TARGET_HANDLE_ALIASES, "inputs")).toEqual([])
  })

  it("the helpers return the canonical id for a legacy spelling and the spelling itself otherwise", () => {
    expect(canonicalSourceHandle("telegram-channel-feed", "out")).toBe("text")
    expect(canonicalSourceHandle("telegram-channel-feed", "text")).toBe("text")
    expect(canonicalSourceHandle("telegram-trigger", "imageUrl")).toBe("out")
    expect(canonicalTargetHandle("combine-text", "in")).toBe("text")
    expect(canonicalTargetHandle("llm-chat", "prompt")).toBe("prompt")
    expect(canonicalTargetHandle("after-effects", "in")).toBe("video")
    // video-composer renders `in`; the table once sent its edges to a `video` pip it never had.
    expect(canonicalTargetHandle("video-composer", "video")).toBe("in")
    expect(canonicalSourceHandle(undefined, "out")).toBe("out")
  })
})
