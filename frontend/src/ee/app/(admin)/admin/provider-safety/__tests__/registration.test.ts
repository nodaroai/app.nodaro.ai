// @vitest-environment node
// @test-watches frontend/src/ee/layouts/admin-layout.tsx frontend/src/router.tsx frontend/src/lib/surface-nav-registry.ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/** Admin → Provider safety is reachable: the sidebar has its entry and the router its page, lazily, inside the admin block. */
const SRC = join(__dirname, "..", "..", "..", "..", "..", "..")
const LAYOUT = readFileSync(join(SRC, "ee", "layouts", "admin-layout.tsx"), "utf8")
const ROUTER = readFileSync(join(SRC, "router.tsx"), "utf8")
const REGISTRY = readFileSync(join(SRC, "lib", "surface-nav-registry.ts"), "utf8")

describe("Admin → Provider safety registration", () => {
  it("has its entry in the admin nav", () => {
    expect(LAYOUT).toContain(`{ href: "/admin/provider-safety", label: "Provider Safety", icon: ShieldCheck }`)
  })

  it("routes the page lazily, inside the admin block", () => {
    expect(ROUTER).toContain(`const AdminProviderSafety = lazy(() => import("@/ee/app/(admin)/admin/provider-safety/page"))`)
    const block = ROUTER.slice(ROUTER.indexOf("const adminRoutes"), ROUTER.indexOf("const communityRoutes"))
    expect(block).toContain(`{ path: "provider-safety", element: <SuspenseWrapper><AdminProviderSafety /></SuspenseWrapper> }`)
  })

  it("is listed in the surface registry", () => {
    expect(REGISTRY).toContain(`"provider-safety"`)
  })
})
