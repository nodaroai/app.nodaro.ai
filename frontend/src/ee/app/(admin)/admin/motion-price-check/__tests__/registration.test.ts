// @vitest-environment node
// @test-watches frontend/src/ee/layouts/admin-layout.tsx frontend/src/router.tsx
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Admin → Motion price check is reachable: the sidebar has its entry and the
 * router its page, lazily, inside the admin block — only where credits exist,
 * like the API behind it (registered under hasAdmin() && hasCredits()).
 */
const SRC = join(__dirname, "..", "..", "..", "..", "..", "..")
const LAYOUT = readFileSync(join(SRC, "ee", "layouts", "admin-layout.tsx"), "utf8")
const ROUTER = readFileSync(join(SRC, "router.tsx"), "utf8")

describe("Admin → Motion price check registration", () => {
  it("has its entry in the admin nav right after Nodaro Motion, only where credits exist", () => {
    const motion = `...(hasCredits() ? [{ href: "/admin/nodaro-motion", label: "Nodaro Motion", icon: Clapperboard }] : []),`
    const entry = `...(hasCredits() ? [{ href: "/admin/motion-price-check", label: "Motion price check", icon: Receipt }] : []),`
    expect(LAYOUT).toContain(entry)
    expect(LAYOUT.slice(LAYOUT.indexOf(motion) + motion.length).trimStart().startsWith(entry)).toBe(true)
  })

  it("routes the page lazily, inside the admin block's credits-only part", () => {
    expect(ROUTER).toContain(`const AdminMotionPriceCheck = lazy(() => import("@/ee/app/(admin)/admin/motion-price-check/page"))`)
    const block = ROUTER.slice(ROUTER.indexOf("const adminRoutes"), ROUTER.indexOf("const communityRoutes"))
    const at = block.indexOf(`{ path: "motion-price-check", element: <SuspenseWrapper><AdminMotionPriceCheck /></SuspenseWrapper> }`)
    expect(at).toBeGreaterThan(-1)
    const credits = block.lastIndexOf("...(hasCredits()", at)
    expect(credits).toBeGreaterThan(-1)
    // Still inside that spread: no closing `: []),` between it and the route.
    expect(block.slice(credits, at)).not.toContain(": []),")
  })
})
