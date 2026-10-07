/**
 * The gallery, fullscreen and compare views of an app show a render's Preview
 * label (F1), read through `isPreview` from the take on show: the same read the
 * output cards make (render-preview.ts), never the node's Quality setting.
 */
import { render, screen, within } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { GalleryView } from "../gallery-view"
import { FullscreenView } from "../fullscreen-view"
import { CompareView } from "../compare-view"
import type { WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id } }) as WorkflowNode

const CUT = "https://m/cut.mp4"
const OTHER = "https://m/other.mp4"
const RESULTS: Record<string, { url?: string }> = { cut: { url: CUT }, other: { url: OTHER }, src: { url: "https://m/src.mp4" } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const baseProps: any = {
  orderedInputNodes: [node("src", "upload-video")],
  orderedOutputNodes: [node("cut", "apply-edl"), node("other", "generate-video")],
  getNodeStatus: () => "completed",
  getResult: (id: string) => RESULTS[id] ?? {},
  getCardTitle: (n: WorkflowNode) => n.id,
  onBack: () => {},
  isPreview: (nodeId: string, url?: string) => nodeId === "cut" && (url === undefined || url === CUT),
}

describe("GalleryView", () => {
  it("labels the tile of a Preview render and no other", () => {
    render(<GalleryView {...baseProps} />)
    expect(screen.getAllByText("Preview")).toHaveLength(1)
  })
  it("shows no label when the view is not told about previews", () => {
    render(<GalleryView {...baseProps} isPreview={undefined} />)
    expect(screen.queryByText("Preview")).toBeNull()
  })
})

describe("FullscreenView", () => {
  it("labels a Preview render in the corner and not the next, final one", () => {
    render(<FullscreenView {...baseProps} initialNodeId="cut" />)
    expect(screen.getByText("Preview")).toBeInTheDocument()
  })
  it("shows no label on a take that is not a Preview", () => {
    render(<FullscreenView {...baseProps} initialNodeId="other" />)
    expect(screen.queryByText("Preview")).toBeNull()
  })
  it("reads the frozen run's take (resolveResult) by its own url", () => {
    const isPreview = (nodeId: string, url?: string) => nodeId === "cut" && url === "https://frozen/p.mp4"
    render(
      <FullscreenView
        {...baseProps}
        isPreview={isPreview}
        asOverlay
        initialNodeId="cut"
        resolveResult={(id: string) => (id === "cut" ? { url: "https://frozen/p.mp4" } : {})}
      />,
    )
    expect(screen.getByText("Preview")).toBeInTheDocument()
  })
})

describe("CompareView", () => {
  it("labels a Preview render on its side of the comparison", () => {
    const { container } = render(<CompareView {...baseProps} initialLeft="src" initialRight="cut" />)
    expect(within(container).getAllByText("Preview").length).toBeGreaterThan(0)
  })
  it("shows no label when neither side is a Preview", () => {
    render(<CompareView {...baseProps} initialLeft="src" initialRight="other" />)
    expect(screen.queryByText("Preview")).toBeNull()
  })
})
