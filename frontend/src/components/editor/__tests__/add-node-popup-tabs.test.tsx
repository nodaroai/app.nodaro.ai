import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

// Full-render tests can exceed the default 5s on slow CI runners (precedent:
// person-picker, #3223) — scope a higher timeout to this file only.
vi.setConfig({ testTimeout: 15000 })

// ---------------------------------------------------------------------------
// Mocks — lucide-react needs an explicit export list (Proxy-based mocks can
// hang vitest during ESM resolution of large named-import destructuring).
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => {
  const I = () => null
  return {
    Type: I, List: I, BookOpen: I, ImageIcon: I, Film: I,
    Merge: I, Upload: I, Video: I, Rss: I, Palette: I,
    PaintBucket: I, Server: I, Hash: I, Clock: I, RatioIcon: I,
    Mic: I, ShieldCheck: I, Volume2: I, VolumeX: I, Captions: I, Maximize: I,
    AudioLines: I, Music: I, SlidersHorizontal: I, Scissors: I,
    HardDrive: I, Webhook: I, Clapperboard: I, UserPlus: I,
    Package: I, MapPin: I, ChevronRight: I, Search: I, Download: I,
    ArrowLeft: I, Wand2: I, Layers: I, Users: I, Waypoints: I,
    ArrowUpFromLine: I, FileText: I, Disc3: I, FastForward: I,
    Smile: I, Sparkles: I, Repeat: I, Gauge: I, SunDim: I,
    RefreshCw: I, Shapes: I, Box: I, AudioWaveform: I, Eye: I,
    Languages: I, AlignLeft: I, Workflow: I, LogIn: I, LogOut: I, Share2: I,
    Instagram: I, Youtube: I, Linkedin: I, Twitter: I, Facebook: I, StickyNote: I, UserRound: I, Send: I,
    GitBranch: I, Puzzle: I, MessageSquare: I, Frame: I, ZoomIn: I, Eraser: I, ListMusic: I,
    Globe: I, Braces: I, Filter: I, Funnel: I, ListFilter: I, CopyMinus: I, GitMerge: I,
    ArrowUpDown: I,
    Aperture: I, Lightbulb: I, SwatchBook: I, CloudFog: I, Brush: I,
    Mountain: I, PersonStanding: I, Gem: I,
    PawPrint: I, Car: I, Swords: I, Armchair: I,
    Camera: I, Hourglass: I, Cpu: I, LayoutDashboard: I, HandMetal: I,
    Zap: I,
    Activity: I, Piano: I, User: I, MessageCircle: I,
    ScanFace: I,
    VenetianMask: I,
    TrendingUp: I, Star: I,
    ListTree: I,
    LayoutGrid: I,
    Link2: I,
    // ModelsTab (rendered when the "Models" tab is active) imports these.
    Folder: I, Image: I,
  }
})

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
  it("renders the six tabs in order with Common active by default", () => {
    renderPopup()
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Common",
      "Image",
      "Video",
      "Audio",
      "Models",
      "All",
    ])
    expect(tab("Common")).toHaveAttribute("aria-selected", "true")
    expect(tab("All")).toHaveAttribute("aria-selected", "false")
    // Curated common content shows at root: lead node + Common Pickers nav row
    expect(screen.getByText("Common Pickers")).toBeInTheDocument()
    expect(screen.getByText("Generate Image")).toBeInTheDocument()
  })

  it("Video tab lists common video nodes first, then the rest under More", () => {
    renderPopup()
    fireEvent.click(tab("Video"))
    expect(tab("Video")).toHaveAttribute("aria-selected", "true")
    expect(localStorage.getItem(ADD_NODE_MENU_TAB_KEY)).toBe("video")
    const rows = screen.getAllByRole("button").map((b) => b.textContent ?? "")
    const uploadVideo = rows.indexOf("Upload Video")
    const generateVideo = rows.indexOf("Generate Video")
    const videoToVideo = rows.indexOf("Video to Video")
    expect(uploadVideo).toBeGreaterThanOrEqual(0)
    expect(uploadVideo).toBeLessThan(generateVideo)
    expect(generateVideo).toBeLessThan(videoToVideo)
    expect(screen.getByText("More")).toBeInTheDocument()
    // Image-only and plan-emitting nodes don't belong here
    expect(rows).not.toContain("Generate Image")
    expect(rows).not.toContain("After Effects")
  })

  it("Image and Audio tabs show their producers", () => {
    renderPopup()
    fireEvent.click(tab("Image"))
    expect(screen.getByText("Upload Image")).toBeInTheDocument()
    expect(screen.getByText("Remove Background")).toBeInTheDocument()
    expect(screen.queryByText("Generate Video")).toBeNull()
    fireEvent.click(tab("Audio"))
    expect(screen.getByText("Text to Speech")).toBeInTheDocument()
    expect(screen.getByText("Generate Music")).toBeInTheDocument()
    expect(screen.queryByText("Upload Image")).toBeNull()
  })

  it("All tab shows the root categories without COMMON and persists the choice", () => {
    renderPopup()
    fireEvent.click(tab("All"))
    expect(tab("All")).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("INPUT")).toBeInTheDocument()
    expect(screen.getByText("TRIGGERS")).toBeInTheDocument()
    expect(screen.queryByText("COMMON")).toBeNull()
    expect(localStorage.getItem(ADD_NODE_MENU_TAB_KEY)).toBe("all")
  })

  it("restores the last tab choice from localStorage", () => {
    localStorage.setItem(ADD_NODE_MENU_TAB_KEY, "video")
    renderPopup()
    expect(tab("Video")).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("Upload Video")).toBeInTheDocument()
  })

  it("Tab key cycles forward through the modes and persists", () => {
    renderPopup()
    fireEvent.keyDown(document, { key: "Tab" })
    expect(tab("Image")).toHaveAttribute("aria-selected", "true")
    expect(localStorage.getItem(ADD_NODE_MENU_TAB_KEY)).toBe("image")
    fireEvent.keyDown(document, { key: "Tab" })
    expect(tab("Video")).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(document, { key: "Tab" })
    fireEvent.keyDown(document, { key: "Tab" })
    expect(tab("Models")).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(document, { key: "Tab" })
    expect(tab("All")).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(document, { key: "Tab" })
    expect(tab("Common")).toHaveAttribute("aria-selected", "true")
  })

  it("Shift+Tab cycles backward and wraps", () => {
    renderPopup()
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(tab("All")).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(tab("Models")).toHaveAttribute("aria-selected", "true")
  })

  it("Escape returns to root from an inner category, then closes at root", () => {
    const { onClose } = renderPopup()
    fireEvent.click(tab("All"))
    fireEvent.click(screen.getByText("AI"))
    // Drilled into the AI category
    expect(screen.getByText("Generate Script")).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    // Back at the All root — popup still open
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText("INPUT")).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })

  it("Escape returns from Common Pickers to the Common root", () => {
    const { onClose } = renderPopup()
    fireEvent.click(screen.getByText("Common Pickers"))
    expect(screen.getByText("Camera Motion")).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText("Common Pickers")).toBeInTheDocument()
    expect(screen.getByText("Generate Image")).toBeInTheDocument()
  })

  it("switching to Common while drilled into a category returns to the Common root", () => {
    renderPopup()
    fireEvent.click(tab("All"))
    fireEvent.click(screen.getByText("AI"))
    fireEvent.click(tab("Common"))
    expect(screen.getByText("Common Pickers")).toBeInTheDocument()
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

  it("search on a media tab lists its own results first, then an Other section", () => {
    renderPopup()
    fireEvent.click(tab("Video"))
    fireEvent.change(screen.getByPlaceholderText("Search nodes..."), { target: { value: "video" } })
    expect(screen.getByText("Other")).toBeInTheDocument()
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
