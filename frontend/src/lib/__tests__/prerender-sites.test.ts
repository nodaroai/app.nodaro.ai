// @test-watches frontend/src/layouts/dashboard-layout.tsx frontend/src/hooks/use-auth.ts frontend/index.html
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The app may be prerendered by another Nodaro surface (Caddyfile:
 * Supports-Loading-Mode). The one-shot actions that count a real visit or move
 * the visitor wait for activation; plain data fetches may run in a prerender.
 */

const FRONTEND = join(__dirname, "..", "..", "..")
const read = (path: string) => readFileSync(join(FRONTEND, path), "utf8")

describe("one-shot actions wait for activation", () => {
  it("the pending-plan redirect after sign-in (dashboard layout)", () => {
    const src = read("src/layouts/dashboard-layout.tsx")
    expect(src).toMatch(/import \{ whenActivated \} from "@\/lib\/prerender"/)
    expect(src).toMatch(/whenActivated\(\(\) => \{[\s\S]{0,400}nodaro_pending_plan/)
  })

  it("the signup-grant claim (auth boot)", () => {
    const src = read("src/hooks/use-auth.ts")
    expect(src).toMatch(/import \{ whenActivated \} from "@\/lib\/prerender"/)
    expect(src).toMatch(/function maybeClaimSignupGrant\(userId: string\): void \{\s*if \(!hasCredits\(\)\) return\s*(?:\/\/[^\n]*\n\s*)*whenActivated\(/)
  })

  it("the analytics snippet (index.html) starts only once the page is shown", () => {
    const html = read("index.html")
    expect(html).toMatch(/document\.prerendering[\s\S]{0,200}prerenderingchange/)
  })
})
