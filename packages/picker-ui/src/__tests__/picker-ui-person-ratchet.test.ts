// Ratchet: person picker-ui files must read the registered person set, not raw
// PEOPLE. Substring pre-filter + time ceiling (spec §3 finding 5).
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const PICKERS = join(dirname(fileURLToPath(import.meta.url)), "..", "pickers")
// Files still allowed to import raw PEOPLE (non-person or already-registered).
const ALLOW = new Set<string>([]) // person paths must NOT be here after Task 12
describe("person picker-ui reads registered set", () => {
  it("no person picker file imports raw PEOPLE", () => {
    const start = Date.now()
    const offenders = readdirSync(PICKERS)
      .filter((f) => f.startsWith("person") && f.endsWith(".tsx"))
      .filter((f) =>
        /import\s*\{[^}]*\bPEOPLE\b[^}]*\}\s*from\s*["']@nodaro\/prompts["']/.test(readFileSync(join(PICKERS, f), "utf8")),
      )
      .filter((f) => !ALLOW.has(f))
    expect(offenders, `person picker(s) still import raw PEOPLE: ${offenders.join(", ")}`).toEqual([])
    expect(Date.now() - start).toBeLessThan(4000)
  })
})
