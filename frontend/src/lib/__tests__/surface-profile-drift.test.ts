import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The frontend and backend SurfaceProfile shapes are two hand-kept copies
 * (cloud-only-nodes.ts precedent). This guard extracts the top-level key set of
 * each SURFACE_PROFILE_DEFAULT literal and asserts they match, so a field added
 * on one side and forgotten on the other fails CI. Substring pre-filter + a
 * cheap single-file read keep it well under the vitest ceiling.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const FE = resolve(HERE, "..", "surface-profile.ts")
const BE = resolve(HERE, "..", "..", "..", "..", "backend", "src", "lib", "surface-profile.ts")

function defaultKeys(src: string): string[] {
  const start = src.indexOf("SURFACE_PROFILE_DEFAULT")
  expect(start, "SURFACE_PROFILE_DEFAULT literal must be present").toBeGreaterThan(-1)
  const brace = src.indexOf("{", start)
  // capture top-level keys of the literal (depth-1 identifiers before ':')
  let depth = 0
  const keys: string[] = []
  for (let i = brace; i < src.length; i++) {
    const c = src[i]
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) break
    } else if (depth === 1) {
      const m = /^\s*([a-zA-Z_]+)\s*:/.exec(src.slice(i, src.indexOf("\n", i) + 1 || undefined))
      if (m && !keys.includes(m[1])) keys.push(m[1])
    }
  }
  return keys.sort()
}

describe("surface-profile drift", () => {
  it("frontend and backend SURFACE_PROFILE_DEFAULT expose the same top-level keys", () => {
    const fe = defaultKeys(readFileSync(FE, "utf8"))
    const be = defaultKeys(readFileSync(BE, "utf8"))
    expect(fe).toEqual(be)
  })
})
