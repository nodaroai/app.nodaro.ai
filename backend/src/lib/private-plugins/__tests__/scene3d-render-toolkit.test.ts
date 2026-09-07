import { describe, expect, it, vi } from "vitest"
import type { Scene3DPlanV1 } from "@nodaro/shared"
import { createSceneRenderingToolkit, type SceneRenderPorts, type SceneRenderChild, type SceneRenderParent } from "../scene3d-render-toolkit.js"
import { validateSceneRenderRequest, sceneRenderChildId } from "../scene3d-render-identity.js"
import type { PluginSceneRenderInput } from "../scene3d-render-contract.js"
const plan: Scene3DPlanV1 = { planType: "3d-scene", schemaVersion: 1, revisionId: "00000000-0000-4000-8000-000000000000",
  width: 320, height: 180, fps: 24, durationInFrames: 96, backgroundColor: "#101010",
  camera: { position: [0,2,8], target: [0,1,0], focalLengthMm: 35, sensorWidthMm: 36 },
  objects: [{ id: "box", name: "Box", primitive: "box", dimensions: [1,1,1], position: [0,1,0], rotation: [0,0,0], scale: [1,1,1], color: "#eeeeee" }],
  lighting: { ambientIntensity: 0.5, keyIntensity: 1, keyPosition: [5,8,6] } }
function fixture() {
  const input: PluginSceneRenderInput = { parentJobId: "10000000-0000-4000-8000-000000000000", userId: "20000000-0000-4000-8000-000000000000",
    key: "validation-0", plan: structuredClone(plan), assets: "retained-revision", output: { kind: "stills", frames: [48,0,95] } }
  let parent: SceneRenderParent = { userId: input.userId, status: "processing", reservationActive: true, stopRequested: false }
  let child: SceneRenderChild | null = null
  let queue: { state: string; progress: number } | null = null
  const ports: SceneRenderPorts = {
    parent: vi.fn(async () => parent), read: vi.fn(async () => child),
    create: vi.fn(async (request) => child ??= { id: request.childJobId, parentJobId: input.parentJobId, userId: input.userId,
      inputHash: request.inputHash, status: "pending", shouldWatermark: false, input: request.input }),
    authorizeAssets: vi.fn(async () => {}),
    enqueue: vi.fn(async () => { queue = { state: "waiting", progress: 0 } }),
    queue: vi.fn(async () => queue),
    cancel: vi.fn(async () => { if (child) child = { ...child, status: "cancelled" }; if (queue?.state !== "active") queue = null }),
  }
  return { input, ports, tk: createSceneRenderingToolkit(ports), child: () => child!,
    parent: (patch: Partial<SceneRenderParent>) => { parent = { ...parent, ...patch } },
    setChild: (patch: Partial<SceneRenderChild>) => { child = { ...child!, ...patch } },
    queue: (value: typeof queue) => { queue = value } }
}

describe("durable scene render children", () => {
  it("sorts a cloned frame list and adopts the same queued child on replay", async () => {
    const f = fixture(), first = await f.tk.submit(f.input), second = await f.tk.submit(f.input)
    expect(second).toEqual({ childJobId: first.childJobId, adopted: true })
    expect(f.ports.create).toHaveBeenCalledOnce()
    expect(f.ports.enqueue).toHaveBeenCalledOnce()
    expect(f.child().input.output).toEqual({ kind: "stills", frames: [0,48,95] })
    expect(f.input.output).toEqual({ kind: "stills", frames: [48,0,95] })
  })
  it("binds work to scope and refuses changed inputs under the same key", async () => {
    const f = fixture()
    await f.tk.submit(f.input)
    await expect(f.tk.submit({ ...f.input, output: { kind: "video" } })).rejects.toThrow("conflicts")
    expect(f.ports.enqueue).toHaveBeenCalledOnce()
    expect(sceneRenderChildId({ ...f.input, userId: "30000000-0000-4000-8000-000000000000" })).not.toBe(sceneRenderChildId(f.input))
  })
  it.each([{ status: "cancelled" }, { reservationActive: false }, { stopRequested: true }, { userId: "foreign" }])
    ("refuses an unavailable parent before creating or enqueueing work: %j", async (patch) => {
      const f = fixture(); f.parent(patch)
      await expect(f.tk.submit(f.input)).rejects.toThrow()
      expect(f.ports.create).not.toHaveBeenCalled()
      expect(f.ports.enqueue).not.toHaveBeenCalled()
    })
  it("cancels the child if the parent is cancelled during insertion", async () => {
    const f = fixture()
    vi.mocked(f.ports.create).mockImplementation(async (request) => {
      const child = { id: request.childJobId, parentJobId: f.input.parentJobId, userId: f.input.userId,
        inputHash: request.inputHash, status: "pending", shouldWatermark: false, input: request.input }
      f.setChild(child); f.parent({ status: "cancelled" }); return child
    })
    await expect(f.tk.submit(f.input)).rejects.toThrow("no longer active")
    expect(f.ports.cancel).toHaveBeenCalledOnce()
    expect(f.ports.enqueue).not.toHaveBeenCalled()
  })
  it("never equates a cancelled row with a drained Chromium worker", async () => {
    const f = fixture(); await f.tk.submit(f.input)
    f.queue({ state: "active", progress: 42 })
    expect(await f.tk.cancel(f.input)).toMatchObject({ state: "cancelled", drained: false, progress: 42 })
    f.queue({ state: "completed", progress: 42 })
    expect(await f.tk.status(f.input)).toMatchObject({ state: "cancelled", drained: true })
  })
  it("does not enqueue a processing row with a missing worker receipt", async () => {
    const f = fixture(); await f.tk.submit(f.input)
    f.setChild({ status: "processing" }); f.queue(null)
    await expect(f.tk.submit(f.input)).rejects.toThrow("receipt is missing")
    expect(f.ports.enqueue).toHaveBeenCalledOnce()
  })
  it("does not restart a drained queue record whose DB completion is unresolved", async () => {
    const f = fixture(); await f.tk.submit(f.input)
    f.queue({ state: "completed", progress: 100 })
    await expect(f.tk.submit(f.input)).rejects.toThrow("outcome is unresolved")
    expect(f.ports.enqueue).toHaveBeenCalledOnce()
  })
  it.each([[[96]], [[0,0]], [Array.from({ length: 25 }, (_, i) => i)], [[-1]]])("rejects invalid still frames %j", async (frames) => {
    const f = fixture()
    await expect(validateSceneRenderRequest({ ...f.input, output: { kind: "stills", frames } })).rejects.toThrow()
  })
  it("refuses abort before any admission work", async () => {
    const f = fixture()
    await expect(f.tk.submit(f.input, { signal: AbortSignal.abort() })).rejects.toThrow()
    expect(f.ports.parent).not.toHaveBeenCalled()
  })
})
