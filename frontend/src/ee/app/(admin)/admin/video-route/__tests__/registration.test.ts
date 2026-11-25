// @vitest-environment node
// @test-watches frontend/src/ee/layouts/admin-layout.tsx frontend/src/router.tsx frontend/src/lib/surface-nav-registry.ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/** Admin → Video route is reachable: the sidebar has its entry (Cloud only) and the router its page, lazily, inside the admin block. */
const SRC = join(__dirname, "..", "..", "..", "..", "..", "..")
const LAYOUT = readFileSync(join(SRC, "ee", "layouts", "admin-layout.tsx"), "utf8")
const ROUTER = readFileSync(join(SRC, "router.tsx"), "utf8")
const REGISTRY = readFileSync(join(SRC, "lib", "surface-nav-registry.ts"), "utf8")

describe("Admin → Video route registration", () => {
  it("has its entry in the admin nav, where credits exist", () => {
    expect(LAYOUT).toContain(`...(hasCredits() ? [{ href: "/admin/video-route", label: "Video Route", icon: Route }] : []),`)
  })

  it("routes the page lazily, inside the admin block", () => {
    expect(ROUTER).toContain(`const AdminVideoRoute = lazy(() => import("@/ee/app/(admin)/admin/video-route/page"))`)
    const block = ROUTER.slice(ROUTER.indexOf("const adminRoutes"), ROUTER.indexOf("const communityRoutes"))
    expect(block).toContain(`{ path: "video-route", element: <SuspenseWrapper><AdminVideoRoute /></SuspenseWrapper> }`)
  })

  it("is listed in the surface registry", () => {
    expect(REGISTRY).toContain(`"video-route"`)
  })
})
