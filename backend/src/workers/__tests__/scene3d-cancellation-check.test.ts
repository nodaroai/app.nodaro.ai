import { afterEach, describe, expect, it, vi } from "vitest"
import { sceneRenderCancellationCheck } from "../scene3d-cancellation-check.js"
import { withRenderCancellation } from "../render-cancellation.js"
import type { SceneRenderChild, SceneRenderPorts } from "../../lib/private-plugins/scene3d-render-toolkit.js"
import { Scene3DArtifactError } from "../../services/scene3d-artifacts/types.js"

function fixture() {
  const child = { id: "child", status: "processing", input: { parentJobId: "parent", userId: "owner", key: "critic" } } as SceneRenderChild
  const read = vi.fn(async () => child)
  const parent = vi.fn(async () => ({ userId: "owner", status: "processing", reservationActive: true, stopRequested: false }))
  const check = sceneRenderCancellationCheck({ read, parent } as unknown as SceneRenderPorts, child)
  return { read, parent, check }
}
afterEach(() => vi.useRealTimers())
describe("scene render cancellation reads", () => {
  it("survives a transient read during a real cancellation loop", async () => {
    vi.useFakeTimers()
    const f = fixture(), cancel = vi.fn()
    f.parent.mockResolvedValueOnce({ userId: "owner", status: "processing", reservationActive: true, stopRequested: false })
      .mockRejectedValueOnce(new Error("Database unavailable"))
    const result = withRenderCancellation({ jobId: "child", timeoutMs: 1000, pollMs: 10, isCancelled: f.check, isDraining: () => false, cancel },
      () => new Promise<string>((resolve) => setTimeout(() => resolve("rendered"), 50)))
    await vi.advanceTimersByTimeAsync(60)
    expect(await result).toBe("rendered")
    expect(cancel).not.toHaveBeenCalled()
    expect(f.parent.mock.calls.length).toBeGreaterThan(2)
  })
  it("fails closed after five consecutive errors and resets the budget after a successful read", async () => {
    const f = fixture()
    f.read.mockRejectedValue(new Error("Read failed"))
    for (let i = 0; i < 4; i++) expect(await f.check()).toBe(false)
    await expect(f.check()).rejects.toThrow("Read failed")
    f.read.mockResolvedValueOnce({ id: "child", status: "processing" } as SceneRenderChild)
    expect(await f.check()).toBe(false)
    expect(await f.check()).toBe(false)
  })
  it("immediately stops after affirmative cancellation, lost reservation or workflow revocation", async () => {
    const f = fixture()
    f.parent.mockResolvedValueOnce({ userId: "owner", status: "cancelled", reservationActive: false, stopRequested: false })
    expect(await f.check()).toBe(true)
    f.parent.mockRejectedValueOnce(new Scene3DArtifactError("SCENE_JOB_INVALID", "Workflow access revoked"))
    expect(await f.check()).toBe(true)
  })
})
