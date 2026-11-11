/**
 * The Extend Video node card: its Run price (on the card and its quick strip)
 * quotes the row the run reserves on — the SAME mapping the config panel and
 * the pre-run estimate use (`getModelIdentifier` × `extendVideoPricingUnits`)
 * — and its empty state names the model the node runs, from the menu's own
 * labels. A Seedance extend used to quote its bare provider id, which has no
 * price row (the fallback figure showed), and every provider but Runway read
 * "VEO".
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import type { NodeProps } from "@xyflow/react"
import type { ReactNode } from "react"
import type { WorkflowNode } from "@/types/nodes"
import { EXTEND_VIDEO_MODELS } from "@nodaro/render-rules"

const quoted = vi.hoisted(() => [] as { id: string | undefined; units: number }[])
vi.mock("@/hooks/use-unit-quote-credits", () => ({
  useUnitQuoteCredits: (id: string | undefined, units: number) => {
    quoted.push({ id, units })
    return 0
  },
}))
vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) =>
    selector({ updateNodeData: () => {}, nodes: [], edges: [], videoAutoplay: false, openFreeCut: () => {}, runSingleNode: () => {}, selectNode: () => {}, selectedNodeId: null }),
}))
vi.mock("../base-node", () => ({ BaseNode: ({ children }: { children?: ReactNode }) => <div>{children}</div> }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-quick-strip", () => ({ NodeQuickStrip: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("../handle-with-popover", () => ({ HandleWithPopover: () => null, HANDLE_COLORS: {}, TEXT_HANDLE_COLOR: "" }))
vi.mock("../video-result-overlay", () => ({ VideoResultOverlay: () => null }))
vi.mock("@/components/editor/media-preview-modal", () => ({ MediaPreviewModal: () => null }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))

const { ExtendVideoNode } = await import("../extend-video-node")
const { getModelIdentifier } = await import("@/components/editor/config-panels/helpers")

afterEach(() => {
  cleanup()
  quoted.length = 0
})

function mount(data: Record<string, unknown>) {
  const nodeData = { label: "Extend Video", prompt: "she turns", fieldMappings: {}, ...data }
  render(<ExtendVideoNode {...({ id: "x1", type: "extend-video", data: nodeData, selected: false } as unknown as NodeProps)} />)
  return { quote: quoted.at(-1)!, node: { id: "x1", type: "extend-video", position: { x: 0, y: 0 }, data: nodeData } as unknown as WorkflowNode }
}

describe("Extend Video card — the Run price", () => {
  it("quotes each Seedance model on its own row for its seconds and resolution", () => {
    expect(mount({ provider: "seedance-2-5-extend", duration: 12, resolution: "1080p" }).quote).toEqual({ id: "seedance-2-5-extend:12s:1080p", units: 1 })
    expect(mount({ provider: "seedance-2-0-extend", duration: 12, resolution: "1080p" }).quote).toEqual({ id: "seedance-2-0-extend:12s:1080p", units: 1 })
    // Untouched: the model's default 8 s at 720p, as the run reserves.
    expect(mount({ provider: "seedance-2-5-extend" }).quote).toEqual({ id: "seedance-2-5-extend:8s:720p", units: 1 })
  })

  it("a node naming no provider quotes the VEO extend it runs, never the node-type row", () => {
    expect(mount({}).quote).toEqual({ id: "veo-extend", units: 1 })
    expect(mount({ model: "quality" }).quote).toEqual({ id: "veo-extend:quality", units: 1 })
  })

  it("a node on the retired id quotes the Seedance 2.5 row it runs as", () => {
    expect(mount({ provider: "seedance-2-extend", duration: 8 }).quote).toEqual({ id: "seedance-2-5-extend:8s:720p", units: 1 })
  })

  it("quotes the same row the panel and the pre-run estimate do, for every provider", () => {
    for (const data of [
      { provider: "seedance-2-5-extend", duration: 22, resolution: "480p" },
      { provider: "seedance-2-0-extend", duration: 25 },
      { provider: "ltx-2.3-pro", duration: 12 },
      { provider: "veo-extend", model: "quality" },
      { provider: "veo-extend" },
      { provider: "runway-extend" },
    ]) {
      const { quote, node } = mount(data)
      expect(quote.id, JSON.stringify(data)).toBe(getModelIdentifier(node))
    }
    // LTX 2.3 Pro: its per-second row × the seconds the run sends.
    expect(mount({ provider: "ltx-2.3-pro", duration: 12 }).quote).toEqual({ id: "ltx-2.3-pro-extend:per-second", units: 12 })
  })
})

describe("Extend Video card — the model it names", () => {
  it.each([
    ["seedance-2-5-extend", "Seedance 2.5 Extend"],
    ["seedance-2-0-extend", "Seedance 2.0 Extend"],
    ["seedance-2-extend", "Seedance 2.5 Extend"],
    ["ltx-2.3-pro", "LTX 2.3 Pro Extend"],
    ["runway-extend", "Runway Extend"],
    ["veo-extend", "VEO Extend"],
  ])("%s reads %s", (provider, text) => {
    mount({ provider })
    expect(screen.getByText(text)).toBeTruthy()
  })

  it("names every model of the menu once, never with the word doubled", () => {
    for (const m of EXTEND_VIDEO_MODELS) {
      cleanup()
      mount({ provider: m.value })
      const text = screen.getByText(/ Extend$/).textContent!
      expect(text, m.value).not.toMatch(/Extend Extend/)
      expect(text.startsWith(m.label.replace(/\s+Extend$/, "")), m.value).toBe(true)
    }
  })
})
