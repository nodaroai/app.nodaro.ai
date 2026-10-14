import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { TRANSCRIBE_PROVIDERS, TRANSCRIBE_PROVIDER_CAPABILITIES } from "@nodaro/shared/models"

/**
 * `backend/skills/nodes/transcribe.md` is what `get_node_skill` serves, and the
 * only place an MCP caller learns which engine returns word timings. It said
 * `elevenlabs-stt` was "the only enabled engine" and that whisper could no
 * longer be named — both went false when `/v1/transcribe` widened its enum to
 * all three lanes.
 *
 * Derived from the shared capability table rather than a hand-written list, so
 * a fourth engine fails this test instead of quietly shipping undocumented.
 */
const here = dirname(fileURLToPath(import.meta.url))
const SKILL = readFileSync(resolve(here, "../../../../skills/nodes/transcribe.md"), "utf8")

describe("the transcribe skill describes every accepted engine", () => {
  it.each(TRANSCRIBE_PROVIDERS)("names %s", (provider) => {
    expect(SKILL).toContain(`\`${provider}\``)
  })

  it("says, for each engine, whether it returns word timings", () => {
    for (const provider of TRANSCRIBE_PROVIDERS) {
      const capable = TRANSCRIBE_PROVIDER_CAPABILITIES[provider].wordTimestamps
      // The engines table has one row per lane: `| \`<id>\` … | **yes**/**no** |
      const row = SKILL.split("\n").find((l) => l.startsWith(`| \`${provider}\``))
      expect(row, `no engines-table row for ${provider}`).toBeDefined()
      expect(row, `${provider} row must state word timings = ${capable}`).toContain(
        capable ? "**yes**" : "**no**",
      )
    }
  })

  it("states that a word-less transcript feeding captions is refused before the run", () => {
    expect(SKILL).toMatch(/refused before the workflow runs/i)
    expect(SKILL).toMatch(/`add-captions` `transcript` input/)
    expect(SKILL).toMatch(/apply-edl/)
  })

  it("keeps the two claims that went false out of the file", () => {
    expect(SKILL).not.toMatch(/the only enabled engine/)
    expect(SKILL).not.toMatch(/no longer lets a caller name/)
  })

  it("still says the MCP tool itself always runs the word-level engine", () => {
    expect(SKILL).toMatch(/MCP `transcribe` tool ALWAYS runs/)
  })
})
