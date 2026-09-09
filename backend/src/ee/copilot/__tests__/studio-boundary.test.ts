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

/**
 * The SCOPE this tree may not reach into, never written whole.
 *
 * The scope, not one package under it. The document's model and the routes that
 * serve it are published side by side under the same private scope, and the rule
 * is about all of them: an import of the document model would be the same
 * mistake as an import of the routes, and naming only one of them would let the
 * other in on the day it is reached for — which is exactly the day this test
 * exists for.
 */
const FORBIDDEN_SCOPE = ["@nodaro", "ai/"].join("")
/** The one package under it whose NAME must also not appear in prose. */
const FORBIDDEN_PACKAGE = [FORBIDDEN_SCOPE, "cloud", "-plugins"].join("")

/**
 * The copilot's studio files — every one of them, and their existence is
 * asserted, so a file renamed out from under this list fails here instead of
 * quietly dropping out of the rule.
 */
const STUDIO_FILES = [
  "surfaces.ts",
  "studio-skill.ts",
  "doctrine.ts",
  "studio-preamble.ts",
  "tools/studio-dispatch.ts",
]

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
    for (const file of STUDIO_FILES) {
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
      expect(source.includes(FORBIDDEN_PACKAGE), `${relative(COPILOT_DIR, file)} names it`).toBe(false)
    }
  })

  it("imports nothing from the private scope — no package under it, not one", () => {
    for (const file of ALL_FILES) {
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        expect(spec.startsWith(FORBIDDEN_SCOPE), `${relative(COPILOT_DIR, file)} imports ${spec}`).toBe(false)
      }
    }
  })
})
