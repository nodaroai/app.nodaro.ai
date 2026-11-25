import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { scaledTimeout } from "../../../../../tools/vitest/ci-limits.mjs"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

// Full-render tests can exceed the default 5s on slow CI runners (precedent:
// person-picker, #3223) — scope a higher timeout to this file only.
vi.setConfig({ testTimeout: scaledTimeout(15_000) })

// ---------------------------------------------------------------------------
// Mocks — lucide-react needs an explicit export list (Proxy-based mocks can
// hang vitest during ESM resolution of large named-import destructuring).
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => new Proxy({}, {
  // Any icon name resolves to a null component — the rich picker-ui package
  // imports icons a closed list cannot anticipate (Dog, Car, ...).
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

import { AddNodePopup, SEARCH_BLOCK_ORDER, type SearchBlock } from "../add-node-popup"
import { ADD_NODE_MENU_TAB_KEY, ADD_NODE_MENU_TABS } from "@/lib/add-node-menu-tab"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPopup(overrides: Partial<Parameters<typeof AddNodePopup>[0]> = {}) {
  const onClose = vi.fn()
  const onAddNode = vi.fn()
  const utils = render(
    <AddNodePopup
      open
      onClose={onClose}
      onAddNode={onAddNode}
      position={{ x: 100, y: 100 }}
      connectionContext={null}
      {...overrides}
    />,
  )
  return { onClose, onAddNode, ...utils }
}

const tab = (name: string) => screen.getByRole("tab", { name })

beforeEach(() => {
  localStorage.clear()
  // jsdom doesn't implement scrollIntoView (the popup's highlight-scroll effect)
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AddNodePopup tabs", () => {
  it("renders the nine intent tabs in order with Common active by default", () => {
    renderPopup()
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Common",
      "Image",
      "Video",
      "Audio",
      "Models",
      "Assets",
      "Automate",
      "Publish",
      "All",
    ])
    expect(tab("Common")).toHaveAttribute("aria-selected", "true")
    expect(tab("All")).toHaveAttribute("aria-selected", "false")
    // Curated Common content shows at root, Text first.
    expect(screen.getByText("Generate Image")).toBeInTheDocument()
    expect(screen.getByText("Text")).toBeInTheDocument()
  })

  it("Video tab groups its nodes into families, POPULAR first", () => {
    renderPopup()
    fireEvent.click(tab("Video"))
    expect(tab("Video")).toHaveAttribute("aria-selected", "true")
    expect(localStorage.getItem(ADD_NODE_MENU_TAB_KEY)).toBe("video")
    // Family headers replace the old flat "More" dump.
    expect(screen.getByText("Popular")).toBeInTheDocument()
    expect(screen.getByText("Animate & Perform")).toBeInTheDocument()
    expect(screen.getByText("Cut & Assemble")).toBeInTheDocument()
    expect(screen.queryByText("More")).toBeNull()
    const rows = screen.getAllByRole("button").map((b) => b.textContent ?? "")
    // The tab is a superset now: plan-emitting nodes belong to Video.
    expect(rows).toContain("After Effects")
    // Image-only generators still do not.
    expect(rows).not.toContain("Generate Image")
  })

  it("Image and Audio tabs show what deals with that medium", () => {
    renderPopup()
    fireEvent.click(tab("Image"))
    // POPULAR repeats Upload Image inside ADD YOUR OWN — the repeat rule.
    expect(screen.getAllByText("Upload Image").length).toBe(2)
    expect(screen.getByText("Remove Background")).toBeInTheDocument()
    // Consumers of an image now appear alongside its producers.
    expect(screen.getByText("Describe Image")).toBeInTheDocument()
    expect(screen.queryByText("Generate Video")).toBeNull()
    fireEvent.click(tab("Audio"))
    expect(screen.getAllByText("Text to Speech").length).toBe(2) // POPULAR + family
    expect(screen.getByText("Generate Music")).toBeInTheDocument()
    // "Transcribe" is both a family header and a node here.
    expect(screen.getAllByText("Transcribe").length).toBeGreaterThan(1)
    expect(screen.queryAllByText("Upload Image")).toEqual([])
  })

  it("offers Creative Controls collapsed at the foot of a media tab", () => {
    renderPopup()
    fireEvent.click(tab("Image"))
    expect(screen.getByText("Creative Controls")).toBeInTheDocument()
    expect(screen.queryByText("Camera Motion")).toBeNull()
    fireEvent.click(screen.getByText("Creative Controls"))
    expect(screen.getByText("Camera Motion")).toBeInTheDocument()
    // MUSIC & VOICE is the Audio tab's alone.
    expect(screen.queryByText("Music Genre")).toBeNull()
    fireEvent.click(tab("Audio"))
    expect(screen.getByText("Music Genre")).toBeInTheDocument()
  })

  it("surfaces the formerly hidden settings nodes on the Models tab", () => {
    renderPopup()
    fireEvent.click(tab("Models"))
    expect(screen.getByText("Generation Settings")).toBeInTheDocument()
    expect(screen.getByText("Aspect Ratio")).toBeInTheDocument()
    expect(screen.getByText("Style Guide")).toBeInTheDocument()
  })

  it("All tab lists every family under a TAB · FAMILY header", () => {
    renderPopup()
    fireEvent.click(tab("All"))
    expect(tab("All")).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("Image · Edit & Retouch")).toBeInTheDocument()
    expect(screen.getByText("Publish · Platforms")).toBeInTheDocument()
    expect(screen.getByText("Creative Controls · Camera")).toBeInTheDocument()
    expect(localStorage.getItem(ADD_NODE_MENU_TAB_KEY)).toBe("all")
  })

  it("restores the last tab choice from localStorage", () => {
    localStorage.setItem(ADD_NODE_MENU_TAB_KEY, "video")
    renderPopup()
    expect(tab("Video")).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("Upload Video")).toBeInTheDocument()
  })

  it("falls back to Common when localStorage holds a retired tab id", () => {
    localStorage.setItem(ADD_NODE_MENU_TAB_KEY, "pickers")
    renderPopup()
    expect(tab("Common")).toHaveAttribute("aria-selected", "true")
  })

  it("Tab key cycles forward through the modes and persists", () => {
    renderPopup()
    fireEvent.keyDown(document, { key: "Tab" })
    expect(tab("Image")).toHaveAttribute("aria-selected", "true")
    expect(localStorage.getItem(ADD_NODE_MENU_TAB_KEY)).toBe("image")
    for (const next of ["Video", "Audio", "Models", "Assets", "Automate", "Publish", "All", "Common"]) {
      fireEvent.keyDown(document, { key: "Tab" })
      expect(tab(next)).toHaveAttribute("aria-selected", "true")
    }
  })

  it("Shift+Tab cycles backward and wraps", () => {
    renderPopup()
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(tab("All")).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(tab("Publish")).toHaveAttribute("aria-selected", "true")
  })

  it("Escape closes the popup from a tab root", () => {
    const { onClose } = renderPopup()
    fireEvent.click(tab("All"))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })


  it("always opens centred in the viewport, regardless of the invocation position", () => {
    renderPopup({ position: { x: 7, y: 13 } })
    const popup = screen.getByRole("tablist").closest("div.fixed") as HTMLElement
    expect(popup.style.left).toBe("50%")
    expect(popup.style.top).toBe("50%")
    expect(popup.style.transform).toContain("translate(-50%, -50%)")
  })

  it("renders the node list in a Radix scroll area (persistent scrollbar when overflowing)", () => {
    renderPopup()
    const popup = screen.getByRole("tablist").closest("div.fixed") as HTMLElement
    expect(popup.querySelector("[data-radix-scroll-area-viewport]")).not.toBeNull()
  })

  it("has a fixed height of 60% of the page, on every tab", () => {
    renderPopup()
    const popup = screen.getByRole("tablist").closest("div.fixed") as HTMLElement
    expect(popup.style.height).toBe("60vh")
    expect(popup.style.maxHeight).toBe("")
    expect(popup.style.minHeight).toBe("")
  })

  it("never dead-ends: a cross-tab match lands under 'From other tabs'", () => {
    renderPopup()
    fireEvent.click(tab("Video"))
    fireEvent.change(screen.getByPlaceholderText("Search nodes..."), { target: { value: "background" } })
    // Remove Background is an Image-tab node; searching it from Video must
    // still surface it rather than showing nothing.
    expect(screen.getByText("From other tabs")).toBeInTheDocument()
    const rows = screen.getAllByRole("button").map((b) => b.textContent ?? "")
    expect(rows.some((t) => t.startsWith("Remove Background"))).toBe(true)
  })

  it("keeps this tab's own matches above the cross-tab ones", () => {
    renderPopup()
    fireEvent.click(tab("Video"))
    fireEvent.change(screen.getByPlaceholderText("Search nodes..."), { target: { value: "video" } })
    const rows = screen.getAllByRole("button").map((b) => b.textContent ?? "")
    const uploadVideo = rows.findIndex((t) => t.startsWith("Upload Video"))
    const composeVideo = rows.findIndex((t) => t.startsWith("Compose Video"))
    expect(uploadVideo).toBeGreaterThanOrEqual(0)
    expect(composeVideo).toBeGreaterThan(uploadVideo)
  })

  it("search on the All tab stays flat — no Other section", () => {
    renderPopup()
    fireEvent.click(tab("All"))
    fireEvent.change(screen.getByPlaceholderText("Search nodes..."), { target: { value: "video" } })
    expect(screen.queryByText("Other")).toBeNull()
  })

  it("search results put common nodes before non-common ones", () => {
    renderPopup()
    const input = screen.getByPlaceholderText("Search nodes...")
    fireEvent.change(input, { target: { value: "video" } })
    const rows = screen.getAllByRole("button").map((b) => b.textContent ?? "")
    const generateVideo = rows.findIndex((t) => t.startsWith("Generate Video"))
    const videoToVideo = rows.findIndex((t) => t.startsWith("Video to Video"))
    expect(generateVideo).toBeGreaterThanOrEqual(0)
    expect(videoToVideo).toBeGreaterThanOrEqual(0)
    expect(generateVideo).toBeLessThan(videoToVideo)
  })
})

  it("groups search hits under their family headers", () => {
    renderPopup()
    fireEvent.click(tab("Audio"))
    fireEvent.change(screen.getByPlaceholderText("Search nodes..."), { target: { value: "voice" } })
    expect(screen.getByText("Voices")).toBeInTheDocument()
  })

  it("badges each cross-tab hit with the tab it lives on", () => {
    renderPopup()
    fireEvent.click(tab("Video"))
    fireEvent.change(screen.getByPlaceholderText("Search nodes..."), { target: { value: "background" } })
    expect(screen.getByText("From other tabs")).toBeInTheDocument()
    expect(screen.getByText("IMAGE")).toBeInTheDocument()
  })

  it("says so plainly when nothing matches anywhere", () => {
    renderPopup()
    fireEvent.change(screen.getByPlaceholderText("Search nodes..."), { target: { value: "zzzqqq" } })
    expect(screen.getByText(/No node matches/)).toBeInTheDocument()
    expect(screen.getByText(/browse every node in the All tab/)).toBeInTheDocument()
  })

  it("cycles tabs with the arrow keys the footer advertises", () => {
    renderPopup()
    fireEvent.keyDown(document, { key: "ArrowRight" })
    expect(tab("Image")).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(document, { key: "ArrowLeft" })
    expect(tab("Common")).toHaveAttribute("aria-selected", "true")
  })

  it("leaves the arrow keys to the list once a query is typed", () => {
    renderPopup()
    fireEvent.change(screen.getByPlaceholderText("Search nodes..."), { target: { value: "video" } })
    fireEvent.keyDown(document, { key: "ArrowRight" })
    expect(tab("Common")).toHaveAttribute("aria-selected", "true")
  })

  it("drops the Most Used category entirely", () => {
    renderPopup()
    fireEvent.click(tab("All"))
    expect(screen.queryByText("MOST USED")).toBeNull()
  })

describe("AddNodePopup auto-connect", () => {
  const focusedCtx = { nodeId: "n1", nodeType: "text-prompt", focusedLabel: "Hero Prompt", sourceHandles: ["prompt"], targetHandles: ["in"] }

  it("titles the header with the focused node it will connect to", () => {
    renderPopup({ autoConnectCtx: focusedCtx, onPickType: vi.fn() })
    expect(screen.getByText("Connecting new node to")).toBeInTheDocument()
    expect(screen.getByText("Hero Prompt")).toBeInTheDocument()
  })

  it("renders only the Auto Connect toggle (Smart toggle hidden) and persists toggling Auto", () => {
    renderPopup({ autoConnectCtx: focusedCtx, onPickType: vi.fn() })
    const auto = screen.getByRole("switch", { name: "Auto-connect" })
    expect(auto).toBeInTheDocument()
    // Smart Connect is disabled (force-OFF in auto-connect-pref.ts) → its toggle
    // is never rendered, so picking a node always opens the Connect dialog.
    expect(screen.queryByRole("switch", { name: "Smart connect" })).toBeNull()
    fireEvent.click(auto)
    expect(localStorage.getItem("nodaro:autoConnect")).toBe("0")
  })

  it("never shows the Smart toggle, regardless of Auto Connect state", () => {
    renderPopup({ autoConnectCtx: focusedCtx, onPickType: vi.fn() })
    // Auto on by default (where Smart used to appear) → still hidden.
    expect(screen.queryByRole("switch", { name: "Smart connect" })).toBeNull()
    fireEvent.click(screen.getByRole("switch", { name: "Auto-connect" })) // flip Auto off
    expect(screen.queryByRole("switch", { name: "Smart connect" })).toBeNull()
  })

  it("hides BOTH toggles when nothing is focused (no autoConnectCtx)", () => {
    renderPopup() // generic Tab / sidebar add — no node to connect to
    expect(screen.queryByRole("switch", { name: "Auto-connect" })).toBeNull()
    expect(screen.queryByRole("switch", { name: "Smart connect" })).toBeNull()
  })

  it("surfaces model hits in search (e.g. a Flux variant 'creates …')", () => {
    renderPopup()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "flux" } })
    // VariantRow renders "creates <Node>" — proves models are merged into search.
    expect(screen.getAllByText(/^creates /i).length).toBeGreaterThan(0)
  })

  it("media-tab search includes OTHER-kind models too (ordered, never filtered out)", () => {
    renderPopup()
    fireEvent.click(tab("Image"))
    // "suno" is an audio model — it must still appear on the Image tab.
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: "suno" } })
    expect(screen.getAllByText(/^creates /i).length).toBeGreaterThan(0)
  })
})

describe("SEARCH_BLOCK_ORDER invariant", () => {
  it("covers every tab with a permutation of the three blocks", () => {
    const blocks: SearchBlock[] = ["nodeOwn", "models", "nodeOther"]
    for (const t of ADD_NODE_MENU_TABS) {
      const order = SEARCH_BLOCK_ORDER[t]
      expect(order, `missing order for tab ${t}`).toBeTruthy()
      expect([...order].sort()).toEqual([...blocks].sort())
    }
  })
})

describe("AddNodePopup auto-connect (cont.)", () => {
  it("hands off to onPickType (not onAddNode) when picking in auto-connect mode", () => {
    const onPickType = vi.fn()
    const { onAddNode } = renderPopup({
      autoConnectCtx: { nodeId: "n1", nodeType: "text-prompt", focusedLabel: "Hero Prompt", sourceHandles: ["prompt"], targetHandles: ["in"] },
      onPickType,
    })
    fireEvent.change(screen.getByPlaceholderText("Search nodes..."), { target: { value: "generate image" } })
    const row = screen.getAllByRole("button").find((b) => (b.textContent ?? "").startsWith("Generate Image"))
    expect(row).toBeTruthy()
    fireEvent.click(row!)
    expect(onPickType).toHaveBeenCalledWith("generate-image")
    expect(onAddNode).not.toHaveBeenCalled()
  })
})
