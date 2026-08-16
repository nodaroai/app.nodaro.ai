/**
 * Every environment variable `config.ts` reads must be documented in
 * docs/deployment.md — the "Every backend variable — reference" table.
 *
 * Release check 43 (2026-08-16) found 17 of 45 variables undocumented; a
 * self-hoster reading the deployment guide had no way to learn they existed.
 * This turns "remember to add a row" into a build failure. Mentioning the
 * name anywhere in the doc counts (a row, an example block, a paragraph).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const CONFIG = resolve(here, "..", "config.ts")
const DOC = resolve(here, "..", "..", "..", "..", "docs", "deployment.md")

describe("docs/deployment.md documents every config.ts variable", () => {
  it("names every top-level key of the config schema", () => {
    const src = readFileSync(CONFIG, "utf8")
    const keys = [...src.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*z\b/gm)].map((m) => m[1])
    expect(keys.length).toBeGreaterThan(30) // the scan must not go blind
    const doc = readFileSync(DOC, "utf8")
    const missing = keys.filter((k) => !new RegExp(`(^|[^A-Z_])${k}([^A-Z_]|$)`, "m").test(doc))
    expect(missing, `config.ts variables with no mention in docs/deployment.md: ${missing.join(", ")}`).toEqual([])
  })
})
