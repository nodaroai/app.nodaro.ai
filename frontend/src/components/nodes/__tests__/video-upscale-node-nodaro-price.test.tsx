import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { NodeProps } from "@xyflow/react"

/**
 * Video Upscale → Nodaro Video Upscale: the Run button's price. The figure
 * is the server's price for the whole run — the
 * tier's four-second row × billed seconds ÷ 4, rounded up once and marked up
 * once, exactly as the run is charged — and there is NO figure until it
 * arrives: never the one-unit price × whole units (which reads above the
 * charge), never 0. Marked ≈: the run measures the clip itself.
 */

/** The served prices: what `GET /v1/credits/model-cost` has answered so far. */
const served = vi.hoisted(() => ({ prices: {} as Record<string, number>, asked: [] as string[] }))
vi.mock("@/hooks/use-model-credit-cost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-model-credit-cost")>()),
  useModelCreditCost: (model: string | undefined) => {
    if (model) served.asked.push(model)
    return { data: model === undefined ? undefined : served.prices[model] }
  },
}))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasCredits: () => true,
}))
const quoted = vi.hoisted(() => ({ units: 2.5, refusedSec: undefined as number | undefined }))
vi.mock("@/hooks/use-video-upscale-quoted-units", () => ({
  useVideoUpscaleQuotedUnits: () => quoted.units,
  useNodaroVideoUpscaleRefusedSec: () => quoted.refusedSec,
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ updateNodeData: () => {}, runSingleNode: () => {}, openFreeCut: () => {}, videoAutoplay: false, nodes: [], edges: [] }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))
vi.mock("../base-node", () => ({
  BaseNode: ({ children, topToolbarContent }: { children: ReactNode; topToolbarContent: ReactNode }) => (
    <div>{topToolbarContent}{children}</div>
  ),
}))
vi.mock("../run-node-button", () => ({
  RunNodeButton: ({ credits, creditsEstimate }: { credits?: number; creditsEstimate?: boolean }) => (
    <div data-testid="run" data-credits={credits === undefined ? "none" : String(credits)} data-estimate={String(!!creditsEstimate)} />
  ),
}))
vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HandleWithPopover: () => null,
}))
vi.mock("../missing-refs-chip", () => ({ MissingRefsChip: () => null }))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../video-result-overlay", () => ({ VideoResultOverlay: () => null }))
vi.mock("@/components/editor/media-preview-modal", () => ({ MediaPreviewModal: () => null }))
vi.mock("@/hooks/use-result-aspect-ratio", () => ({
  useResultAspectRatio: () => ({ aspectRatio: undefined, onLoadDimensions: vi.fn() }),
}))

import { VideoUpscaleNode } from "../video-upscale-node"

const ROW_1080 = "nodaro-video-upscale:1080p:per-4s"
const ROW_4K = "nodaro-video-upscale:4k:per-4s"

function renderNode(data: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <VideoUpscaleNode {...({ id: "up", data: { label: "Upscale", provider: "nodaro-video-upscale", ...data }, selected: false } as unknown as NodeProps)} />
    </QueryClientProvider>,
  )
  return screen.getByTestId("run").dataset
}

beforeEach(() => {
  served.prices = {}
  served.asked = []
  quoted.units = 2.5
  quoted.refusedSec = undefined
})

describe("Nodaro Video Upscale price on the node", () => {
  it("shows no figure before the whole-run price is known — not 0, and not the one-unit price × whole units", () => {
    // Only the four-second row is known (a marked-up, rounded-up price): × 3 would read above the charge.
    served.prices = { [ROW_1080]: 17 }
    const run = renderNode({ targetResolution: "1080p" })
    expect(run.credits).toBe("none")
    expect(served.asked).toContain(`${ROW_1080}:2.5u`)
  })

  it("shows the server's whole-run price, marked ≈", () => {
    // 10 s at 1080p: the row × 10 s ÷ 4, rounded up once and marked up once.
    served.prices = { [ROW_1080]: 17, [`${ROW_1080}:2.5u`]: 42 }
    const run = renderNode({ targetResolution: "1080p" })
    expect(run.credits).toBe("42")
    expect(run.estimate).toBe("true")
  })

  it("prices the tier the node runs at", () => {
    quoted.units = 15
    served.prices = { [`${ROW_4K}:15u`]: 990 }
    expect(renderNode({ targetResolution: "4K" }).credits).toBe("990")
  })

  it("a four-second clip is the row's own price", () => {
    quoted.units = 1
    served.prices = { [ROW_1080]: 17 }
    expect(renderNode({ targetResolution: "1080p" }).credits).toBe("17")
  })

  it("a clip the graph knows is past 60 s shows no figure, and asks for none: that run is refused before anything is held", () => {
    // The units a refused clip is quoted at are never priced (`videoUpscalePricingUnits` gives 1).
    quoted.units = 1
    quoted.refusedSec = 75
    served.prices = { [ROW_1080]: 17 }
    const run = renderNode({ targetResolution: "1080p" })
    expect(run.credits).toBe("none")
    expect(served.asked.filter((id) => id.startsWith("nodaro-video-upscale"))).toEqual([])
  })
})
