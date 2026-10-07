import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// buildApp() cannot boot in a unit test, so the registration condition is asserted as
// text — the idiom require-deployment-payer.test.ts uses. The live proof that the route
// is registered by default is the community smoke contract against the real image.
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app.ts"), "utf8")

describe("app.ts registers Site Capture behind its switch only", () => {
  it("imports the route with the .js suffix", () => {
    expect(source).toContain('import { siteCaptureRoutes } from "./routes/site-capture.js"')
  })
  it("registers it once, under siteCaptureEnabled(), outside any hasCredits() gate", () => {
    expect(source).toContain("if (siteCaptureEnabled()) await app.register(siteCaptureRoutes)")
    expect(source.match(/app\.register\(siteCaptureRoutes\)/g) ?? []).toHaveLength(1)
    expect(source).not.toMatch(/hasCredits\(\)[^\n]*siteCaptureRoutes/)
  })
})
