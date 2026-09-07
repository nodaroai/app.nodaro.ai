import { afterEach, describe, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({ store: vi.fn(), intents: vi.fn(), artifacts: vi.fn(), gc: vi.fn() }))
vi.mock("../private-plugins/scene3d-storage.js", () => ({ scene3DPrivateStore: mock.store }))
vi.mock("../../services/scene3d-artifacts/gc.js", () => ({ sweepExpiredScene3DUploadIntents: mock.intents,
  sweepExpiredScene3DArtifacts: mock.artifacts, runScene3DArtifactGcBatch: mock.gc }))
import { startScene3DArtifactCleanup } from "../scene3d-artifact-cleanup.js"
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })
describe("scene artifact cleanup lifecycle", () => {
  it("does nothing on a host without private scene storage", async () => {
    vi.useFakeTimers()
    mock.store.mockReturnValue(null)
    const stop = startScene3DArtifactCleanup(vi.fn())
    await vi.advanceTimersByTimeAsync(120_000)
    await stop()
    expect(mock.intents).not.toHaveBeenCalled()
  })
  it("joins a running sweep on close and never overlaps ticks", async () => {
    vi.useFakeTimers()
    const store = { bucket: "private" }
    mock.store.mockReturnValue(store)
    let resolve!: () => void
    mock.intents.mockReturnValue(new Promise<void>((r) => { resolve = r }))
    mock.gc.mockResolvedValue({ failed: 0, skipped: 0 })
    const stop = startScene3DArtifactCleanup(vi.fn())
    await vi.advanceTimersByTimeAsync(180_000)
    expect(mock.intents).toHaveBeenCalledOnce()
    let closed = false
    const closing = stop().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    resolve()
    await closing
    expect(mock.artifacts).toHaveBeenCalledOnce()
    expect(mock.gc).toHaveBeenCalledWith(store)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mock.intents).toHaveBeenCalledOnce()
  })
  it("retries after errors and reports incomplete cleanup without leaking storage details", async () => {
    vi.useFakeTimers()
    mock.store.mockReturnValue({ bucket: "private" })
    mock.intents.mockRejectedValueOnce(new Error("secret URL"))
    mock.gc.mockResolvedValue({ failed: 1, skipped: 2 })
    const report = vi.fn()
    const stop = startScene3DArtifactCleanup(report)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mock.intents).toHaveBeenCalledTimes(2)
    expect(report.mock.calls).toEqual([["Scene artifact cleanup failed; pending objects will be retried"],
      ["Scene artifact cleanup: 1 failed, 2 skipped"]])
    await stop()
  })
})
