/**
 * The public node index and the MCP node skill must say what the pricing flags
 * say (C4 review round). Both are hand-written prose — `gen:skills:check` only
 * covers the AUTO-GEN blocks — and C4 shipped a Speaker Frames row with Speaker
 * View's price and a skill that still told agents Speaker View cannot run.
 *
 * A node whose `*_PRICED` flag is off is "not priced yet" in its README row and
 * names no price there; a priced node says neither "not priced yet" in its row
 * nor in its skill.
 */
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { SPEAKER_FRAMES_PRICED, SPEAKER_VIEW_PRICED } from "@nodaro/render-rules"

// REPO_ROOT: backend/src/__tests__/ → up 3 → repo root
const REPO_ROOT = join(__dirname, "..", "..", "..")
const README = readFileSync(join(REPO_ROOT, "docs/nodes/README.md"), "utf8")

const NODES = [
  { type: "speaker-view", title: "Speaker View", priced: SPEAKER_VIEW_PRICED },
  { type: "speaker-frames", title: "Speaker Frames", priced: SPEAKER_FRAMES_PRICED },
] as const

const rowOf = (title: string): string => {
  const rows = README.split("\n").filter((line) => line.startsWith(`| [${title}](`))
  expect(rows, `docs/nodes/README.md has one "${title}" row`).toHaveLength(1)
  return rows[0]!
}

describe("pricing prose follows the *_PRICED flags", () => {
  it.each(NODES)("$title: the README row", ({ title, priced }) => {
    const row = rowOf(title)
    if (priced) {
      expect(row).not.toMatch(/not priced yet/i)
      expect(row).toMatch(/\bCR\b|credits?/i)
    } else {
      expect(row).toMatch(/not priced yet/i)
      expect(row).not.toMatch(/\d+\s*CR\b|per output minute/i)
    }
  })

  it.each(NODES)("$title: the MCP node skill", ({ type, priced }) => {
    const path = join(REPO_ROOT, "backend/skills/nodes", `${type}.md`)
    if (!existsSync(path)) return
    const skill = readFileSync(path, "utf8")
    if (priced) expect(skill).not.toMatch(/not priced yet|cannot be run|none declared/i)
  })
})
