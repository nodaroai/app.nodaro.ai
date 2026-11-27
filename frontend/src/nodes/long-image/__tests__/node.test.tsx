// The Long Image node's face: its pips (the prompt, three product pictures, the
// style and subject pictures in; the picture out), what it makes in its mode
// before a run, and a card that never grows past a portrait shape however tall
// the picture is (the whole page opens in the preview).
import { describe, it, expect, vi, afterEach } from "vitest"
import type { ReactNode } from "react"
import type { NodeProps } from "@xyflow/react"
import { cleanup, render, screen } from "@testing-library/react"

const m = vi.hoisted(() => ({
  kit: { isSettingsOpen: false, videoAutoplay: false, updateNodeData: vi.fn(), run: vi.fn(), toggleSettings: vi.fn(), openFreeCut: vi.fn() },
  baseProps: [] as Array<Record<string, unknown>>,
  resultAspect: undefined as number | undefined,
  wired: new Set<string>(),
  creditIds: [] as string[],
}))

vi.mock("@xyflow/react", () => ({ Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" } }))
vi.mock("@/components/nodes/base-node", () => ({
  BaseNode: (props: Record<string, unknown> & { children?: ReactNode }) => {
    m.baseProps.push(props)
    return <div data-testid="base-node">{props.children}</div>
  },
}))
vi.mock("@/components/nodes/handle-with-popover", () => ({
  HANDLE_COLORS: { image: "image" },
  TEXT_HANDLE_COLOR: "text",
  HandleWithPopover: ({ handleId, type, label }: { handleId: string; type: string; label: string }) => <div data-testid={`pip-${type}-${handleId}`}>{label}</div>,
}))
vi.mock("@/components/nodes/run-node-button", () => ({ RunNodeButton: () => null }))
vi.mock("@/components/nodes/editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("@/components/nodes/node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("@/components/nodes/use-unit-node-kit", () => ({ useUnitNodeKit: () => m.kit }))
vi.mock("@/components/editor/media-preview-modal", () => ({ MediaPreviewModal: () => null }))
vi.mock("@/components/ui/cached-image", () => ({ CachedImage: ({ src, alt }: { src?: string; alt?: string }) => <img src={src} alt={alt} /> }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({ useResultAspectRatio: () => ({ aspectRatio: m.resultAspect, onLoadDimensions: vi.fn() }) }))
vi.mock("@/hooks/use-handle-connections", () => ({ useHandleConnections: (_n: string, handle: string) => (m.wired.has(handle) ? [{ edgeId: "e" }] : []) }))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  useModelCredits: (id: string) => {
    m.creditIds.push(id)
    return 296
  },
}))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

import { NodeComponent as LongImageNode } from "../node"
import { definition } from "../definition.generated"
import { translate } from "@/lib/i18n"
import { VIDEO_NODE_MIN_WIDTH } from "@/components/nodes/video-node-defaults"

const t = (key: Parameters<typeof translate>[1]) => translate("en", key)
const renderNode = (data: Record<string, unknown>) =>
  render(<LongImageNode {...({ id: "long", data: { ...definition.defaultData, ...data }, selected: false } as unknown as NodeProps)} />)

afterEach(() => {
  cleanup()
  m.baseProps.length = 0
  m.creditIds.length = 0
  m.resultAspect = undefined
  m.wired = new Set()
})

describe("LongImageNode", () => {
  it("renders every pip the manifest declares", () => {
    renderNode({})
    for (const input of definition.handles.inputs) expect(screen.getByTestId(`pip-target-${input.id}`).textContent).toBe(input.label)
    for (const output of definition.handles.outputs) expect(screen.getByTestId(`pip-source-${output.id}`).textContent).toBe(output.label)
  })

  it("before a run: what it makes in its mode", () => {
    renderNode({})
    expect(screen.getByText(t("longImage.modeWebpage"))).toBeTruthy()
    cleanup()
    renderNode({ mode: "ecommerce" })
    expect(screen.getByText(t("longImage.emptyHintEcommerce"))).toBeTruthy()
  })

  it("a page far taller than wide keeps the card at a portrait shape, never its own", () => {
    m.resultAspect = 1 / 15
    renderNode({ executionStatus: "completed", generatedImageUrl: "https://r2.test/page.jpg", generatedResults: [{ url: "https://r2.test/page.jpg", jobId: "j1", width: 2048, height: 30720 }] })
    const props = m.baseProps.at(-1)!
    expect(props.imageAspectRatio).toBeCloseTo(9 / 16)
    expect(props.minHeight as number).toBeLessThanOrEqual(Math.round(VIDEO_NODE_MIN_WIDTH / (9 / 16)))
    expect(screen.getByRole("img", { name: definition.defaultData.label }).getAttribute("src")).toBe("https://r2.test/page.jpg")
  })

  it("its Run price counts the mode's wired picture inputs", () => {
    m.wired = new Set(["styleImage", "productImage1"])
    renderNode({ resolution: "1K" })
    expect(m.creditIds.at(-1)).toBe("long-image:webpage:1K:1ref")
  })
})
