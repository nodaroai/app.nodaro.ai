import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

import { SidebarSection } from "../node-toolbar/sidebar-section"
import { sidebarSections } from "@/lib/node-picker-sections"
import { getNodeOptions } from "@/lib/node-options"
import { useLocaleStore } from "@/lib/locale-store"

beforeEach(() => {
  act(() => useLocaleStore.getState().setLocale("he"))
})

afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

// The sidebar shares the popup's catalogue and its bug: tab header, family
// header and node rows all rendered raw English in a Hebrew UI.
describe("sidebar section in Hebrew", () => {
  it("renders the tab header, family headers and node rows in Hebrew", () => {
    const image = sidebarSections(getNodeOptions()).find((s) => s.id === "image")
    expect(image).toBeTruthy()
    render(<SidebarSection section={image!} open onToggle={vi.fn()} onAdd={vi.fn()} />)
    // The header is the only button carrying aria-expanded (rows have none).
    const header = screen.getByRole("button", { expanded: true })
    expect(header.textContent).toContain("תמונה")
    expect(header.textContent).not.toContain("Image")
    expect(screen.getByText("העלאה משלכם")).toBeTruthy()
    expect(screen.queryByText("Add Your Own")).toBeNull()
    expect(screen.getByText("העלאת תמונה")).toBeTruthy()
    expect(screen.queryByText("Upload Image")).toBeNull()
  })
})
