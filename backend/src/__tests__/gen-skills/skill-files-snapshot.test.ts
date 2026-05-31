import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const SKILLS_DIR = resolve(__dirname, "../../../skills/nodes")

describe("per-node skill file snapshots", () => {
  const representativeTypes = [
    "generate-image",
    "image-to-video",
    // Unified video node — pinned alongside i2v so its auto-gen blocks are
    // checked on every run. Drift on the data-shape / mcp-call / examples
    // sections gets caught even though it isn't in NODE_TYPE_TO_TOOL.
    "generate-video",
    "generate-music",
    "trim-video",
  ]
  for (const type of representativeTypes) {
    it(`${type}.md auto-gen blocks match snapshot`, () => {
      const content = readFileSync(resolve(SKILLS_DIR, `${type}.md`), "utf-8")
      const blocks: Record<string, string> = {}
      const re = /<!--\s*AUTO-GEN:START\s+([a-z0-9-]+)\s*-->\n([\s\S]*?)\n<!--\s*AUTO-GEN:END\s+\1\s*-->/g
      const matches = content.matchAll(re)
      for (const m of matches) blocks[m[1]!] = m[2]!
      expect(blocks).toMatchSnapshot()
    })
  }
})
