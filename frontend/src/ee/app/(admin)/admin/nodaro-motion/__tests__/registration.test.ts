// @vitest-environment node
// @test-watches frontend/src/ee/layouts/admin-layout.tsx frontend/src/router.tsx
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Admin → Video Remake is reachable: the sidebar has its entry and the router
 * its page, lazily, inside the admin block — only where credits exist, like
 * the API behind it (registered under hasAdmin() && hasCredits()).
 */
const SRC = join(__dirname, "..", "..", "..", "..", "..", "..")
const LAYOUT = readFileSync(join(SRC, "ee", "layouts", "admin-layout.tsx"), "utf8")
const ROUTER = readFileSync(join(SRC, "router.tsx"), "utf8")

describe("Admin → Video Remake registration", () => {
  it("has a Video Remake entry in the admin nav, only where credits exist", () => {
    expect(LAYOUT).toContain(`...(hasCredits() ? [{ href: "/admin/video-remake", label: "Video Remake", icon: Clapperboard }] : []),`)
  })

  it("routes the page lazily, inside the admin block's credits-only part", () => {
    expect(ROUTER).toContain(`const AdminNodaroMotion = lazy(() => import("@/ee/app/(admin)/admin/nodaro-motion/page"))`)
    const block = ROUTER.slice(ROUTER.indexOf("const adminRoutes"), ROUTER.indexOf("const communityRoutes"))
    const at = block.indexOf(`{ path: "video-remake", element: <SuspenseWrapper><AdminNodaroMotion /></SuspenseWrapper> }`)
    expect(at).toBeGreaterThan(-1)
    const credits = block.lastIndexOf("...(hasCredits()", at)
    expect(credits).toBeGreaterThan(-1)
    // Still inside that spread: no closing `: []),` between it and the route.
    expect(block.slice(credits, at)).not.toContain(": []),")
  })

  it("sends the page's former address to it", () => {
    expect(ROUTER).toContain(`{ path: "nodaro-motion", element: <Navigate to="/admin/video-remake" replace /> }`)
  })
})
