/**
 * Tests for the three KIE special-endpoint clients that don't fit the
 * standard /jobs/createTask flow:
 *   - kontext-client.ts → /api/v1/flux/kontext/{generate,record-info}
 *   - luma-client.ts    → /api/v1/modify/{generate,record-info}
 *   - runway-client.ts  → /api/v1/runway/{generate,extend,record-detail}
 *                        + /api/v1/aleph/{generate,record-info}
 *
 * Each client wraps a different KIE endpoint with its own response shape.
 * Polling uses one of two patterns:
 *   - successFlag (Kontext, Luma, Aleph): 0=processing, 1=success,
 *     2/3=failed, 4=callback-failed (Luma only — sometimes recoverable)
 *   - state field (Runway/Extend): "success" | "fail" | other
 *
 * Result URL location varies per endpoint:
 *   - Kontext: data.response.resultImageUrl
 *   - Luma:    data.response.resultUrls[]
 *   - Runway:  data.videoInfo.videoUrl
 *   - Aleph:   data.response.resultVideoUrl
 *
 * Tests use vi.useFakeTimers + advanceTimersByTimeAsync to skip the
 * exponential-backoff pollDelay between attempts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: {
    KIE_API_KEY: "test-kie-key",
    NODE_ENV: "test",
    EDITION: "cloud",
  },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import { runFluxKontextTask } from "../kontext-client.js"
import { runLumaModifyTask } from "../luma-client.js"
import {
  runRunwayTask,
  runRunwayExtendTask,
  runAlephTask,
} from "../runway-client.js"
import { KIE_API_BASE } from "../client.js"

let fetchMock: ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status })
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  // Fake timers so pollDelay() doesn't actually wait 2-10s per attempt.
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/**
 * Run an async function under fake timers, then advance the timer queue
 * far enough that any poll-delay sleeps resolve. Most polling loops cap
 * the per-attempt delay at 10s, and tests usually only need 1-3 polls.
 */
async function withTimers<T>(fn: () => Promise<T>, advanceMs = 60_000): Promise<T> {
  const promise = fn()
  // Attach a no-op rejection handler immediately so synchronous rejections
  // (e.g., missing API key, missing taskId) don't trigger Node's
  // unhandled-rejection logging while we advance the timer queue. The real
  // assertion still uses .rejects.toThrow() on the same promise.
  promise.catch(() => undefined)
  await vi.advanceTimersByTimeAsync(advanceMs)
  return promise
}

// ===========================================================================
// 1) kontext-client.ts
// ===========================================================================

describe("runFluxKontextTask", () => {
  it("creates task then polls until successFlag=1, returning the image URL", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "kx-1" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          successFlag: 1,
          response: { resultImageUrl: "https://r2/result.png" },
        },
      }))

    const result = await withTimers(() =>
      runFluxKontextTask("flux-kontext-pro", { prompt: "a dog" }),
    )

    expect(result.resultJson.resultUrls).toEqual(["https://r2/result.png"])

    // Verify create-task call shape
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${KIE_API_BASE}/api/v1/flux/kontext/generate`,
    )
    const createInit = fetchMock.mock.calls[0][1] as { method: string; body: string; headers: Record<string, string> }
    expect(createInit.method).toBe("POST")
    expect(createInit.headers["Authorization"]).toBe("Bearer test-kie-key")
    expect(JSON.parse(createInit.body)).toEqual({ model: "flux-kontext-pro", prompt: "a dog" })

    // Verify poll URL includes taskId
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${KIE_API_BASE}/api/v1/flux/kontext/record-info?taskId=kx-1`,
    )
  })

  it("polls multiple times when successFlag=0 (still generating)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "kx-2" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { successFlag: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { successFlag: 0 } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 1, response: { resultImageUrl: "https://r2/img.png" } },
      }))

    const result = await withTimers(() =>
      runFluxKontextTask("m", { prompt: "p" }),
    )

    expect(result.resultJson.resultUrls).toEqual(["https://r2/img.png"])
    // 1 create + 3 polls = 4 calls
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("throws when API key is missing", async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({
      config: { KIE_API_KEY: undefined, NODE_ENV: "test", EDITION: "cloud" },
      hasCredits: () => true, isCloud: () => true, isCommunity: () => false,
      isBusiness: () => false, hasAdmin: () => true,
    }))
    const mod = await import("../kontext-client.js")
    // Public-facing message is sanitized — match the user-visible text
    await expect(mod.runFluxKontextTask("m", {})).rejects.toThrow(/Service is not properly configured/)
    vi.doUnmock("@/lib/config.js")
  })

  it("throws on HTTP error from create-task", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("server error", 500))

    await expect(
      withTimers(() => runFluxKontextTask("m", {})),
    ).rejects.toThrow(/Image generation/)
  })

  it("throws when create-task response is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("<html>error page</html>"))

    await expect(
      withTimers(() => runFluxKontextTask("m", {})),
    ).rejects.toThrow(/Image generation/)
  })

  it("throws when response code is non-zero/non-200", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, message: "internal error" }))

    await expect(
      withTimers(() => runFluxKontextTask("m", {})),
    ).rejects.toThrow(/Image generation/)
  })

  it("accepts code: undefined (some endpoints omit it)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { taskId: "kx-no-code" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 1, response: { resultImageUrl: "https://ok.png" } },
      }))

    const result = await withTimers(() =>
      runFluxKontextTask("m", {}),
    )
    expect(result.resultJson.resultUrls).toEqual(["https://ok.png"])
  })

  it("throws when create response has no taskId", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }))

    await expect(
      withTimers(() => runFluxKontextTask("m", {})),
    ).rejects.toThrow(/Image generation/)
  })

  it("throws when successFlag=2 (create task failed)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "kx-fail" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 2, errorMessage: "bad input" },
      }))

    await expect(
      withTimers(() => runFluxKontextTask("m", {})),
    ).rejects.toThrow(/Image generation/)
  })

  it("throws when successFlag=3 (generate failed)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "kx-fail" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 3, errorCode: 42 },
      }))

    await expect(
      withTimers(() => runFluxKontextTask("m", {})),
    ).rejects.toThrow(/Image generation/)
  })

  it("throws when successFlag=1 but resultImageUrl missing", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "kx-x" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 1, response: {} },
      }))

    await expect(
      withTimers(() => runFluxKontextTask("m", {})),
    ).rejects.toThrow(/Image generation/)
  })

  it("continues polling on poll-call HTTP errors (not fatal mid-poll)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "kx-x" } }))
      .mockResolvedValueOnce(textResponse("transient", 503)) // 1st poll: HTTP err
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 1, response: { resultImageUrl: "https://ok.png" } },
      }))

    const result = await withTimers(() =>
      runFluxKontextTask("m", {}),
    )
    expect(result.resultJson.resultUrls).toEqual(["https://ok.png"])
  })

  it("continues polling on invalid-JSON poll responses", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "kx-x" } }))
      .mockResolvedValueOnce(textResponse("garbage")) // poll returns non-JSON
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 1, response: { resultImageUrl: "https://ok.png" } },
      }))

    const result = await withTimers(() =>
      runFluxKontextTask("m", {}),
    )
    expect(result.resultJson.resultUrls).toEqual(["https://ok.png"])
  })
})

// ===========================================================================
// 2) luma-client.ts
// ===========================================================================

describe("runLumaModifyTask", () => {
  it("creates task then polls until successFlag=1, returning result URLs", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "lm-1" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          successFlag: 1,
          response: { resultUrls: ["https://r2/v1.mp4"] },
        },
      }))

    const result = await withTimers(() =>
      runLumaModifyTask({ prompt: "make it stylized", videoUrl: "https://in.mp4" }),
    )

    expect(result.resultJson.resultUrls).toEqual(["https://r2/v1.mp4"])
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${KIE_API_BASE}/api/v1/modify/generate`,
    )
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${KIE_API_BASE}/api/v1/modify/record-info?taskId=lm-1`,
    )
  })

  it("posts the input as the top-level body (no model nesting)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "lm-1" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 1, response: { resultUrls: ["x"] } },
      }))

    await withTimers(() =>
      runLumaModifyTask({ prompt: "p", videoUrl: "v" }),
    )

    const init = fetchMock.mock.calls[0][1] as { body: string }
    expect(JSON.parse(init.body)).toEqual({ prompt: "p", videoUrl: "v" })
  })

  it("treats successFlag=4 (callback failed) as success when resultUrls present", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "lm-cb" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          successFlag: 4,
          response: { resultUrls: ["https://recovered.mp4"] },
        },
      }))

    const result = await withTimers(() => runLumaModifyTask({}))
    expect(result.resultJson.resultUrls).toEqual(["https://recovered.mp4"])
  })

  it("throws when successFlag=4 (callback failed) AND resultUrls missing", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "lm-cb" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 4 },
      }))

    await expect(withTimers(() => runLumaModifyTask({}))).rejects.toThrow(
      /Video generation/,
    )
  })

  it("throws when successFlag=2 (create failed)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "lm-x" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 2, errorMessage: "bad video" },
      }))

    await expect(withTimers(() => runLumaModifyTask({}))).rejects.toThrow(
      /Video generation/,
    )
  })

  it("throws when successFlag=3 (generate failed)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "lm-x" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 3, errorCode: 99 },
      }))

    await expect(withTimers(() => runLumaModifyTask({}))).rejects.toThrow(
      /Video generation/,
    )
  })

  it("throws when successFlag=1 but resultUrls is empty", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "lm-x" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 1, response: { resultUrls: [] } },
      }))

    await expect(withTimers(() => runLumaModifyTask({}))).rejects.toThrow(
      /Video generation/,
    )
  })

  it("throws when API key is missing", async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({
      config: { KIE_API_KEY: "", NODE_ENV: "test", EDITION: "cloud" },
      hasCredits: () => true, isCloud: () => true, isCommunity: () => false,
      isBusiness: () => false, hasAdmin: () => true,
    }))
    const mod = await import("../luma-client.js")
    await expect(mod.runLumaModifyTask({})).rejects.toThrow(/Service is not properly configured/)
    vi.doUnmock("@/lib/config.js")
  })

  it("uses code/msg fallback for error messages", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, msg: "alt-error-field" }))

    await expect(withTimers(() => runLumaModifyTask({}))).rejects.toThrow(
      /Video generation/,
    )
  })
})

// ===========================================================================
// 3) runway-client.ts — runRunwayTask
// ===========================================================================

describe("runRunwayTask", () => {
  it("creates task then polls record-detail until state=success", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "rw-1" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          state: "success",
          videoInfo: { videoUrl: "https://r2/runway.mp4" },
        },
      }))

    const result = await withTimers(() =>
      runRunwayTask({ prompt: "a sunset" }),
    )

    expect(result.resultJson.videoUrl).toBe("https://r2/runway.mp4")
    expect(result.resultJson.resultUrls).toEqual(["https://r2/runway.mp4"])
    expect(result.taskId).toBe("rw-1")

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${KIE_API_BASE}/api/v1/runway/generate`,
    )
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${KIE_API_BASE}/api/v1/runway/record-detail?taskId=rw-1`,
    )
  })

  it("polls multiple intermediate states (wait/queueing/generating) until success", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "rw-2" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { state: "wait" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { state: "generating" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "success", videoInfo: { videoUrl: "https://done.mp4" } },
      }))

    const result = await withTimers(() => runRunwayTask({}))
    expect(result.resultJson.videoUrl).toBe("https://done.mp4")
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("throws when state=fail with failCode + failMsg", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "rw-fail" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "fail", failCode: "ABC123", failMsg: "input rejected" },
      }))

    await expect(withTimers(() => runRunwayTask({}))).rejects.toThrow(
      /Video generation/,
    )
  })

  it("throws when state=success but videoInfo.videoUrl missing", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "rw-x" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "success", videoInfo: {} },
      }))

    await expect(withTimers(() => runRunwayTask({}))).rejects.toThrow(
      /Video generation/,
    )
  })

  it("ignores poll responses missing the state field (continues)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "rw-x" } }))
      .mockResolvedValueOnce(jsonResponse({ data: {} })) // no state
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "success", videoInfo: { videoUrl: "https://ok.mp4" } },
      }))

    const result = await withTimers(() => runRunwayTask({}))
    expect(result.resultJson.videoUrl).toBe("https://ok.mp4")
  })
})

// ===========================================================================
// 4) runway-client.ts — runRunwayExtendTask
// ===========================================================================

describe("runRunwayExtendTask", () => {
  it("posts to /runway/extend with the parent taskId, prompt, and quality", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "ext-1" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "success", videoInfo: { videoUrl: "https://ext.mp4" } },
      }))

    const result = await withTimers(() =>
      runRunwayExtendTask("parent-task-id", "continue with explosions", "1080p"),
    )

    expect(result.taskId).toBe("ext-1")
    expect(result.resultJson.videoUrl).toBe("https://ext.mp4")

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${KIE_API_BASE}/api/v1/runway/extend`,
    )
    const init = fetchMock.mock.calls[0][1] as { body: string }
    expect(JSON.parse(init.body)).toEqual({
      taskId: "parent-task-id",
      prompt: "continue with explosions",
      quality: "1080p",
    })
  })

  it("defaults quality to 720p when not specified", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "ext-2" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "success", videoInfo: { videoUrl: "u" } },
      }))

    await withTimers(() =>
      runRunwayExtendTask("parent", "extend please"),
    )

    const init = fetchMock.mock.calls[0][1] as { body: string }
    expect(JSON.parse(init.body).quality).toBe("720p")
  })
})

// ===========================================================================
// 5) runway-client.ts — runAlephTask (uses successFlag, not state)
// ===========================================================================

describe("runAlephTask", () => {
  it("creates task then polls /aleph/record-info until successFlag=1", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "al-1" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          successFlag: 1,
          response: { resultVideoUrl: "https://r2/aleph.mp4" },
        },
      }))

    const result = await withTimers(() =>
      runAlephTask({ prompt: "stylize", videoUrl: "https://in.mp4" }),
    )

    expect(result.resultJson.videoUrl).toBe("https://r2/aleph.mp4")
    expect(result.taskId).toBe("al-1")

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${KIE_API_BASE}/api/v1/aleph/generate`,
    )
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${KIE_API_BASE}/api/v1/aleph/record-info?taskId=al-1`,
    )
  })

  it("polls past successFlag=0 (still processing)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "al-2" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { successFlag: 0 } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 1, response: { resultVideoUrl: "https://done.mp4" } },
      }))

    const result = await withTimers(() => runAlephTask({}))
    expect(result.resultJson.videoUrl).toBe("https://done.mp4")
  })

  it("throws when errorCode is non-zero (Aleph signals failure via errorCode)", async () => {
    // Aleph's poll loop continues silently when successFlag is undefined,
    // then checks errorCode only AFTER confirming successFlag is set. So
    // the failure path needs successFlag: 0 + errorCode > 0.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "al-fail" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 0, errorCode: 42, errorMessage: "bad video" },
      }))

    await expect(withTimers(() => runAlephTask({}))).rejects.toThrow(
      /Video generation/,
    )
  })

  it("treats errorCode=0 as not-an-error (still polling)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "al-3" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { successFlag: 0, errorCode: 0 } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 1, response: { resultVideoUrl: "u" } },
      }))

    const result = await withTimers(() => runAlephTask({}))
    expect(result.resultJson.videoUrl).toBe("u")
  })

  it("ignores poll responses missing successFlag", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "al-x" } }))
      .mockResolvedValueOnce(jsonResponse({ data: {} })) // no successFlag, no errorCode
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 1, response: { resultVideoUrl: "u" } },
      }))

    const result = await withTimers(() => runAlephTask({}))
    expect(result.resultJson.videoUrl).toBe("u")
  })

  it("throws when successFlag=1 but resultVideoUrl is missing", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "al-x" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { successFlag: 1, response: {} },
      }))

    await expect(withTimers(() => runAlephTask({}))).rejects.toThrow(
      /Video generation/,
    )
  })
})

// ===========================================================================
// 6) Cross-cutting: createTask error paths shared by all 3 clients
// ===========================================================================

describe("create-task error paths", () => {
  it.each([
    ["runFluxKontextTask", () => runFluxKontextTask("m", {})],
    ["runLumaModifyTask", () => runLumaModifyTask({})],
    ["runRunwayTask", () => runRunwayTask({})],
    ["runAlephTask", () => runAlephTask({})],
  ] as const)(
    "%s throws when create-task returns code: 500",
    async (_label, fn) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ code: 500, message: "boom" }))
      await expect(withTimers(fn)).rejects.toThrow()
    },
  )

  it.each([
    ["runRunwayTask", () => runRunwayTask({})],
    ["runRunwayExtendTask", () => runRunwayExtendTask("t", "p")],
    ["runAlephTask", () => runAlephTask({})],
  ] as const)(
    "%s throws when create response has no taskId",
    async (_label, fn) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }))
      await expect(withTimers(fn)).rejects.toThrow()
    },
  )
})

// ===========================================================================
// 7) Auth header consistency
// ===========================================================================

describe("auth headers", () => {
  it.each([
    ["runFluxKontextTask", () => runFluxKontextTask("m", {})],
    ["runLumaModifyTask", () => runLumaModifyTask({})],
    ["runRunwayTask", () => runRunwayTask({})],
    ["runAlephTask", () => runAlephTask({})],
  ] as const)(
    "%s sends Bearer KIE_API_KEY on the create-task POST",
    async (_label, fn) => {
      // Mock with successful path so call completes (or fails in poll, doesn't matter here)
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
        .mockResolvedValue(jsonResponse({ data: { successFlag: 1, state: "success", response: { resultImageUrl: "x", resultUrls: ["x"], resultVideoUrl: "x" }, videoInfo: { videoUrl: "x" } } }))

      try { await withTimers(fn) } catch { /* ignore */ }

      const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
      expect(init.headers["Authorization"]).toBe("Bearer test-kie-key")
      expect(init.headers["Content-Type"]).toBe("application/json")
    },
  )
})

// ===========================================================================
// 8) reconcileOpts.onTaskCreated — Phase 1 reconciliation hook
// ===========================================================================
//
// Every task-creating function in these 4 special-endpoint clients creates a
// fresh upstream KIE task and then polls. The Phase 1 reconciliation pipeline
// needs a chance to persist `jobs.provider_task_id` BEFORE polling starts so
// a worker crash mid-poll can be reconciled later. Same pattern as
// runKieTask / runVeoTask.
describe("onTaskCreated reconciliation hook", () => {
  it("runFluxKontextTask calls onTaskCreated with the Kontext taskId before polling", async () => {
    let onTaskCreatedTaskId: string | null = null
    let pollCalled = false

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/flux/kontext/generate")) {
        return jsonResponse({ code: 0, data: { taskId: "kx-recon-1" } })
      }
      if (url.includes("/flux/kontext/record-info")) {
        pollCalled = true
        expect(onTaskCreatedTaskId).toBe("kx-recon-1")
        return jsonResponse({
          data: { successFlag: 1, response: { resultImageUrl: "https://r2/x.png" } },
        })
      }
      throw new Error(`unexpected url ${url}`)
    })

    await withTimers(() => runFluxKontextTask("m", { prompt: "p" }, {
      onTaskCreated: async (id) => { onTaskCreatedTaskId = id },
    }))

    expect(onTaskCreatedTaskId).toBe("kx-recon-1")
    expect(pollCalled).toBe(true)
  })

  it("runLumaModifyTask calls onTaskCreated with the Luma taskId before polling", async () => {
    let onTaskCreatedTaskId: string | null = null
    let pollCalled = false

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/modify/generate")) {
        return jsonResponse({ code: 0, data: { taskId: "lm-recon-1" } })
      }
      if (url.includes("/modify/record-info")) {
        pollCalled = true
        expect(onTaskCreatedTaskId).toBe("lm-recon-1")
        return jsonResponse({
          data: { successFlag: 1, response: { resultUrls: ["https://r2/v.mp4"] } },
        })
      }
      throw new Error(`unexpected url ${url}`)
    })

    await withTimers(() => runLumaModifyTask({ prompt: "p", videoUrl: "v" }, {
      onTaskCreated: async (id) => { onTaskCreatedTaskId = id },
    }))

    expect(onTaskCreatedTaskId).toBe("lm-recon-1")
    expect(pollCalled).toBe(true)
  })

  it("runRunwayTask calls onTaskCreated with the Runway taskId before polling", async () => {
    let onTaskCreatedTaskId: string | null = null
    let pollCalled = false

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/runway/generate")) {
        return jsonResponse({ code: 0, data: { taskId: "rw-recon-1" } })
      }
      if (url.includes("/runway/record-detail")) {
        pollCalled = true
        expect(onTaskCreatedTaskId).toBe("rw-recon-1")
        return jsonResponse({
          data: { state: "success", videoInfo: { videoUrl: "https://r2/run.mp4" } },
        })
      }
      throw new Error(`unexpected url ${url}`)
    })

    await withTimers(() => runRunwayTask({ prompt: "p" }, {
      onTaskCreated: async (id) => { onTaskCreatedTaskId = id },
    }))

    expect(onTaskCreatedTaskId).toBe("rw-recon-1")
    expect(pollCalled).toBe(true)
  })

  it("runRunwayExtendTask calls onTaskCreated with its OWN new extend taskId before polling", async () => {
    let onTaskCreatedTaskId: string | null = null
    let pollCalled = false

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/runway/extend")) {
        return jsonResponse({ code: 0, data: { taskId: "ext-recon-1" } })
      }
      if (url.includes("/runway/record-detail")) {
        pollCalled = true
        // The extend task creates its own fresh taskId — that's what gets
        // persisted, not the parent taskId.
        expect(onTaskCreatedTaskId).toBe("ext-recon-1")
        return jsonResponse({
          data: { state: "success", videoInfo: { videoUrl: "https://r2/ext.mp4" } },
        })
      }
      throw new Error(`unexpected url ${url}`)
    })

    await withTimers(() => runRunwayExtendTask("parent-task-id", "extend prompt", "720p", {
      onTaskCreated: async (id) => { onTaskCreatedTaskId = id },
    }))

    expect(onTaskCreatedTaskId).toBe("ext-recon-1")
    expect(pollCalled).toBe(true)
  })

  it("runAlephTask calls onTaskCreated with the Aleph taskId before polling", async () => {
    let onTaskCreatedTaskId: string | null = null
    let pollCalled = false

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/aleph/generate")) {
        return jsonResponse({ code: 0, data: { taskId: "al-recon-1" } })
      }
      if (url.includes("/aleph/record-info")) {
        pollCalled = true
        expect(onTaskCreatedTaskId).toBe("al-recon-1")
        return jsonResponse({
          data: { successFlag: 1, response: { resultVideoUrl: "https://r2/al.mp4" } },
        })
      }
      throw new Error(`unexpected url ${url}`)
    })

    await withTimers(() => runAlephTask({ prompt: "stylize", videoUrl: "in" }, {
      onTaskCreated: async (id) => { onTaskCreatedTaskId = id },
    }))

    expect(onTaskCreatedTaskId).toBe("al-recon-1")
    expect(pollCalled).toBe(true)
  })

  it("swallows errors thrown from onTaskCreated and still polls (Kontext)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/flux/kontext/generate")) {
        return jsonResponse({ code: 0, data: { taskId: "kx-err" } })
      }
      if (url.includes("/flux/kontext/record-info")) {
        return jsonResponse({
          data: { successFlag: 1, response: { resultImageUrl: "https://ok.png" } },
        })
      }
      throw new Error(`unexpected url ${url}`)
    })
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const result = await withTimers(() => runFluxKontextTask("m", {}, {
      onTaskCreated: async () => { throw new Error("db down") },
    }))

    expect(result.resultJson.resultUrls).toEqual(["https://ok.png"])
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
