/**
 * Under <html dir="rtl"> the app sidebar sits on the physical RIGHT, so the
 * canvas column starts at x=0 and the never-dragged rail must anchor to the
 * right edge — otherwise it floats sidebar-width px into the canvas, and the
 * Add Node panel it toggles (anchored to the inline start) opens far from it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const SIDEBAR_WIDTH = 64

vi.mock("@/components/layout/sidebar-context", () => ({
  useSidebar: () => ({ sidebarWidth: SIDEBAR_WIDTH, isCollapsed: true, setCollapsed: vi.fn(), toggleCollapsed: vi.fn() }),
}))
vi.mock("@/hooks/use-is-mobile", () => ({ useIsMobile: () => false }))
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router")
  return { ...actual, useNavigate: () => vi.fn() }
})
vi.mock("@/lib/edition", async () => {
  const actual = await vi.importActual<typeof import("@/lib/edition")>("@/lib/edition")
  return { ...actual, hasCredits: () => true }
})
// Surface the `side` prop: Radix stamps data-side from floating-ui's
// post-collision placement, which in jsdom's 0×0 rects always flips — so the
// prop, not the computed side, is what a test can pin.
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ side, children }: { side?: string; children: React.ReactNode }) => (
    <div data-testid="tt" data-side={side}>{children}</div>
  ),
}))

const { CanvasToolbar } = await import("../canvas-toolbar")
const { MARKETPLACE_POPUP_WIDTH } = await import("../marketplace-popup-geometry")
const { COPILOT_TAB_WIDTH, useCopilotUiStore } = await import("@/hooks/use-copilot-ui-store")
const { useLocaleStore } = await import("@/lib/locale-store")
const { translate } = await import("@/lib/i18n")

const Router = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>

const props = {
  onAddNode: vi.fn(),
  onComponents: vi.fn(),
  onSearch: vi.fn(),
  onFindInWorkflow: vi.fn(),
  onPreviousFocus: vi.fn(),
  onAssetLibrary: vi.fn(),
  onMediaLibrary: vi.fn(),
  onAddStickyNote: vi.fn(),
  onTidyUp: vi.fn(),
  onToggleSidebar: vi.fn(),
  sidebarVisible: false,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canUndo: false,
  canRedo: false,
  onShowShortcuts: vi.fn(),
}

function fixedBar(container: HTMLElement): HTMLElement {
  const el = [...container.querySelectorAll<HTMLElement>("div")].find(
    (e) => e.className.includes("fixed") && e.className.includes("md:flex"),
  )
  expect(el, "no fixed desktop bar rendered").toBeTruthy()
  return el as HTMLElement
}

beforeEach(() => {
  localStorage.clear()
  useCopilotUiStore.setState({ open: false, everOpened: false, turnActive: false })
  act(() => useLocaleStore.getState().setLocale("he"))
})
afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

describe("canvas toolbar under RTL", () => {
  it("anchors the never-dragged rail to the right edge by the same offset", () => {
    const { container } = render(<CanvasToolbar {...props} />, { wrapper: Router })
    const bar = fixedBar(container)
    expect(bar.style.left).toBe("")
    expect(Number.parseInt(bar.style.right, 10)).toBe(SIDEBAR_WIDTH + COPILOT_TAB_WIDTH + 12)
  })

  it("keeps a dragged position physical — explicit viewport coordinates win", () => {
    localStorage.setItem("nodaro:canvas-toolbar-pos", JSON.stringify({ x: 12, y: 300 }))
    const { container } = render(<CanvasToolbar {...props} />, { wrapper: Router })
    const bar = fixedBar(container)
    expect(bar.style.left).toBe("12px")
    expect(bar.style.right).toBe("")
  })

  it("anchors the Add Node popup on the rail's inline-end side", () => {
    const onAddNode = vi.fn()
    const { container } = render(<CanvasToolbar {...props} onAddNode={onAddNode} />, { wrapper: Router })
    // The mobile bar carries an Add Node button with the same label; the
    // desktop rail's is the one inside the fixed bar.
    const button = fixedBar(container).querySelector<HTMLElement>(`[aria-label="${translate("he", "toolbar.addNode")}"]`)!
    expect(button).toBeTruthy()
    button.getBoundingClientRect = () => ({ left: 900, right: 956, top: 300, bottom: 340, width: 56, height: 40, x: 900, y: 300, toJSON: () => ({}) })
    fireEvent.click(button)
    // The popup grows rightward from `left`, so under RTL its left edge must
    // sit a full popup width (plus the gap) before the rail — not at rect.right.
    expect(onAddNode).toHaveBeenCalledWith({ x: 900 - 8 - MARKETPLACE_POPUP_WIDTH, y: 300 }, true)
    onAddNode.mockClear()
    cleanup()
    act(() => useLocaleStore.getState().setLocale("en"))
    const en = render(<CanvasToolbar {...props} onAddNode={onAddNode} />, { wrapper: Router })
    const enButton = fixedBar(en.container).querySelector<HTMLElement>(`[aria-label="Add Node"]`)!
    enButton.getBoundingClientRect = () => ({ left: 76, right: 132, top: 300, bottom: 340, width: 56, height: 40, x: 76, y: 300, toJSON: () => ({}) })
    fireEvent.click(enButton)
    expect(onAddNode).toHaveBeenCalledWith({ x: 132 + 8, y: 300 }, true)
  })

  it("anchors the mobile bar's Add Node popup the same way", () => {
    const onAddNode = vi.fn()
    const { container } = render(<CanvasToolbar {...props} onAddNode={onAddNode} />, { wrapper: Router })
    const mobileBar = container.querySelector<HTMLElement>(".md\\:hidden")!
    const button = mobileBar.querySelector<HTMLElement>(`[aria-label="${translate("he", "toolbar.addNode")}"]`)!
    button.getBoundingClientRect = () => ({ left: 300, right: 336, top: 8, bottom: 44, width: 36, height: 36, x: 300, y: 8, toJSON: () => ({}) })
    fireEvent.click(button)
    expect(onAddNode).toHaveBeenCalledWith({ x: 300 - 8 - MARKETPLACE_POPUP_WIDTH, y: 44 + 8 }, true)
  })

  it("opens tooltips away from the anchored edge", () => {
    render(<CanvasToolbar {...props} />, { wrapper: Router })
    expect(screen.getAllByTestId("tt")[0].getAttribute("data-side")).toBe("left")
    cleanup()
    act(() => useLocaleStore.getState().setLocale("en"))
    render(<CanvasToolbar {...props} />, { wrapper: Router })
    expect(screen.getAllByTestId("tt")[0].getAttribute("data-side")).toBe("right")
  })

  it("points the mobile Back chevron along the reading direction", () => {
    render(<CanvasToolbar {...props} />, { wrapper: Router })
    expect(screen.getByLabelText(translate("he", "common.back")).querySelector("svg")?.getAttribute("class")).toContain("rotate-180")
    cleanup()
    act(() => useLocaleStore.getState().setLocale("en"))
    render(<CanvasToolbar {...props} />, { wrapper: Router })
    expect(screen.getByLabelText("Back").querySelector("svg")?.getAttribute("class")).not.toContain("rotate-180")
  })

  it("names its buttons in Hebrew", () => {
    render(<CanvasToolbar {...props} />, { wrapper: Router })
    expect(screen.getAllByLabelText(translate("he", "toolbar.addNode")).length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText(translate("he", "ctb.undo")).length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText(translate("he", "ctb.keyboardShortcuts")).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText("Add Node")).toBeNull()
    expect(screen.queryByLabelText("Undo")).toBeNull()
  })
})
