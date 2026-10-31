// @vitest-environment node
// @test-watches frontend/src/ee/layouts/admin-layout.tsx frontend/src/router.tsx frontend/src/lib/surface-nav-registry.ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Admin → Live usage is reachable in every edition with an admin, like the
 * routes behind it: the sidebar has its entry and the router its page, lazily,
 * inside the admin block but outside its credits-only part.
 */
const SRC = join(__dirname, "..", "..", "..", "..", "..", "..")
const LAYOUT = readFileSync(join(SRC, "ee", "layouts", "admin-layout.tsx"), "utf8")
const ROUTER = readFileSync(join(SRC, "router.tsx"), "utf8")
const REGISTRY = readFileSync(join(SRC, "lib", "surface-nav-registry.ts"), "utf8")

describe("Admin → Live usage registration", () => {
  it("has a Live usage entry in the admin nav, in every edition with an admin", () => {
    expect(LAYOUT).toContain(`  { href: "/admin/live-usage", label: "Live usage", icon: Gauge },\n`)
  })

  it("routes the page lazily inside the admin block, not behind credits", () => {
    expect(ROUTER).toContain(`const AdminLiveUsage = lazy(() => import("@/ee/app/(admin)/admin/live-usage/page"))`)
    const block = ROUTER.slice(ROUTER.indexOf("const adminRoutes"), ROUTER.indexOf("const communityRoutes"))
    const at = block.indexOf(`{ path: "live-usage", element: <SuspenseWrapper><AdminLiveUsage /></SuspenseWrapper> }`)
    expect(at).toBeGreaterThan(-1)
    const credits = block.lastIndexOf("...(hasCredits()", at)
    // Either no credits spread before it, or that spread closed before the route.
    if (credits > -1) expect(block.slice(credits, at)).toContain(": []),")
  })

  it("is classified as an admin child in the surface registry", () => {
    expect(REGISTRY).toContain(`  "live-usage",\n`)
  })
})
