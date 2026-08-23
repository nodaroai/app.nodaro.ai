import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Where the organization routes are registered, and why it matters.
 *
 * `/join` and `/join/:token` are how someone GETS IN, and the person
 * following them is signed out. Registered inside the dashboard layout they
 * would bounce to `/login`, and the token — the one-time credential the
 * whole flow depends on — would be lost on the way. So they sit beside
 * `/login`, outside the app chrome, and this test pins that: a refactor that
 * folds them into the dashboard block would otherwise fail only in
 * production, for people who cannot report it because they never got in.
 *
 * The second half is the flag: on a build without organizations the routes
 * must be ABSENT, not empty. A registered route that can only fail is worse
 * than a 404, which at least says the feature is not here.
 *
 * A source-text guard rather than a render, deliberately — the property is
 * structural (which array the routes are spread into), and rendering the
 * whole router to inspect it would prove less while breaking more often.
 */

const ROUTER = readFileSync(join(__dirname, "..", "router.tsx"), "utf8")

describe("the organization routes", () => {
  it("are gated on hasOrganizations()", () => {
    expect(ROUTER).toMatch(/const orgPublicRoutes: RouteObject\[\] = hasOrganizations\(\)/)
    expect(ROUTER).toContain(`import { hasAdmin, hasCredits, isCloud, isMultiUser, hasOrganizations } from "@/lib/edition"`)
  })

  it("register both ways in", () => {
    const start = ROUTER.indexOf("const orgPublicRoutes")
    const block = ROUTER.slice(start, ROUTER.indexOf("const setupRoutes", start))
    expect(block).toContain(`path: "/join"`)
    expect(block).toContain(`path: "/join/:token"`)
    expect(block).toContain("JoinCodePage")
    expect(block).toContain("InvitationPage")
  })

  it("are spread OUTSIDE the dashboard layout, next to /login", () => {
    const spread = ROUTER.indexOf("...orgPublicRoutes,")
    const login = ROUTER.indexOf(`path: "/login",`)
    const dashboardChildren = ROUTER.indexOf("...communityRoutes,")
    expect(spread).toBeGreaterThan(0)
    // Immediately before the login route object, and nowhere near the
    // dashboard block that would demand a session.
    expect(spread).toBeLessThan(login)
    expect(spread).toBeLessThan(dashboardChildren)
    expect(ROUTER.slice(spread, login)).not.toContain("DashboardLayout")
  })

  it("are lazy, so the chunk never loads on a build without them", () => {
    expect(ROUTER).toContain(`const InvitationPage = lazy(() => import("@/ee/app/join/invitation-page"))`)
    expect(ROUTER).toContain(`const JoinCodePage = lazy(() => import("@/ee/app/join/join-code-page"))`)
  })
})
