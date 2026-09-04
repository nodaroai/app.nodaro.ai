import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ENTRY_BY_LINK } from "@/lib/surface-nav-registry"

/**
 * Track A — where `/billing-admin` is registered, and why the shape matters.
 *
 * The page is the deployment BILLING ACCOUNT's own screen (spec §9.3). Three
 * structural properties, each of which fails only in production if it drifts:
 *
 *  - It is registered at all. WS6 built the page and its hooks but owns no
 *    router file, so the whole surface can sit in the tree as dead code with
 *    every test green — this is the only guard that the route exists.
 *  - It is gated on `hasCredits()`, NOT on the payer flag. The billing surface
 *    that answers "does this deployment have a payer" is fetched, so gating the
 *    ROUTE on it would race the first render and 404 the payer's own bookmark.
 *    The page is its own gate; the authority is `requireDeploymentPayer` on
 *    every route it reads.
 *  - It sits INSIDE the dashboard layout, with the rest of the account screens
 *    — it needs the session, the chrome and the sidebar entry beside it.
 *
 * A source-text guard, like `org-route-registration.test.ts`: the property is
 * structural (which array the route is spread into, behind which gate), and
 * rendering the whole router would prove less while breaking more often.
 */

const ROUTER = readFileSync(join(__dirname, "..", "router.tsx"), "utf8")

describe("the /billing-admin route", () => {
  it("is registered", () => {
    expect(ROUTER).toContain(`path: "/billing-admin"`)
    expect(ROUTER).toContain("<BillingAdminPage />")
  })

  it("is lazy, so no non-payer build pays for the chunk", () => {
    expect(ROUTER).toContain(
      `const BillingAdminPage = lazy(() => import("@/ee/app/billing-admin/page"))`,
    )
  })

  it("is gated on hasCredits(), not on the async payer flag", () => {
    const idx = ROUTER.indexOf(`path: "/billing-admin"`)
    expect(idx).toBeGreaterThan(0)
    const before = ROUTER.slice(Math.max(0, idx - 220), idx)
    expect(before).toContain("...(hasCredits()")
    // The payer flag lives behind a fetch — gating the route on it would race
    // the first render.
    expect(before).not.toContain("deploymentPayer")
  })

  it("sits inside the dashboard layout, beside /billing and /settings", () => {
    const admin = ROUTER.indexOf(`path: "/billing-admin"`)
    const billing = ROUTER.indexOf(`path: "/billing",`)
    const settings = ROUTER.indexOf(`path: "/settings",`)
    expect(billing).toBeLessThan(admin)
    expect(admin).toBeLessThan(settings)
  })

  it("is classified link-only, so the orphan guard stays green", () => {
    // A route that is neither link-only nor tied to a nav entry strands the
    // stock profile; `/billing-admin` has no surface NavKey by design.
    expect(ENTRY_BY_LINK).toContain("/billing-admin")
  })
})
