// The canvas run, through the REAL unit kit (workflow-editor/unit-exec-kit.ts):
// the layers and layer data of an earlier run are emptied at the start, and the
// finished job's lands beside the base — what the server-run lanes land too.
import { describe, it, expect, vi } from "vitest"
import type { WorkflowNode } from "@/types/nodes"
import type { ExecutionContext } from "@/components/editor/workflow-editor/types"
import type { UnitExtraOutputFields } from "@/components/editor/workflow-editor/unit-exec-kit"

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
vi.mock("../api", () => ({ splitIntoLayersApi: vi.fn().mockResolvedValue({ jobId: "job-1" }) }))

import { createUnitExecKit } from "@/components/editor/workflow-editor/unit-exec-kit"
import { executor } from "../exec"
import { definition } from "../definition.generated"

const BASE = "https://r2.test/base.png"
const LAYERS = ["https://r2.test/l1.png", "https://r2.test/l2.png"]
const LAYER_DATA = [
  { name: "Fox", zIndex: 1, url: LAYERS[0], box: { x1: 10, y1: 20, x2: 110, y2: 220 } },
  { name: "Title", zIndex: 2, url: LAYERS[1] },
]

describe("a canvas run of Split into Layers lands its layers beside the base", () => {
  it("empties the side fields at the start and hands the poll a landing that maps the job's layers and layer data", async () => {
    const node = { id: "n1", type: definition.type, position: { x: 0, y: 0 }, data: { ...definition.defaultData, imageUrl: "https://media.test/own.png" } } as unknown as WorkflowNode
    const ctx = { userId: "user-1" } as unknown as ExecutionContext
    let landing: UnitExtraOutputFields | undefined
    const poll = vi.fn(async (_id: string, start: () => Promise<{ jobId: string }>, _key: unknown, _label: string, _ctx: ExecutionContext, extra?: UnitExtraOutputFields) => {
      await start()
      landing = extra
      return BASE
    })
    const updateNodeData = vi.fn()
    const kit = createUnitExecKit({
      node, ctx, inputs: {}, overrideMediaUrl: undefined, poll, pollJson: vi.fn(),
      setUserPromptTemplate: vi.fn(), getNodeData: () => node.data as Record<string, unknown>, updateNodeData,
    })

    await expect(executor.execute(node, kit)).resolves.toBe(BASE)
    expect(updateNodeData).toHaveBeenCalledWith("n1", { generatedLayerUrls: undefined, layersNotSaved: undefined, generatedLayerData: undefined })
    // …and the node-only fields its take lands with: nothing, since no earlier batch is held.
    expect(poll).toHaveBeenCalledWith("n1", expect.any(Function), "generatedImageUrl", definition.label, ctx, expect.any(Function), expect.any(Function))
    const nodeFields = (poll.mock.calls[0] as unknown as unknown[])[6] as UnitExtraOutputFields
    expect(nodeFields({ imageUrl: BASE })).toEqual({})

    // The job row: the base on imageUrl, each side output under its output's id,
    // and how many layers could not be stored under layersNotSaved.
    expect(landing!({ imageUrl: BASE, layers: LAYERS, layerData: LAYER_DATA, layerCount: 2, layersNotSaved: 0 })).toEqual({ generatedLayerUrls: LAYERS, layersNotSaved: 0, generatedLayerData: LAYER_DATA })
    expect(landing!({ imageUrl: BASE, layers: LAYERS, layerData: LAYER_DATA, layerCount: 2, layersNotSaved: 3 })).toEqual({ generatedLayerUrls: LAYERS, layersNotSaved: 3, generatedLayerData: LAYER_DATA })
    // A run that returned no layers says so (null), never an earlier run's.
    expect(landing!({ imageUrl: BASE })).toEqual({ generatedLayerUrls: null, layersNotSaved: null, generatedLayerData: null })
  })
})
