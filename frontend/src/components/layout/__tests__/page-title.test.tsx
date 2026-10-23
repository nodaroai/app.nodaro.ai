import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { pageTitleKey, usePageTitle, type TitledEntry } from "../page-title"
import { NAV_ITEMS } from "../app-sidebar"

/**
 * WCAG 2.4.2: every signed-in page has a title that says which page it is.
 */

const brand = vi.hoisted(() => ({ name: "Nodaro" }))
vi.mock("@/lib/surface-selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-selectors")>()),
  surfaceBrandName: () => brand.name,
}))

const ENTRIES: readonly TitledEntry[] = [
  { href: "/projects", label: "nav.projects" },
  { href: "/settings", label: "nav.settings" },
  { href: "/admin", label: "nav.admin" },
  { href: "/admin/community-reports", label: "nav.communityReports" },
]

describe("pageTitleKey", () => {
  it("names the page by the sidebar entry the address falls under", () => {
    expect(pageTitleKey("/projects", ENTRIES)).toBe("nav.projects")
    expect(pageTitleKey("/settings/api", ENTRIES)).toBe("nav.settings")
  })

  it("prefers the longest entry, and matches whole segments only", () => {
    expect(pageTitleKey("/admin/community-reports", ENTRIES)).toBe("nav.communityReports")
    expect(pageTitleKey("/admin/users", ENTRIES)).toBe("nav.admin")
    expect(pageTitleKey("/settingsX", ENTRIES)).toBeNull()
  })

  it("names the workflow editor on both of its addresses", () => {
    expect(pageTitleKey("/projects/p1/workflows/w1", ENTRIES)).toBe("page.editor")
    expect(pageTitleKey("/editor/w1", ENTRIES)).toBe("page.editor")
    expect(pageTitleKey("/projects/p1", ENTRIES)).toBe("nav.projects")
  })

  it("covers the real sidebar entries", () => {
    expect(pageTitleKey("/executions", NAV_ITEMS)).toBe("nav.executions")
    expect(pageTitleKey("/my-files", NAV_ITEMS)).toBe("nav.myFiles")
  })
})

describe("usePageTitle", () => {
  it("writes '<page> | Nodaro' on a default deployment", () => {
    brand.name = "Nodaro"
    renderHook(() => usePageTitle("/projects", ENTRIES))
    expect(document.title).toBe("Projects | Nodaro")
  })

  it("uses the deployment's own brand, and the brand alone for a page with no entry", () => {
    brand.name = "Acme Studio"
    renderHook(() => usePageTitle("/settings", ENTRIES))
    expect(document.title).toBe("Settings | Acme Studio")
    renderHook(() => usePageTitle("/somewhere-else", ENTRIES))
    expect(document.title).toBe("Acme Studio")
  })
})
