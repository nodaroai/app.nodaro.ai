// @vitest-environment node
// @test-watches frontend/src/ee/layouts/admin-layout.tsx frontend/src/router.tsx
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Admin → Remake faults is reachable: the sidebar has its entry and the
 * router its page, lazily, inside the admin block — only where credits exist,
 * like the API behind it (registered under hasAdmin() && hasCredits()).
 */
const SRC = join(__dirname, "..", "..", "..", "..", "..", "..")
const LAYOUT = readFileSync(join(SRC, "ee", "layouts", "admin-layout.tsx"), "utf8")
const ROUTER = readFileSync(join(SRC, "router.tsx"), "utf8")

describe("Admin → Remake faults registration", () => {
  it("has its entry in the admin nav right after the Video Remake price check, only where credits exist", () => {
    const priceCheck = `...(hasCredits() ? [{ href: "/admin/motion-price-check", label: "Video Remake price check", icon: Receipt }] : []),`
    const entry = `...(hasCredits() ? [{ href: "/admin/remake-faults", label: "Video Remake faults", icon: OctagonAlert }] : []),`
    expect(LAYOUT).toContain(entry)
    expect(LAYOUT.slice(LAYOUT.indexOf(priceCheck) + priceCheck.length).trimStart().startsWith(entry)).toBe(true)
  })

  it("routes the page lazily, inside the admin block's credits-only part", () => {
    expect(ROUTER).toContain(`const AdminRemakeFaults = lazy(() => import("@/ee/app/(admin)/admin/remake-faults/page"))`)
    const block = ROUTER.slice(ROUTER.indexOf("const adminRoutes"), ROUTER.indexOf("const communityRoutes"))
    const at = block.indexOf(`{ path: "remake-faults", element: <SuspenseWrapper><AdminRemakeFaults /></SuspenseWrapper> }`)
    expect(at).toBeGreaterThan(-1)
    const credits = block.lastIndexOf("...(hasCredits()", at)
    expect(credits).toBeGreaterThan(-1)
    expect(block.slice(credits, at)).not.toContain(": []),")
  })
})
