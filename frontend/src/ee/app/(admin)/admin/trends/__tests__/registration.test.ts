// @vitest-environment node
// @test-watches frontend/src/ee/layouts/admin-layout.tsx frontend/src/router.tsx
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Admin → Trends is reachable: the sidebar has its entry, and the router has
 * the list and the editor, lazily, inside the `hasAdmin()` block — both only
 * where credits exist, like the API behind them. A source
 * guard, like `admin-layout-frame.test.ts`: rendering the whole router or the
 * layout would prove less while breaking more often.
 */
const SRC = join(__dirname, "..", "..", "..", "..", "..", "..")
const LAYOUT = readFileSync(join(SRC, "ee", "layouts", "admin-layout.tsx"), "utf8")
const ROUTER = readFileSync(join(SRC, "router.tsx"), "utf8")

describe("Admin → Trends registration", () => {
  it("has a Trends entry in the admin nav", () => {
    // Only where credits exist: the admin trend API is registered under hasCredits().
    expect(LAYOUT).toContain(`...(hasCredits() ? [{ href: "/admin/trends", label: "Trends", icon: TrendingUp }] : []),`)
  })

  it("routes the list and the editor lazily, inside the admin block", () => {
    expect(ROUTER).toContain(`const AdminTrends = lazy(() => import("@/ee/app/(admin)/admin/trends/page"))`)
    expect(ROUTER).toContain(`const AdminTrendEditor = lazy(() => import("@/ee/app/(admin)/admin/trends/detail/page"))`)
    const block = ROUTER.slice(ROUTER.indexOf("const adminRoutes"), ROUTER.indexOf("const communityRoutes"))
    expect(block).toContain(`{ path: "trends", element: <SuspenseWrapper><AdminTrends /></SuspenseWrapper> }`)
    expect(block).toContain(`{ path: "trends/:id", element: <SuspenseWrapper><AdminTrendEditor /></SuspenseWrapper> }`)
    const at = block.indexOf(`{ path: "trends", element:`)
    expect(block.slice(Math.max(0, at - 200), at)).toContain("...(hasCredits()")
  })
})
