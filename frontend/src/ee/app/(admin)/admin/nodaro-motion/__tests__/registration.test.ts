// @vitest-environment node
// @test-watches frontend/src/ee/layouts/admin-layout.tsx frontend/src/router.tsx
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Admin → Nodaro Motion is reachable: the sidebar has its entry and the router
 * its page, lazily, inside the admin block — only where credits exist, like
 * the API behind it (registered under hasAdmin() && hasCredits()).
 */
const SRC = join(__dirname, "..", "..", "..", "..", "..", "..")
const LAYOUT = readFileSync(join(SRC, "ee", "layouts", "admin-layout.tsx"), "utf8")
const ROUTER = readFileSync(join(SRC, "router.tsx"), "utf8")

describe("Admin → Nodaro Motion registration", () => {
  it("has a Nodaro Motion entry in the admin nav, only where credits exist", () => {
    expect(LAYOUT).toContain(`...(hasCredits() ? [{ href: "/admin/nodaro-motion", label: "Nodaro Motion", icon: Clapperboard }] : []),`)
  })

  it("routes the page lazily, inside the admin block's credits-only part", () => {
    expect(ROUTER).toContain(`const AdminNodaroMotion = lazy(() => import("@/ee/app/(admin)/admin/nodaro-motion/page"))`)
    const block = ROUTER.slice(ROUTER.indexOf("const adminRoutes"), ROUTER.indexOf("const communityRoutes"))
    const at = block.indexOf(`{ path: "nodaro-motion", element: <SuspenseWrapper><AdminNodaroMotion /></SuspenseWrapper> }`)
    expect(at).toBeGreaterThan(-1)
    const credits = block.lastIndexOf("...(hasCredits()", at)
    expect(credits).toBeGreaterThan(-1)
    // Still inside that spread: no closing `: []),` between it and the route.
    expect(block.slice(credits, at)).not.toContain(": []),")
  })
})
