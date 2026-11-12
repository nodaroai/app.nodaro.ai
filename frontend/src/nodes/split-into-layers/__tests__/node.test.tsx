// The Split into Layers node's face: its four pips, the dropzone when nothing is
// wired, and under the base each layer as a named thumbnail that opens the preview.
import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

const kit = vi.hoisted(() => ({ isSettingsOpen: false, videoAutoplay: false, updateNodeData: vi.fn(), run: vi.fn(), toggleSettings: vi.fn(), openFreeCut: vi.fn() }))

vi.mock("@xyflow/react", () => ({ Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" } }))
vi.mock("@/components/nodes/base-node", () => ({ BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div> }))
vi.mock("@/components/nodes/handle-with-popover", () => ({
  HANDLE_COLORS: { image: "image", look: "look" },
  HandleWithPopover: ({ handleId, type, label }: any) => <div data-testid={`pip-${type}-${handleId}`}>{label}</div>,
}))
vi.mock("@/components/nodes/run-node-button", () => ({ RunNodeButton: () => null }))
vi.mock("@/components/nodes/editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("@/components/nodes/node-job-progress", () => ({ NodeJobProgress: () => null }))
vi.mock("@/components/nodes/use-unit-node-kit", () => ({ useUnitNodeKit: () => kit }))
vi.mock("@/components/nodes/use-unit-upstream-output", () => ({ useUnitUpstreamOutput: () => undefined }))
vi.mock("@/components/editor/media-preview-modal", () => ({
  MediaPreviewModal: ({ isOpen, url }: any) => (isOpen ? <div data-testid="preview">{url}</div> : null),
}))
vi.mock("@/components/ui/cached-image", () => ({ CachedImage: ({ src, alt }: any) => <img src={src} alt={alt} /> }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))
vi.mock("@/hooks/use-file-upload", () => ({ useFileUpload: () => ({ upload: vi.fn(), isUploading: false, uploadError: null }) }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({ useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: vi.fn() }) }))
vi.mock("@/hooks/use-upstream-image-aspect", () => ({ useUpstreamImageAspect: () => undefined }))
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: () => 94 }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

import { NodeComponent as SplitIntoLayersNode } from "../node"
import { definition } from "../definition.generated"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
const renderNode = (data: Record<string, unknown>) =>
  render(<SplitIntoLayersNode {...({ id: "split", data: { ...definition.defaultData, ...data }, selected: false } as any)} />)

const BASE = "https://r2.test/base.png"
const LAYERS = ["https://r2.test/l1.png", "https://r2.test/l2.png", "https://r2.test/l3.png"]
const RUN = {
  executionStatus: "completed",
  generatedImageUrl: BASE,
  generatedResults: [{ url: BASE, jobId: "job-1", timestamp: "2026-11-11T10:00:00.000Z" }],
  activeResultIndex: 0,
  generatedLayerUrls: LAYERS,
  generatedLayerData: [
    { name: "Fox", zIndex: 1, url: LAYERS[0] },
    { zIndex: 2, url: LAYERS[1] },
    { name: "Title", zIndex: 3, url: LAYERS[2] },
  ],
}

afterEach(() => cleanup())

describe("SplitIntoLayersNode", () => {
  it("its pips: Image in; Base, Layers and Layer data out", () => {
    renderNode({})
    expect(screen.getByTestId("pip-target-image").textContent).toBe("Image")
    expect(screen.getByTestId("pip-source-base").textContent).toBe("Base")
    expect(screen.getByTestId("pip-source-layers").textContent).toBe(t("splitIntoLayers.pipLayers"))
    expect(screen.getByTestId("pip-source-layerData").textContent).toBe(t("splitIntoLayers.pipLayerData"))
  })

  it("empty: asks for an image to choose or wire, and shows no layers", () => {
    renderNode({})
    expect(screen.getByText(t("splitIntoLayers.chooseOrWire"))).toBeTruthy()
    expect(screen.queryByTestId("split-layers-strip")).toBeNull()
  })

  it("after a run: the base, then each layer as a thumbnail named from the layer data (else its number)", () => {
    renderNode(RUN)
    expect(screen.getByRole("img", { name: definition.defaultData.label }).getAttribute("src")).toBe(BASE)
    expect(screen.getByText(t("splitIntoLayers.layersCount", { n: 3 }))).toBeTruthy()
    const names = screen.getAllByRole("button", { name: /^Open / }).map((b) => b.getAttribute("title"))
    expect(names).toEqual(["Fox", t("splitIntoLayers.layerN", { n: 2 }), "Title"])
  })

  it("clicking a layer opens it in the preview", () => {
    renderNode(RUN)
    fireEvent.click(screen.getByRole("button", { name: t("splitIntoLayers.openLayer", { name: "Title" }) }))
    expect(screen.getByTestId("preview").textContent).toBe(LAYERS[2])
  })

  it("shows the active take's own layers when the take carries them", () => {
    const older = ["https://r2.test/old-1.png"]
    renderNode({
      ...RUN,
      generatedResults: [
        { url: BASE, jobId: "job-2", timestamp: "2026-11-11T11:00:00.000Z", generatedLayerUrls: LAYERS, generatedLayerData: RUN.generatedLayerData },
        { url: "https://r2.test/old-base.png", jobId: "job-1", timestamp: "2026-11-11T10:00:00.000Z", generatedLayerUrls: older, generatedLayerData: [{ name: "Old", zIndex: 1, url: older[0] }] },
      ],
      activeResultIndex: 1,
    })
    const names = screen.getAllByRole("button", { name: /^Open / }).map((b) => b.getAttribute("title"))
    expect(names).toEqual(["Old"])
  })

  it("after a run once per picture: the active take's own picture's layers and count, never every picture's the wires hand on", () => {
    const second = ["https://r2.test/b-1.png"]
    const batch = {
      ...RUN,
      // The node's fields hold every picture's (what a wire hands on); each take its own.
      generatedLayerUrls: [...LAYERS, ...second],
      generatedLayerData: [...RUN.generatedLayerData.map((e) => ({ ...e, row: 0 })), { name: "Bee", zIndex: 1, url: second[0], row: 1 }],
      layersNotSaved: 3,
      __listResults: [BASE, "https://r2.test/b.png"],
      generatedResults: [
        { url: BASE, jobId: "job-1", timestamp: "2026-11-11T11:00:00.000Z", generatedLayerUrls: LAYERS, generatedLayerData: RUN.generatedLayerData, layersNotSaved: 0 },
        { url: "https://r2.test/b.png", jobId: "job-2", timestamp: "2026-11-11T11:00:00.000Z", generatedLayerUrls: second, generatedLayerData: [{ name: "Bee", zIndex: 1, url: second[0] }], layersNotSaved: 3 },
      ],
    }
    renderNode({ ...batch, activeResultIndex: 0 })
    expect(screen.getAllByRole("button", { name: /^Open / }).map((b) => b.getAttribute("title"))).toEqual(["Fox", t("splitIntoLayers.layerN", { n: 2 }), "Title"])
    expect(screen.queryByRole("status")).toBeNull()
    cleanup()
    renderNode({ ...batch, activeResultIndex: 1 })
    expect(screen.getAllByRole("button", { name: /^Open / }).map((b) => b.getAttribute("title"))).toEqual(["Bee"])
    expect(screen.getByRole("status").textContent).toBe(t("splitIntoLayers.layersNotSaved", { failed: 3, total: 4 }))
  })

  it("nothing when the run made no layers (null)", () => {
    renderNode({ ...RUN, generatedLayerUrls: null, generatedLayerData: null })
    expect(screen.queryByTestId("split-layers-strip")).toBeNull()
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("layers that could not be saved: a notice counting them out of all the run made — none when every one was", () => {
    renderNode({ ...RUN, layersNotSaved: 2 })
    expect(screen.getByRole("status").textContent).toBe(t("splitIntoLayers.layersNotSaved", { failed: 2, total: 5 }))
    cleanup()
    renderNode({ ...RUN, layersNotSaved: 0 })
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("the notice follows the active take, and shows even when no layer could be saved", () => {
    renderNode({
      ...RUN,
      layersNotSaved: 4,
      generatedResults: [
        { url: BASE, jobId: "job-2", timestamp: "2026-11-11T11:00:00.000Z", generatedLayerUrls: LAYERS, generatedLayerData: RUN.generatedLayerData, layersNotSaved: 0 },
        { url: "https://r2.test/old-base.png", jobId: "job-1", timestamp: "2026-11-11T10:00:00.000Z", generatedLayerUrls: null, generatedLayerData: null, layersNotSaved: 3 },
      ],
      activeResultIndex: 0,
    })
    expect(screen.queryByRole("status")).toBeNull()
    cleanup()
    renderNode({ ...RUN, generatedLayerUrls: null, generatedLayerData: null, layersNotSaved: 3 })
    expect(screen.getByRole("status").textContent).toBe(t("splitIntoLayers.layersNotSaved", { failed: 3, total: 3 }))
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull()
  })
})
