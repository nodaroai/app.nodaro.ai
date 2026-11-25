/**
 * A published app's quick-field card once the deployment's availability answer
 * is in (the runner pages load it): a value this install cannot run is never
 * where an unset field is moved, a field whose every allowed value is
 * unavailable stays on screen saying so (it is what stops the run), and the
 * move that does happen re-prices the run on the option it lands on. A value
 * the node stores, or the user picked, is never moved.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/hooks/use-model-credit-cost", () => ({
  isModelRefused: () => false,
  isModelEstimate: () => false,
  refusedModelMessage: () => undefined,
  getCachedModelCredits: () => undefined,
  prefetchModelCreditCosts: vi.fn(async () => {}),
  isModelUnpriced: () => false,
  useModelCreditCost: vi.fn(),
  useModelCredits: () => 0,
  fetchModelCredits: vi.fn(),
}))

import { NODARO_VIDEO_UPSCALE_TRANSPARENT_MODE_ID } from "@nodaro/render-rules"
import { QuickFieldCard } from "../quick-field-card"
import { patchAsRunValues } from "../helpers"
import { getQuickConfigs, type NodeQuickConfigControl } from "@/components/nodes/node-quick-configs"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { computeLiveRunEstimate } from "@/hooks/use-live-run-estimate"
import type { WorkflowNode } from "@/types/nodes"

const control = (type: string, field: string): NodeQuickConfigControl => getQuickConfigs(type).find((c) => c.field === field)!
const UNAVAILABLE = "Not available on this deployment"

afterEach(() => __resetSurfaceAvailabilityForTests(null))

describe("an unset field is moved only onto an option this install can run", () => {
  it("Nodaro Video Upscale with Transparent the only allowed mode, where Transparent cannot run: left unset, never onto the greyed option", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [], modelModes: [NODARO_VIDEO_UPSCALE_TRANSPARENT_MODE_ID] })
    const onPatch = vi.fn()
    const c = control("video-upscale", "mode")
    render(<QuickFieldCard control={c} nodeData={{ provider: "nodaro-video-upscale" }} allowedValues={["transparent"]} onPatch={onPatch} />)
    expect(onPatch).not.toHaveBeenCalled()
    // The card stays, naming the field that stops the run and why.
    expect(screen.getByRole("combobox", { name: c.ariaLabel })).toHaveTextContent("Transparent")
    expect(screen.getByRole("note")).toHaveTextContent(UNAVAILABLE)
  })

  it("with an open allowed mode beside it, the card is the normal one", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [], modelModes: [NODARO_VIDEO_UPSCALE_TRANSPARENT_MODE_ID] })
    const onPatch = vi.fn()
    render(<QuickFieldCard control={control("video-upscale", "mode")} nodeData={{ provider: "nodaro-video-upscale" }} allowedValues={["transparent", "sharp"]} onPatch={onPatch} />)
    // Unset runs as Sharp here, which is allowed: nothing to move.
    expect(onPatch).not.toHaveBeenCalled()
    expect(screen.queryByRole("note")).toBeNull()
  })
})

describe("a field whose every allowed value is withheld here stays on screen", () => {
  it("a model list whose only allowed model this deployment withholds: shown with why, nothing written", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: ["wan"] })
    const onPatch = vi.fn()
    const c = control("video-to-video", "provider")
    const { container } = render(<QuickFieldCard control={c} nodeData={{}} allowedValues={["wan"]} onPatch={onPatch} />)
    expect(container).not.toBeEmptyDOMElement()
    expect(screen.getByRole("note")).toHaveTextContent(UNAVAILABLE)
    expect(onPatch).not.toHaveBeenCalled()
  })

  it("a lever the model does not have still renders nothing (not a deployment matter)", () => {
    const { container } = render(
      <QuickFieldCard control={control("video-to-video", "v2vResolution")} nodeData={{ provider: "runway-aleph" }} onPatch={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe("on a runner with the answer loaded: the move, and the estimate following it", () => {
  const v2v = (data: Record<string, unknown>) =>
    ({ id: "v", type: "video-to-video", position: { x: 0, y: 0 }, data: { label: "v", ...data } }) as unknown as WorkflowNode

  it("an unset model whose default (Seedance 2.5) is withheld moves to the first allowed open model, and the run is priced on it", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: ["seedance-2-5"] })
    const onPatch = vi.fn()
    render(<QuickFieldCard control={control("video-to-video", "provider")} nodeData={{}} allowedValues={["seedance-2-5", "wan"]} onPatch={onPatch} />)
    expect(onPatch).toHaveBeenCalledWith({ provider: "wan" })

    // The runner writes the move as the run's own input (never the saved node), and prices from it.
    const inputValues = { v: patchAsRunValues(onPatch.mock.calls[0]![0] as Record<string, unknown>) }
    const before = computeLiveRunEstimate({ nodes: [v2v({})], edges: [] }, () => undefined).uncachedModelIds
    const after = computeLiveRunEstimate({ nodes: [v2v({})], edges: [], inputValues }, () => undefined).uncachedModelIds
    expect(before.some((id) => id.startsWith("seedance-2-5"))).toBe(true)
    expect(after.some((id) => id.startsWith("wan"))).toBe(true)
    expect(after.some((id) => id.startsWith("seedance-2-5"))).toBe(false)
  })

  it("a model the node stores, or the user picked, is never moved — even one this deployment withholds", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: ["seedance-2-5"] })
    const onPatch = vi.fn()
    render(<QuickFieldCard control={control("video-to-video", "provider")} nodeData={{ provider: "seedance-2-5" }} allowedValues={["seedance-2-5", "wan"]} onPatch={onPatch} />)
    expect(onPatch).not.toHaveBeenCalled()
    const picked = vi.fn()
    render(<QuickFieldCard control={control("video-to-video", "provider")} nodeData={{ provider: "wan" }} allowedValues={["seedance-2-5", "wan"]} onPatch={picked} />)
    expect(picked).not.toHaveBeenCalled()
  })
})
