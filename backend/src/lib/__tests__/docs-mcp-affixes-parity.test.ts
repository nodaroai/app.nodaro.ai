/**
 * Docs parity for the MCP surface of prompt pre/post text (spec §8 "Surfaces").
 *
 * Two invariants, both derived from source rather than a hand-kept list — a new
 * verb that starts composing affixes, or a renamed CLI subcommand, fails here
 * instead of silently rotting the public docs:
 *
 *  1. Every MCP verb whose handler calls `readPromptAffixes` must say so in its
 *     `docs/mcp/tools.md` row AND be named in the "Presets" bullet of
 *     `docs/prompt-pre-post-text.md`.
 *  2. Every `nodaro nodes <sub>` written in docs/ or CLAUDE.md must be a real
 *     subcommand of the CLI's `nodes` command.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
const VERBS_DIR = join(REPO_ROOT, "backend/src/lib/mcp/tools")
const TOOLS_DOC = join(REPO_ROOT, "docs/mcp/tools.md")
const AFFIX_DOC = join(REPO_ROOT, "docs/prompt-pre-post-text.md")
const CLI_NODES = join(REPO_ROOT, "packages/cli/src/commands/nodes.ts")

/** Every `.md` under a directory, recursively. */
function walkMarkdown(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walkMarkdown(p))
    else if (entry.endsWith(".md")) out.push(p)
  }
  return out
}

/**
 * Map every `readPromptAffixes(` call site in the verb files to the tool it sits
 * in — the nearest preceding `server.registerTool(\n  "<name>"`.
 */
function affixComposingVerbs(): string[] {
  const found = new Set<string>()
  for (const file of readdirSync(VERBS_DIR).filter((f) => /^verbs-.*\.ts$/.test(f))) {
    const src = readFileSync(join(VERBS_DIR, file), "utf8")
    const registrations: { index: number; name: string }[] = []
    for (const m of src.matchAll(/registerTool\(\s*\n\s*"([a-z0-9_]+)"/g)) {
      registrations.push({ index: m.index, name: m[1]! })
    }
    for (const site of src.matchAll(/readPromptAffixes\(/g)) {
      const owner = [...registrations].reverse().find((r) => r.index < site.index)
      if (owner) found.add(owner.name)
    }
  }
  return [...found].sort()
}

const VERBS = affixComposingVerbs()
const toolsDoc = readFileSync(TOOLS_DOC, "utf8")
const affixDoc = readFileSync(AFFIX_DOC, "utf8")

describe("docs: MCP verbs that compose preset prompt affixes", () => {
  it("detects the affix-composing verbs from source", () => {
    // Sanity floor: keeps the derived assertions below from passing vacuously
    // if the detection regex ever stops matching.
    expect(VERBS).toEqual(
      expect.arrayContaining([
        "generate_image",
        "generate_music",
        "generate_speech",
        "generate_video",
        "text_to_audio",
      ]),
    )
  })

  for (const verb of VERBS) {
    it(`docs/mcp/tools.md documents affix composition for ${verb}`, () => {
      const rows = toolsDoc
        .split("\n")
        .filter((l) => new RegExp("^\\|\\s*`" + verb + "`\\s*\\|").test(l))
      expect(rows.length, `no tools.md table row for ${verb}`).toBeGreaterThan(0)
      const documented = rows.some((r) => r.includes("promptPrefix") && r.includes("promptSuffix"))
      expect(documented, `${verb} row must mention promptPrefix / promptSuffix`).toBe(true)
    })
  }

  it("the Presets bullet in prompt-pre-post-text.md names every affix-composing verb", () => {
    const bullet = affixDoc
      .split(/\n(?=- )/)
      .find((b) => b.includes("presetId") && b.includes("MCP"))
    expect(bullet, "no Presets bullet mentioning presetId found").toBeDefined()
    for (const verb of VERBS) {
      expect(bullet, `Presets bullet must name ${verb}`).toContain(`\`${verb}\``)
    }
  })
})

describe("docs: `nodaro nodes` subcommands are real", () => {
  const subcommands = new Set(
    [...readFileSync(CLI_NODES, "utf8").matchAll(/\.command\(\s*"([a-z-]+)/g)].map((m) => m[1]!),
  )

  it("parses the CLI subcommands", () => {
    expect(subcommands.has("get")).toBe(true)
    expect(subcommands.has("describe")).toBe(false)
  })

  const files = [...walkMarkdown(join(REPO_ROOT, "docs")), join(REPO_ROOT, "CLAUDE.md")]
  for (const file of files) {
    const refs = [...readFileSync(file, "utf8").matchAll(/nodaro nodes ([a-z-]+)/g)].map(
      (m) => m[1]!,
    )
    if (refs.length === 0) continue
    it(`${file.slice(REPO_ROOT.length + 1)} references only real subcommands`, () => {
      for (const ref of refs) {
        expect(subcommands.has(ref), `\`nodaro nodes ${ref}\` is not a CLI subcommand`).toBe(true)
      }
    })
  }
})
