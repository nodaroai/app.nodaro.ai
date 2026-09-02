import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react"

// Full-render tests can exceed the default 5s on slow CI runners (precedent:
// add-node-popup-tabs.test.tsx) — scope a higher timeout to this file only.
vi.setConfig({ testTimeout: 15000 })

// ---------------------------------------------------------------------------
// Mocks — identical to add-node-popup-tabs.test.tsx. lucide-react needs an
// explicit Proxy (a closed export list cannot anticipate every icon name).
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

vi.mock("@/lib/node-compatibility", () => ({
  getCompatibleNodes: () => ({ direct: [], compatible: [], directTypes: new Set() }),
  resolveTargetHandle: () => undefined,
  PARAMETER_ACCEPTING_HANDLE_IDS: new Set(),
}))

vi.mock("@/lib/node-name-field", () => ({
  buildPrefillInitialData: () => undefined,
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1" }, isAdmin: false }),
}))

vi.mock("@/hooks/queries/use-user-settings-queries", () => ({
  useUserSettings: () => ({ data: { showRecentNodes: false, showMostUsedNodes: false } }),
}))

vi.mock("@/hooks/use-node-selection-history-store", () => ({
  useNodeSelectionHistoryStore: (sel: (s: unknown) => unknown) =>
    sel({ history: [], recordSelection: () => {} }),
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: (s: unknown) => unknown) =>
    sel({ openPickerForNode: () => {} }),
}))

vi.mock("../component-marketplace-modal", () => ({
  ComponentMarketplaceModal: () => null,
}))

import { AddNodePopup, connectChipLabel } from "../add-node-popup"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPopup(overrides: Partial<Parameters<typeof AddNodePopup>[0]> = {}) {
  return render(
    <AddNodePopup
      open
      onClose={vi.fn()}
      onAddNode={vi.fn()}
      position={{ x: 100, y: 100 }}
      connectionContext={null}
      {...overrides}
    />,
  )
}

const tab = (name: string) => screen.getByRole("tab", { name })
const search = () => screen.getByRole("textbox") as HTMLInputElement

beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  act(() => useLocaleStore.getState().setLocale("he"))
})

afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

// ---------------------------------------------------------------------------
// Regression: with the UI in Hebrew the popup title, search box and footer
// were Hebrew but the tablist, every family header and every node row still
// rendered raw English — the redesigned picker components bypassed the
// node-label / node-group tables the canvas and the edge-drop paths use.
// ---------------------------------------------------------------------------

describe("add-node popup in Hebrew", () => {
  it("names the tabs in Hebrew", () => {
    renderPopup()
    expect(tab("הכל")).toBeTruthy()
    expect(tab("תמונה")).toBeTruthy()
    expect(screen.queryByRole("tab", { name: "All" })).toBeNull()
    expect(screen.queryByRole("tab", { name: "Image" })).toBeNull()
  })

  it("renders node rows through the node-label table", () => {
    renderPopup()
    expect(screen.getAllByText("העלאת תמונה").length).toBeGreaterThan(0)
    expect(screen.queryByText("Upload Image")).toBeNull()
  })

  it("renders family headers in Hebrew", () => {
    renderPopup()
    expect(screen.getByText("העלאה משלכם")).toBeTruthy()
    expect(screen.queryByText("Add Your Own")).toBeNull()
  })

  it("prefixes All-tab headers with the Hebrew tab name", () => {
    renderPopup()
    fireEvent.click(tab("הכל"))
    expect(screen.getByText("תמונה · העלאה משלכם")).toBeTruthy()
    expect(screen.queryByText("Image · Add Your Own")).toBeNull()
  })

  it("localizes the Popular shortcut header on a media tab", () => {
    renderPopup()
    fireEvent.click(tab("תמונה"))
    expect(screen.queryByText("Popular")).toBeNull()
    expect(screen.getByText("פופולריים")).toBeTruthy()
  })

  it("localizes the Creative Controls toggle", () => {
    renderPopup()
    fireEvent.click(tab("תמונה"))
    expect(screen.queryByText("Creative Controls")).toBeNull()
    expect(screen.getByText(translate("he", "addnode.creativeControls"))).toBeTruthy()
  })

  it("finds a node by its Hebrew name and shows the Hebrew row", () => {
    renderPopup()
    fireEvent.change(search(), { target: { value: "העלאת תמונה" } })
    expect(screen.getAllByText("העלאת תמונה").length).toBeGreaterThan(0)
    expect(screen.queryByText("Upload Image")).toBeNull()
  })

  it("labels cross-tab search hits in Hebrew", () => {
    renderPopup()
    fireEvent.click(tab("תמונה"))
    // "List" lives on the Automate tab, so on Image it lands under the
    // cross-tab separator badged with its owning tab.
    fireEvent.change(search(), { target: { value: "רשימה" } })
    expect(screen.getByText(translate("he", "addnode.blockOther"))).toBeTruthy()
    expect(screen.queryByText("From other tabs")).toBeNull()
    expect(screen.queryByText("AUTOMATE")).toBeNull()
    // The tab button AND the row's owning-tab badge both carry the Hebrew name.
    expect(screen.getAllByText(translate("he", "addnode.tabAutomate")).length).toBeGreaterThan(1)
  })

  it("shows the empty state in Hebrew", () => {
    renderPopup()
    fireEvent.change(search(), { target: { value: "zzzz-no-such-node" } })
    expect(screen.queryByText(/No node matches/)).toBeNull()
    expect(screen.getByText(translate("he", "addnode.noMatch", { query: "zzzz-no-such-node" }))).toBeTruthy()
  })

  it("names the focused node in Hebrew in the auto-connect header", () => {
    renderPopup({
      autoConnectCtx: {
        nodeId: "n1",
        nodeType: "upload-image",
        focusedLabel: "Upload Image",
        sourceHandles: ["image"],
        targetHandles: [],
      },
    })
    const heading = screen.getByRole("heading", { level: 3 })
    expect(heading.textContent).toContain("העלאת תמונה")
    expect(heading.textContent).not.toContain("Upload Image")
  })

  it("cycles tabs with the arrow that points forward in the reading direction", () => {
    renderPopup()
    // Tabs start on Common. Under RTL the tab to the visual right of
    // Common is… nothing (it is rightmost), so ← must go forward to Image.
    fireEvent.keyDown(document, { key: "ArrowLeft" })
    expect(tab("תמונה").getAttribute("aria-selected")).toBe("true")
    fireEvent.keyDown(document, { key: "ArrowRight" })
    expect(tab("נפוצים").getAttribute("aria-selected")).toBe("true")
  })
})

describe("edge-drop connect chip", () => {
  it("points the flow arrow in the reading direction", () => {
    expect(connectChipLabel("image", "source", false)).toBe("image →")
    expect(connectChipLabel("image", "target", false)).toBe("→ image")
    expect(connectChipLabel("image", "source", true)).toBe("image ←")
    expect(connectChipLabel("image", "target", true)).toBe("← image")
  })
})
