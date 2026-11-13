import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Grok Extend on a workflow run: the run's twin of the route's preHandler. The
 * source the upstream task names is checked before anything is reserved, and
 * the run is held on the SOURCE's resolution row and sends the task id the
 * check matched — as a patch the executor merges, never a mutation.
 */

vi.mock("../grok-extend-source.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveGrokExtendSource: vi.fn(),
}))

import { GROK_EXTEND_SOURCE_CODE, GROK_EXTEND_SOURCE_MESSAGE, resolveGrokExtendSource } from "../grok-extend-source.js"
import { grokExtendReserveId, stampGrokExtendSource } from "../grok-extend-stamp.js"

const resolve = vi.mocked(resolveGrokExtendSource)
const payload = (over: Record<string, unknown> = {}) => ({ jobId: "job-1", provider: "grok-extend", kieTaskId: "task-grok-src", prompt: "she runs", duration: 10, ...over })

beforeEach(() => {
  resolve.mockReset()
  resolve.mockResolvedValue({ ok: true, sourceSec: 6.041667, resolution: "480p", taskId: "task-grok-src" })
})

describe("stampGrokExtendSource", () => {
  it("leaves every other job alone, unchecked", async () => {
    for (const [jobName, p] of [
      ["extend-video", payload({ provider: "veo-extend" })],
      ["extend-video", payload({ provider: "pixverse-v6-extend" })],
      ["video-upscale", payload()],
    ] as const) {
      await expect(stampGrokExtendSource(jobName, p, "user-1")).resolves.toEqual({ ok: true, patch: {} })
    }
    expect(resolve).not.toHaveBeenCalled()
  })

  it("checks the upstream task's source for the run's user, within 20 seconds", async () => {
    await stampGrokExtendSource("extend-video", payload(), "user-1")
    expect(resolve).toHaveBeenCalledWith({ taskId: "task-grok-src", userId: "user-1", probeTimeoutMs: 20_000 })
  })

  it("patches in the matched task, the source's length and resolution, and the source's row to hold", async () => {
    resolve.mockResolvedValue({ ok: true, sourceSec: 10.041667, resolution: "720p", taskId: "task-grok-src" })
    const p = payload({ kieTaskId: " task-grok-src " })
    await expect(stampGrokExtendSource("extend-video", p, "user-1")).resolves.toEqual({
      ok: true,
      patch: { kieTaskId: "task-grok-src", resolution: "720p", sourceSec: 10.041667, reservedCreditId: "grok-extend:10s:720p" },
    })
    // A patch, never a mutation of the built payload.
    expect(p.kieTaskId).toBe(" task-grok-src ")
  })

  it("refuses with the source check's code and message", async () => {
    resolve.mockResolvedValue({ ok: false, code: GROK_EXTEND_SOURCE_CODE, message: GROK_EXTEND_SOURCE_MESSAGE })
    await expect(stampGrokExtendSource("extend-video", payload(), "user-1")).resolves.toEqual({
      ok: false,
      refusal: { code: "grok_extend_source", message: GROK_EXTEND_SOURCE_MESSAGE },
    })
  })

  it("a run whose upstream handed no task (an upload wired in) asks the check with none, which refuses it", async () => {
    resolve.mockResolvedValue({ ok: false, code: GROK_EXTEND_SOURCE_CODE, message: GROK_EXTEND_SOURCE_MESSAGE })
    await expect(stampGrokExtendSource("extend-video", payload({ kieTaskId: undefined }), "user-1")).resolves.toMatchObject({ ok: false })
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ taskId: "" }))
  })
})

describe("grokExtendReserveId", () => {
  it("is the stamped row of a Grok Extend run, and nothing for any other job", () => {
    expect(grokExtendReserveId("extend-video", payload({ reservedCreditId: "grok-extend:6s:480p" }))).toBe("grok-extend:6s:480p")
    expect(grokExtendReserveId("extend-video", payload())).toBeUndefined()
    expect(grokExtendReserveId("extend-video", payload({ provider: "veo-extend", reservedCreditId: "grok-extend:6s:480p" }))).toBeUndefined()
    expect(grokExtendReserveId("video-upscale", payload({ reservedCreditId: "grok-extend:6s:480p" }))).toBeUndefined()
  })
})
