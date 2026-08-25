import { describe, it, expect, vi, beforeEach } from "vitest"

// Each worker entrypoint runs its work at import time (top-level), so a fresh
// import per case (after vi.resetModules) re-evaluates it under these mocks. The
// entrypoints import their deps as `./…` paths, which resolve to the same module
// ids as the `@/…` specifiers vitest keys these mocks on.
const mocks = vi.hoisted(() => {
  const callOrder: string[] = []
  return {
    callOrder,
    loadOverlay: vi.fn(async () => {
      callOrder.push("loadOverlay")
      return { loaded: null }
    }),
    createVideoWorker: vi.fn(() => {
      callOrder.push("createVideoWorker")
      return { close: async () => {} }
    }),
    createRenderWorker: vi.fn(() => {
      callOrder.push("createRenderWorker")
      return { close: async () => {} }
    }),
    createOrchestratorWorker: vi.fn(() => {
      callOrder.push("createOrchestratorWorker")
      return { close: async () => {} }
    }),
    startPipelineWorker: vi.fn(() => {
      callOrder.push("startPipelineWorker")
      return { close: async () => {} }
    }),
  }
})

vi.mock("@/lib/overlay/load.js", () => ({ loadOverlay: mocks.loadOverlay }))
vi.mock("@/workers/video-worker.js", () => ({ createVideoWorker: mocks.createVideoWorker }))
vi.mock("@/workers/render-worker.js", () => ({ createRenderWorker: mocks.createRenderWorker }))
vi.mock("@/workers/orchestrator-worker.js", () => ({
  createOrchestratorWorker: mocks.createOrchestratorWorker,
}))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ logFfmpegVersion: () => {} }))
vi.mock("@/lib/worker-drain.js", () => ({ beginWorkerDrain: () => {} }))
// pipeline-worker.ts guards on hasCredits() then dynamic-imports the ee worker.
vi.mock("@/lib/config.js", async (imp) => ({
  ...(await imp<Record<string, unknown>>()),
  hasCredits: () => true,
}))
vi.mock("@/ee/workers/pipeline-worker.js", () => ({
  startPipelineWorker: mocks.startPipelineWorker,
}))

beforeEach(() => {
  mocks.callOrder.length = 0
  vi.resetModules()
})

describe("worker entrypoints load the overlay before constructing the worker", () => {
  it("worker.ts: loadOverlay runs before createVideoWorker", async () => {
    await import("@/worker.js")
    expect(mocks.callOrder).toEqual(["loadOverlay", "createVideoWorker"])
  })

  it("render-worker.ts: loadOverlay runs before createRenderWorker", async () => {
    await import("@/render-worker.js")
    expect(mocks.callOrder).toEqual(["loadOverlay", "createRenderWorker"])
  })

  it("orchestrator.ts: loadOverlay runs before createOrchestratorWorker", async () => {
    // The standalone `node dist/orchestrator.js` process runs the workflow DAG,
    // whose payload-builder applies the registered prompt policies — so it must
    // load the overlay before the worker starts consuming executions.
    await import("@/orchestrator.js")
    expect(mocks.callOrder).toEqual(["loadOverlay", "createOrchestratorWorker"])
  })

  it("pipeline-worker.ts: loadOverlay runs first, before the pipeline worker starts", async () => {
    await import("@/pipeline-worker.js")
    // main() is fire-and-forget: loadOverlay is pushed synchronously on its
    // first statement; startPipelineWorker follows after the awaited load.
    await vi.waitFor(() => expect(mocks.callOrder).toContain("startPipelineWorker"))
    expect(mocks.callOrder[0]).toBe("loadOverlay")
    expect(mocks.callOrder).toEqual(["loadOverlay", "startPipelineWorker"])
  })
})
