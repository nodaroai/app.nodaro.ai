import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// Cheap source-level guard: every field-* id must appear in BOTH the handles
// array and the HandleWithPopover JSX block of the suno node (the two places a
// pip must be declared; nothing else asserts they agree).
//
// Path resolution note: the same-directory `media-node-sizing.test.ts` pattern
// (`dirname(fileURLToPath(import.meta.url))`) is used instead of
// `new URL("../suno-generate-node.tsx", import.meta.url)`. Vite's compile-time
// asset-URL transform rewrites `new URL("<string literal>", import.meta.url)`
// to the dev-server origin (http://localhost:3000/...), which then fails
// `fileURLToPath` with "URL must be of scheme file". Resolving via the
// directory name avoids that transform entirely.
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "suno-generate-node.tsx"),
  "utf8",
)
describe("suno-generate handle declarations stay in sync", () => {
  for (const id of ["field-style", "field-lyrics", "field-title", "field-negativeStyle"]) {
    it(`${id} appears at least twice (array + JSX)`, () => {
      const count = src.split(`"${id}"`).length - 1
      expect(count).toBeGreaterThanOrEqual(2)
    })
  }
})
