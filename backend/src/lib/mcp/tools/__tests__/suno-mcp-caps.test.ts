/**
 * The Suno MCP tools must not advertise a cap tighter than the routes accept.
 * suno_generate / suno_cover / suno_replace_section / suno_style_boost capped
 * their text fields at 3000 while the matching routes clamp at the per-version
 * cap (5000 for V4.5+/V5), so an agent's 4000-char lyric was rejected at the
 * tool boundary instead of trimmed at the route.
 *
 * Asserted as "zero `.max(3000)` survive in this file": on 2026-09-02 all six
 * occurrences were such a field, and generate_music's deliberate pair uses
 * `.max(2000)`, so the bound is unambiguous and cannot be satisfied by
 * weakening a pattern. A NEW `.max(3000)` here is either the same defect or a
 * deliberate cap that needs a documented exemption.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SUNO_TEXT_MAX } from "@nodaro/shared"

const SRC = readFileSync(join(__dirname, "..", "verbs-audio.ts"), "utf8")
const LINES = SRC.split("\n")

describe("Suno MCP text caps", () => {
  it("no tool schema in verbs-audio.ts hardcodes a 3000-char text bound", () => {
    const offenders = LINES
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter((r) => r.line.includes(".max(3000)"))
    expect(
      offenders,
      "every .max(3000) here is a Suno text field whose route clamps at the per-version cap — raise it to SUNO_TEXT_MAX",
    ).toEqual([])
  })

  it("the six Suno text fields use the shared SUNO_TEXT_MAX symbol", () => {
    expect(SUNO_TEXT_MAX).toBe(5000)
    // suno_cover prompt + lyrics, suno_generate prompt + lyrics,
    // suno_replace_section prompt, suno_style_boost content.
    expect(LINES.filter((l) => l.includes(".max(SUNO_TEXT_MAX)")).length).toBe(6)
  })

  it("leaves generate_music's deliberate 2000 cap alone", () => {
    expect(LINES.filter((l) => l.includes(".max(2000)")).length).toBeGreaterThanOrEqual(2)
  })
})
