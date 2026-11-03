// @test-watches frontend/src/app/(auth)/login/page.tsx frontend/src/components/layout/sidebar-footer.tsx frontend/src/ee/shell/app-header.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * The public complaints form is linked where a case can be handled (a
 * deployment with the admin's complaints screen) and where the platform's
 * legal pages are shown; nowhere else. Every surface that lists the legal
 * pages carries the link beside the accessibility statement.
 */

const gate = vi.hoisted(() => ({ admin: true, links: true }))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasAdmin: () => gate.admin,
}))
vi.mock("@/lib/surface-selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-selectors")>()),
  surfacePlatformLinks: () => gate.links,
}))

import { ComplaintsLink } from "../complaints-link"

function renderLink() {
  return render(
    <MemoryRouter>
      <ComplaintsLink />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  gate.admin = true
  gate.links = true
})

describe("ComplaintsLink", () => {
  it("links to /copyright-complaints where a case can be handled", () => {
    renderLink()
    expect(screen.getByRole("link")).toHaveAttribute("href", "/copyright-complaints")
  })

  it("renders nothing without the admin's screen, or on a white-label deployment", () => {
    gate.admin = false
    expect(renderLink().container.textContent).toBe("")
    gate.admin = true
    gate.links = false
    expect(renderLink().container.textContent).toBe("")
  })
})

describe("every surface that lists the legal pages carries the link", () => {
  const SURFACES = [
    "src/app/(auth)/login/page.tsx", // sign-in, beside Terms / Privacy / Refund
    "src/components/layout/sidebar-footer.tsx", // the sidebar, beside the accessibility statement
    "src/ee/shell/app-header.tsx", // the shared header's account menu
  ]
  for (const file of SURFACES) {
    it(file, () => {
      const source = readFileSync(resolve(__dirname, "../../../..", file), "utf8")
      expect(source).toContain("<ComplaintsLink")
    })
  }
})
