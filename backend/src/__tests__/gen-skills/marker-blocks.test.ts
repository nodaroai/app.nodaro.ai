import { describe, it, expect } from "vitest"
import {
  parseMarkerBlocks,
  rewriteBlock,
} from "../../../scripts/lib/gen-skills/marker-blocks.js"

const SAMPLE = `# Title

Some prose before.

<!-- AUTO-GEN:START node-data-shape -->
old content here
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Prose between blocks.

<!-- AUTO-GEN:START examples -->
old example
<!-- AUTO-GEN:END examples -->

trailing prose
`

describe("parseMarkerBlocks", () => {
  it("identifies all marker blocks in document order", () => {
    const blocks = parseMarkerBlocks(SAMPLE)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.id).toBe("node-data-shape")
    expect(blocks[1]!.id).toBe("examples")
    expect(blocks[0]!.content).toBe("old content here")
    expect(blocks[1]!.content).toBe("old example")
  })

  it("returns empty array when no markers are present", () => {
    expect(parseMarkerBlocks("just prose, no markers")).toEqual([])
  })

  it("throws on a mismatched marker (START without END)", () => {
    expect(() =>
      parseMarkerBlocks("<!-- AUTO-GEN:START foo -->\ncontent\n"),
    ).toThrow(/unterminated/i)
  })
})

describe("rewriteBlock", () => {
  it("replaces a block's content while preserving everything else", () => {
    const out = rewriteBlock(SAMPLE, "node-data-shape", "NEW DATA SHAPE")
    expect(out).toContain("NEW DATA SHAPE")
    expect(out).not.toContain("old content here")
    expect(out).toContain("old example")
    expect(out).toContain("Prose between blocks.")
    expect(out).toContain("trailing prose")
  })

  it("preserves marker syntax exactly", () => {
    const out = rewriteBlock(SAMPLE, "node-data-shape", "X")
    expect(out).toContain("<!-- AUTO-GEN:START node-data-shape -->")
    expect(out).toContain("<!-- AUTO-GEN:END node-data-shape -->")
  })

  it("is a no-op when content matches existing block", () => {
    const out = rewriteBlock(SAMPLE, "node-data-shape", "old content here")
    expect(out).toBe(SAMPLE)
  })

  it("appends a new block at end-of-file when block doesn't exist", () => {
    const noMarkers = "# Heading\n\nprose\n"
    const out = rewriteBlock(noMarkers, "new-block", "fresh content")
    expect(out).toContain("<!-- AUTO-GEN:START new-block -->")
    expect(out).toContain("fresh content")
    expect(out).toContain("<!-- AUTO-GEN:END new-block -->")
    expect(out.startsWith(noMarkers)).toBe(true)
  })
})
