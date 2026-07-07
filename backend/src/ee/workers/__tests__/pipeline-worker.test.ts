import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * S9 P0 regression guard — `startPipelineWorker()` used to never call
 * `loadPrivatePlugins()`, so every pipeline stage would run against an empty
 * prompt registry and throw `PipelinePromptUnavailableError` on every run in
 * production. This suite verifies BOTH that the call happens AND that it
 * happens before the BullMQ `Worker` (and therefore before any job could be
 * pulled and any stage could call `getPipelinePrompt()`).
 *
 * Mocking mirrors `workers/__tests__/video-worker.test.ts` (Worker/IORedis as
 * classes, config/supabase stubbed) scoped down to what
 * `ee/workers/pipeline-worker.ts` actually imports.
 */

const mocks = vi.hoisted(() => {
  const callOrder: string[] = []
  const mockLoadPrivatePlugins = vi.fn().mockImplementation(async () => {
    callOrder.push("loadPrivatePlugins")
    return { handlers: {}, loaded: [], engines: {}, prompts: {} }
  })
  const mockResumeActiveOrchestrators = vi.fn().mockResolvedValue({ resumed: 0, failed: 0 })
  const mockDriveWithRedriveLatch = vi.fn().mockResolvedValue(undefined)
  const mockDrivePipeline = vi.fn().mockResolvedValue(undefined)
  const mockPipelineContextRun = vi.fn().mockImplementation((_ctx: unknown, fn: () => unknown) => fn())
  const mockPipelineEventsSubscribe = vi.fn().mockReturnValue(() => {})

  return {
    callOrder,
    mockLoadPrivatePlugins,
    mockResumeActiveOrchestrators,
    mockDriveWithRedriveLatch,
    mockDrivePipeline,
    mockPipelineContextRun,
    mockPipelineEventsSubscribe,
  }
})

// BullMQ Worker mock — must be a class (called with `new`). Records into the
// shared callOrder so the test can assert it fires AFTER loadPrivatePlugins.
vi.mock("bullmq", () => {
  class MockWorker {
    on = vi.fn()
    close = vi.fn()
    constructor(_queue: string, _processor: (job: unknown) => Promise<void>) {
      mocks.callOrder.push("Worker constructed")
    }
  }
  return { Worker: MockWorker }
})

vi.mock("ioredis", () => {
  class FakeRedis {}
  return { default: FakeRedis }
})

vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379" },
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {},
}))

// The fix under test — mirrors workers/__tests__/video-worker.test.ts's
// mocking of the same module.
vi.mock("@/lib/private-plugins/load.js", () => ({
  loadPrivatePlugins: mocks.mockLoadPrivatePlugins,
}))

vi.mock("@/ee/pipelines/engine.js", () => ({
  drivePipeline: mocks.mockDrivePipeline,
}))
vi.mock("@/ee/pipelines/redrive-latch.js", () => ({
  driveWithRedriveLatch: mocks.mockDriveWithRedriveLatch,
}))
vi.mock("@/ee/pipelines/events.js", () => ({
  pipelineEvents: { subscribe: mocks.mockPipelineEventsSubscribe, publish: vi.fn() },
}))
vi.mock("@/ee/pipelines/pipeline-context.js", () => ({
  pipelineContext: { run: mocks.mockPipelineContextRun },
}))
vi.mock("@/ee/pipelines/queue.js", () => ({
  pipelineOrchestrationQueue: {},
}))
vi.mock("@/ee/pipelines/resume.js", () => ({
  resumeActiveOrchestrators: mocks.mockResumeActiveOrchestrators,
}))

beforeEach(() => {
  mocks.callOrder.length = 0
})

describe("ee/workers/pipeline-worker.ts — S9 private-plugin prompt registration", () => {
  it("calls loadPrivatePlugins({}) at module load, before startPipelineWorker constructs the BullMQ worker", async () => {
    // The dynamic import below is how backend/src/pipeline-worker.ts's main()
    // reaches this module in production — that import fully evaluates this
    // module's top level (including the awaited loadPrivatePlugins call)
    // before the promise resolves.
    const { startPipelineWorker } = await import("../pipeline-worker.js")

    expect(mocks.mockLoadPrivatePlugins).toHaveBeenCalledTimes(1)
    expect(mocks.mockLoadPrivatePlugins).toHaveBeenCalledWith({})
    // At this point (module import resolved, startPipelineWorker not yet
    // invoked), the load must have already happened and nothing else has.
    expect(mocks.callOrder).toEqual(["loadPrivatePlugins"])

    const worker = startPipelineWorker()
    expect(worker).toBeDefined()
    // The BullMQ worker (which would start pulling jobs) is only constructed
    // AFTER the private-plugin load already completed.
    expect(mocks.callOrder).toEqual(["loadPrivatePlugins", "Worker constructed"])
  })
})
