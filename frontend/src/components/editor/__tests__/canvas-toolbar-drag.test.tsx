/**
 * The tool bar can be dragged, and remembers where it was put.
 *
 * The interesting half is not the drag maths — it is the PRECEDENCE. A saved
 * position must beat the automatic sidebar/Copilot-rail placement, including
 * when that would put the bar over the rail: an explicit placement by the user
 * outranks the default that exists to avoid the overlap. The sibling test
 * (canvas-toolbar-copilot-offset) pins the opposite direction for the
 * never-dragged bar, and only one of the two can be right for a given render,
 * so they are pinned separately rather than in one file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const SIDEBAR_WIDTH = 64
const POS_KEY = "nodaro:canvas-toolbar-pos"

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

const { CanvasToolbar } = await import("../canvas-toolbar")

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

/** The desktop bar is the one with an inline `left`. */
function bar(container: HTMLElement): HTMLElement {
  const el = [...container.querySelectorAll<HTMLElement>("div[style*='left']")].find((e) =>
    e.className.includes("fixed"),
  )
  expect(el, "no fixed bar with an inline left was rendered").toBeTruthy()
  return el as HTMLElement
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe("canvas toolbar — dragged placement", () => {
  it("a saved position drives left AND top, overriding the automatic offset", () => {
    localStorage.setItem(POS_KEY, JSON.stringify({ x: 12, y: 300 }))
    const { container } = render(<CanvasToolbar {...props} />, { wrapper: Router })

    const el = bar(container)
    expect(el.style.left).toBe("12px")
    expect(el.style.top).toBe("300px")
    // x=12 is well left of the sidebar edge (64) — the saved position wins
    // over the rail-aware default, which is the whole point.
    expect(el.style.left).not.toBe(`${SIDEBAR_WIDTH + 12}px`)
  })

  it("a dragged bar drops the centering transform and its transition", () => {
    localStorage.setItem(POS_KEY, JSON.stringify({ x: 12, y: 300 }))
    const { container } = render(<CanvasToolbar {...props} />, { wrapper: Router })

    const cls = bar(container).className
    // Left in place these would fight the inline `top` (translate) and make
    // every pointermove lag a third of a second behind the cursor.
    expect(cls).not.toContain("-translate-y-1/2")
    expect(cls).not.toContain("transition-all")
  })

  it("never dragged: no inline top, and the centering class is back", () => {
    const { container } = render(<CanvasToolbar {...props} />, { wrapper: Router })

    const el = bar(container)
    expect(el.style.top).toBe("")
    expect(el.className).toContain("-translate-y-1/2")
  })

  it("unreadable storage degrades to the default placement, it does not throw", () => {
    localStorage.setItem(POS_KEY, "{not json")
    const { container } = render(<CanvasToolbar {...props} />, { wrapper: Router })

    const el = bar(container)
    expect(el.style.top).toBe("")
    expect(el.className).toContain("-translate-y-1/2")
  })

  it("the grip is present and says how to reset it", () => {
    const { getByLabelText } = render(<CanvasToolbar {...props} />, { wrapper: Router })
    // Named, because the only affordance is a 16px handle — a user who cannot
    // see it has no way to discover that the bar moves at all.
    expect(getByLabelText(/drag toolbar/i)).toBeTruthy()
  })
})
