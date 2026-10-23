// @test-watches frontend/src/app/(auth)/login/page.tsx frontend/src/components/layout/sidebar-footer.tsx frontend/src/ee/shell/app-header.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * The statement must sit in a prominent place (reg 35ה): the link shows where
 * Nodaro runs the service (Cloud, Nodaro's own links), nowhere else, and every
 * surface that lists the legal pages carries it.
 */

const gate = vi.hoisted(() => ({ cloud: true, links: true }))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasCredits: () => gate.cloud,
}))
vi.mock("@/lib/surface-selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-selectors")>()),
  surfacePlatformLinks: () => gate.links,
}))

import { AccessibilityStatementLink } from "../accessibility-statement-link"

function renderLink() {
  return render(
    <MemoryRouter>
      <AccessibilityStatementLink />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  gate.cloud = true
  gate.links = true
})

describe("AccessibilityStatementLink", () => {
  it("links to /accessibility on Nodaro's own Cloud", () => {
    renderLink()
    expect(screen.getByRole("link")).toHaveAttribute("href", "/accessibility")
  })

  it("renders nothing on a self-hosted install or a white-label deployment", () => {
    gate.cloud = false
    expect(renderLink().container.textContent).toBe("")
    gate.cloud = true
    gate.links = false
    expect(renderLink().container.textContent).toBe("")
  })
})

describe("every surface that lists the legal pages carries the link", () => {
  const SURFACES = [
    "src/app/(auth)/login/page.tsx", // sign-in, beside Terms / Privacy / Refund
    "src/components/layout/sidebar-footer.tsx", // the sidebar, above the version
    "src/ee/shell/app-header.tsx", // the shared header's account menu
  ]
  for (const file of SURFACES) {
    it(file, () => {
      const source = readFileSync(resolve(__dirname, "../../../..", file), "utf8")
      expect(source).toContain("<AccessibilityStatementLink")
    })
  }
})
