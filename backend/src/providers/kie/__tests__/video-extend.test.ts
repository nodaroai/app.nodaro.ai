/**
 * Phase 1C.3 — Method 3: Video extension provider wrappers.
 * Tests `kieExtendVideoVEO` (wired) and `kieExtendVideoSeedance` (stubbed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  mockRunVeoExtendTask: vi.fn(),
  mockRunKieTask: vi.fn(),
  mockRunVeoTask: vi.fn(),
  mockCreateSanitizedError: vi.fn(
    (msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`),
  ),
}))

vi.mock("../client.js", () => ({
  runKieTask: mocks.mockRunKieTask,
  runVeoTask: mocks.mockRunVeoTask,
  runVeoExtendTask: mocks.mockRunVeoExtendTask,
  createSanitizedError: mocks.mockCreateSanitizedError,
  MAX_POLL_ATTEMPTS_VIDEO: 120,
  MAX_POLL_ATTEMPTS_LIP_SYNC_LONG: 600,
}))

vi.mock("../kling3-client.js", () => ({ kling3Generate: vi.fn() }))
vi.mock("../runway-client.js", () => ({
  runRunwayTask: vi.fn(),
  runAlephTask: vi.fn(),
}))
vi.mock("../luma-client.js", () => ({ runLumaModifyTask: vi.fn() }))
vi.mock("../../../lib/storage.js", () => ({ uploadBufferToR2: vi.fn() }))
vi.mock("../../../lib/credit-audit.js", () => ({
  logCreditAudit: vi.fn(),
  extractCreditFields: vi.fn(() => ({})),
}))
vi.mock("../../video/ffmpeg-utils.js", () => ({
  downloadFile: vi.fn(),
  runFfmpeg: vi.fn(),
  getVideoDuration: vi.fn(),
  createWorkDir: vi.fn(),
  cleanupWorkDir: vi.fn(),
}))

import { kieExtendVideoVEO, kieExtendVideoSeedance } from "../video.js"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("kieExtendVideoVEO", () => {
  it("happy path: forwards taskId + prompt to runVeoExtendTask and returns url/taskId", async () => {
    mocks.mockRunVeoExtendTask.mockResolvedValue({
      resultJson: { resultUrls: ["https://cdn.kie.ai/extended.mp4"] },
      taskId: "veo_extend_task_xyz",
      providerMs: 41000,
    })
    const result = await kieExtendVideoVEO({
      priorClipKieTaskId: "veo_orig_abc",
      prompt: "the figure continues walking into the mist",
      veoModelVariant: "quality",
      seed: 12345,
    })
    expect(mocks.mockRunVeoExtendTask).toHaveBeenCalledWith(
      "veo_orig_abc",
      "the figure continues walking into the mist",
      "quality",
      12345,
    )
    expect(result).toEqual({
      url: "https://cdn.kie.ai/extended.mp4",
      kieTaskId: "veo_extend_task_xyz",
      providerMs: 41000,
    })
  })

  it("worker failure: throws provider_not_available when priorClipKieTaskId is missing", async () => {
    await expect(
      kieExtendVideoVEO({ prompt: "extend me" }),
    ).rejects.toThrow(/provider_not_available:veo3\.1-extend:missing_task_id/)
    expect(mocks.mockRunVeoExtendTask).not.toHaveBeenCalled()
  })
})

describe("kieExtendVideoSeedance", () => {
  it("always throws provider_not_available (Seedance has no extension primitive)", async () => {
    await expect(
      kieExtendVideoSeedance({
        priorClipUrl: "https://cdn.kie.ai/prior.mp4",
        prompt: "continue the scene",
      }),
    ).rejects.toThrow(/provider_not_available:seedance-2-extend/)
  })
})
