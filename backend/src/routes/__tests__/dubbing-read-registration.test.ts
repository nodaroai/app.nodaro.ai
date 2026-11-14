// @test-watches backend/src/app.ts
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// buildApp() cannot boot in a unit test, so the registration is asserted as text, the
// idiom site-capture-registration.test.ts uses. The reads of a dub are core: the MCP
// tools that call them register in every edition, so the routes do too. The route's own
// tests register the plugin themselves and would stay green without this line.
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app.ts"), "utf8")

describe("app.ts registers the reads of a dub in every edition", () => {
  it("imports the route with the .js suffix", () => {
    expect(source).toContain('import { dubbingReadRoutes } from "./routes/dubbing-read.js"')
  })

  it("registers it once, on a line of its own at the top level, behind no switch", () => {
    expect(source.match(/app\.register\(dubbingReadRoutes\)/g) ?? []).toHaveLength(1)
    expect(source).toMatch(/^ {2}await app\.register\(dubbingReadRoutes\)\r?$/m)
  })
})

describe("app.ts registers adding a language to a dub in every edition", () => {
  it("imports the route with the .js suffix", () => {
    expect(source).toContain('import { dubbingLanguageRoutes } from "./routes/dubbing-languages.js"')
  })

  it("registers it once, on a line of its own at the top level, behind no switch", () => {
    expect(source.match(/app\.register\(dubbingLanguageRoutes\)/g) ?? []).toHaveLength(1)
    expect(source).toMatch(/^ {2}await app\.register\(dubbingLanguageRoutes\)\r?$/m)
  })
})
