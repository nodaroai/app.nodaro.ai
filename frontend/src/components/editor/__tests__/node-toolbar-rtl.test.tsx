import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup, act } from "@testing-library/react"

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))
vi.mock("@xyflow/react", () => ({ useReactFlow: () => ({ getViewport: () => ({ x: 0, y: 0, zoom: 1 }) }) }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: (s: unknown) => unknown) => sel({ addNode: vi.fn(), addNodeAndOpenPicker: vi.fn() }),
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: false }) }))
vi.mock("../unified-asset-library", () => ({ UnifiedAssetLibraryButton: () => null }))
vi.mock("../component-marketplace-modal", () => ({ ComponentMarketplaceModal: () => null }))

import { NodeToolbar } from "../node-toolbar"
import { useLocaleStore } from "@/lib/locale-store"

const panel = (container: HTMLElement) => {
  const el = [...container.querySelectorAll<HTMLElement>("div")].find((e) => e.className.includes("md:flex") && e.className.includes("w-52"))
  expect(el, "desktop Add Node panel not rendered").toBeTruthy()
  return el as HTMLElement
}

afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

// The panel is chrome outside the canvas, so it inherits <html dir>. It must
// open beside the rail that toggles it: inline-start offset, and the slide-in
// must come from the same edge the rail sits on.
describe("Add Node panel placement", () => {
  it("slides in from the start edge in Hebrew", () => {
    act(() => useLocaleStore.getState().setLocale("he"))
    const { container } = render(<NodeToolbar visible />)
    const cls = panel(container).className
    expect(cls).toContain("start-16")
    expect(cls).not.toContain("left-16")
    expect(cls).toContain("slide-in-from-right-2")
    expect(cls).not.toContain("slide-in-from-left-2")
  })

  it("slides in from the left in English", () => {
    act(() => useLocaleStore.getState().setLocale("en"))
    const { container } = render(<NodeToolbar visible />)
    const cls = panel(container).className
    expect(cls).toContain("start-16")
    expect(cls).toContain("slide-in-from-left-2")
  })
})
