/**
 * The add-node popup opened by dropping a wire on empty canvas: it adds the
 * picked node and draws the wire on the pip a drop would use, but only when a
 * drop would accept it (`addNodeConnection`) — a node no pip of which takes
 * the wire is still added, unconnected, never wired into an input that refuses
 * it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

// Full-render tests can exceed the default 5s on slow CI runners (as in add-node-popup-tabs).
vi.setConfig({ testTimeout: 15000 })

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

// A Nodaro Cloud editor, which lists the UGC video nodes.
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasCredits: () => true,
}))

// The offer stays real unless a test says otherwise; the edge (`addNodeConnection`) is always real.
vi.mock("@/lib/node-compatibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/node-compatibility")>()
  return { ...actual, getCompatibleNodes: vi.fn(actual.getCompatibleNodes) }
})

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

const openPickerForNode = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ openPickerForNode }),
    { getState: () => ({ nodes: [] }) },
  ),
}))

vi.mock("../component-marketplace-modal", () => ({
  ComponentMarketplaceModal: () => null,
}))

import { AddNodePopup } from "../add-node-popup"
import { NODE_OPTIONS } from "@/lib/node-options"
import { getCompatibleNodes } from "@/lib/node-compatibility"

// The wire dropped from UGC Clips' clip tickets.
const FROM_CLIPS = { nodeId: "clips", handleId: "clips", direction: "source" as const, dropPosition: { x: 40, y: 80 }, nodeType: "ugc-clips" }

function renderPopup() {
  const onClose = vi.fn()
  const storeAddNode = vi.fn(() => "new")
  const storeOnConnect = vi.fn()
  render(
    <AddNodePopup
      open
      onClose={onClose}
      onAddNode={vi.fn()}
      position={{ x: 100, y: 100 }}
      connectionContext={FROM_CLIPS}
      storeAddNode={storeAddNode}
      storeOnConnect={storeOnConnect}
    />,
  )
  return { onClose, storeAddNode, storeOnConnect }
}

beforeEach(() => {
  localStorage.clear()
  // jsdom doesn't implement scrollIntoView (the popup's highlight-scroll effect).
  Element.prototype.scrollIntoView = vi.fn()
  openPickerForNode.mockClear()
})

afterEach(() => {
  cleanup()
  vi.mocked(getCompatibleNodes).mockReset()
})

describe("the add-node popup draws only the wire a drop would accept", () => {
  it("the node made to read the wire is added and wired on the pip a drop uses", async () => {
    const actual = await vi.importActual<typeof import("@/lib/node-compatibility")>("@/lib/node-compatibility")
    vi.mocked(getCompatibleNodes).mockImplementation(actual.getCompatibleNodes)
    const { storeAddNode, storeOnConnect, onClose } = renderPopup()
    fireEvent.click(screen.getByText("UGC Clip"))
    expect(storeAddNode).toHaveBeenCalledWith("ugc-clip", FROM_CLIPS.dropPosition, undefined)
    expect(storeOnConnect).toHaveBeenCalledWith({ source: "clips", sourceHandle: "clips", target: "new", targetHandle: "clip" })
    expect(openPickerForNode).toHaveBeenCalledWith("new", "ugc-clip")
    expect(onClose).toHaveBeenCalled()
  })

  it("a picked node no pip of which takes the wire is added unconnected: no edge is drawn", () => {
    // An offer that holds a node the drop refuses (UGC Script takes no clip ticket).
    const script = NODE_OPTIONS.find((o) => o.type === "ugc-script")!
    vi.mocked(getCompatibleNodes).mockReturnValue({ direct: [script], compatible: [], directTypes: new Set([script.type]) })
    const { storeAddNode, storeOnConnect, onClose } = renderPopup()
    fireEvent.click(screen.getByText("UGC Script"))
    expect(storeAddNode).toHaveBeenCalledWith("ugc-script", FROM_CLIPS.dropPosition, undefined)
    expect(storeOnConnect).not.toHaveBeenCalled()
    expect(openPickerForNode).toHaveBeenCalledWith("new", "ugc-script")
    expect(onClose).toHaveBeenCalled()
  })
})
