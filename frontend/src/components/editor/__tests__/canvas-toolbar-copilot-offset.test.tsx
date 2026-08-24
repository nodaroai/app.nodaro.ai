/**
 * The editor's floating tool bar is `position: fixed`, so it takes no part in
 * the editor's flex row and has to be TOLD about anything occupying the left
 * edge. When the Copilot rail opened, the bar kept its old offset and rendered
 * on top of the chat — buttons over the conversation, reported from staging.
 *
 * The invariant: the bar always starts to the right of whatever the rail
 * currently occupies. Pinned here because the rail's width and the bar's offset
 * live in different files and nothing else connects them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
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

const { CanvasToolbar } = await import("../canvas-toolbar")
const { COPILOT_RAIL_WIDTH, COPILOT_TAB_WIDTH, useCopilotUiStore } = await import("@/hooks/use-copilot-ui-store")

/** `useNavigate` needs a router in scope; nothing here navigates. */
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
function barLeft(container: HTMLElement): number {
  const bar = [...container.querySelectorAll<HTMLElement>("div[style*='left']")].find((el) =>
    el.className.includes("fixed"),
  )
  expect(bar, "no fixed bar with an inline left was rendered").toBeTruthy()
  return Number.parseInt(bar!.style.left, 10)
}

beforeEach(() => {
  useCopilotUiStore.setState({ open: false, everOpened: false, turnActive: false })
})

describe("the floating tool bar and the Copilot rail", () => {
  it("clears the collapsed tab", () => {
    const { container } = render(<CanvasToolbar {...props} />, { wrapper: Router })
    expect(barLeft(container)).toBeGreaterThanOrEqual(SIDEBAR_WIDTH + COPILOT_TAB_WIDTH)
  })

  it("clears the open rail — the bug was buttons sitting on top of the chat", () => {
    useCopilotUiStore.setState({ open: true, everOpened: true })
    const { container } = render(<CanvasToolbar {...props} />, { wrapper: Router })
    expect(barLeft(container)).toBeGreaterThanOrEqual(SIDEBAR_WIDTH + COPILOT_RAIL_WIDTH)
  })

  it("moves as the rail opens and closes rather than picking one position", () => {
    const closed = barLeft(render(<CanvasToolbar {...props} />, { wrapper: Router }).container)
    useCopilotUiStore.setState({ open: true, everOpened: true })
    const opened = barLeft(render(<CanvasToolbar {...props} />, { wrapper: Router }).container)
    expect(opened - closed).toBe(COPILOT_RAIL_WIDTH - COPILOT_TAB_WIDTH)
  })
})
