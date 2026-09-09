/**
 * The boundary this part of the tree may not cross.
 *
 * The studio production document has ONE owner, and it is not the copilot: the
 * copilot reads a summary and previews a change through the studio production
 * routes, and everything it wants to change it proposes. Structurally that
 * means this directory neither depends on the package that models the document
 * nor borrows any of its internals — the routes and the tools are the whole
 * contract.
 *
 * The needle is assembled at runtime from two halves, so this file does not
 * itself become the first thing a scan for it finds.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const COPILOT_DIR = resolve(here, "..")

/** The package prefix this tree may not name, never written whole. */
const FORBIDDEN_PREFIX = ["@nodaro", "ai/", "cloud", "-plugins"].join("")

/** The copilot's studio files. The first three are this surface's own. */
const STUDIO_FILES = ["surfaces.ts", "studio-skill.ts", "doctrine.ts"]
/** Later lanes add these; each is checked as soon as it exists. */
const STUDIO_FILES_WHEN_PRESENT = ["studio-preamble.ts", "tools/studio-dispatch.ts"]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return full.endsWith(".ts") ? [full] : []
  })
}

const ALL_FILES = walk(COPILOT_DIR)

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
}

describe("the studio copilot files", () => {
  it("exist — the rule below is not vacuous", () => {
    for (const file of STUDIO_FILES) {
      expect(() => statSync(join(COPILOT_DIR, file)), `${file} is missing`).not.toThrow()
    }
  })

  it("reach into the tool tree for the family's shared helpers only", () => {
    const checked = [...STUDIO_FILES, ...STUDIO_FILES_WHEN_PRESENT].filter((file) => {
      try {
        return statSync(join(COPILOT_DIR, file)).isFile()
      } catch {
        return false
      }
    })
    for (const file of checked) {
      const source = readFileSync(join(COPILOT_DIR, file), "utf8")
      const reaches = importSpecifiers(source).filter((spec) => spec.includes("lib/mcp/tools/"))
      for (const spec of reaches) {
        expect(spec, `${file} imports ${spec}`).toMatch(/_studio-helpers\.js$/)
      }
    }
  })
})

describe("the copilot directory", () => {
  it("names the private package nowhere", () => {
    for (const file of ALL_FILES) {
      const source = readFileSync(file, "utf8")
      expect(source.includes(FORBIDDEN_PREFIX), `${relative(COPILOT_DIR, file)} names it`).toBe(false)
    }
  })

  it("imports no module from it", () => {
    for (const file of ALL_FILES) {
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        expect(spec.startsWith(FORBIDDEN_PREFIX), `${relative(COPILOT_DIR, file)} imports ${spec}`).toBe(false)
      }
    }
  })
})
