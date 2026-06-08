import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  config: { KIE_API_KEY: "test-key", NODE_ENV: "test" },
}))

// ---------------------------------------------------------------------------
// Import module under test (after mocks are registered)
// ---------------------------------------------------------------------------

import {
  KieError,
  createSanitizedError,
  createUpstreamFailureError,
  isUpstreamKieFailure,
  pollDelay,
} from "../client.js"

describe("createUpstreamFailureError + isUpstreamKieFailure", () => {
  it("flags the KieError as a terminal upstream failure (sanitized message preserved)", () => {
    const err = createUpstreamFailureError("task failed: [400] audio too long", "Generation")
    expect(err).toBeInstanceOf(KieError)
    expect(err.isUpstreamFailure).toBe(true)
    expect(err.internalDetails).toBe("task failed: [400] audio too long")
  })

  it("plain createSanitizedError is NOT flagged (transient/timeout default)", () => {
    expect(createSanitizedError("task timed out after 60 attempts", "Generation").isUpstreamFailure).toBe(false)
  })

  it("isUpstreamKieFailure is true only for a flagged KieError", () => {
    expect(isUpstreamKieFailure(createUpstreamFailureError("x", "Generation"))).toBe(true)
    expect(isUpstreamKieFailure(createSanitizedError("x", "Generation"))).toBe(false)
    expect(isUpstreamKieFailure(new Error("x"))).toBe(false)
    expect(isUpstreamKieFailure(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KieError", () => {
  it("has correct properties", () => {
    const error = new KieError(
      "Something went wrong",
      "raw kie.ai error details",
      "Image generation"
    )

    expect(error.message).toBe("Something went wrong")
    expect(error.internalDetails).toBe("raw kie.ai error details")
    expect(error.context).toBe("Image generation")
    expect(error.name).toBe("KieError")
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(KieError)
  })

  it("getFullMessage returns formatted string", () => {
    const error = new KieError(
      "User-friendly message",
      "internal details here",
      "Video generation"
    )

    expect(error.getFullMessage()).toBe(
      "[Video generation] User-friendly message | Internal: internal details here"
    )
  })
})

describe("createSanitizedError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("maps aspect_ratio errors to sanitized message", () => {
    const error = createSanitizedError(
      "Invalid aspect_ratio value: 3:2",
      "Image generation"
    )

    expect(error).toBeInstanceOf(KieError)
    expect(error.message).toBe(
      "Invalid aspect ratio setting. Please try a different option."
    )
    expect(error.internalDetails).toBe("Invalid aspect_ratio value: 3:2")
    expect(error.context).toBe("Image generation")
  })

  it("maps unknown errors to generic fallback message", () => {
    const error = createSanitizedError(
      "Unexpected internal server error xyz123",
      "Image generation"
    )

    expect(error).toBeInstanceOf(KieError)
    expect(error.message).toBe(
      "Image generation failed. Please try again or contact support if the issue persists."
    )
    expect(error.internalDetails).toBe("Unexpected internal server error xyz123")
  })

  it("maps content policy errors to content policy message", () => {
    const error = createSanitizedError(
      "NSFW content detected in output",
      "Image generation"
    )

    expect(error).toBeInstanceOf(KieError)
    expect(error.message).toBe(
      "Content policy violation: The output was blocked by the provider's safety filter. Try modifying your prompt or input image."
    )
    expect(error.internalDetails).toBe("NSFW content detected in output")
  })

  it("maps timeout errors to timed out message", () => {
    const error = createSanitizedError(
      "Request timed out after 30s",
      "Video generation"
    )

    expect(error).toBeInstanceOf(KieError)
    expect(error.message).toBe("Generation timed out. Please try again.")
    expect(error.internalDetails).toBe("Request timed out after 30s")
    expect(error.context).toBe("Video generation")
  })
})

describe("pollDelay", () => {
  it("returns correct delays for various attempt numbers", () => {
    // First 5 attempts: fixed 2000ms
    expect(pollDelay(1)).toBe(2000)
    expect(pollDelay(5)).toBe(2000)

    // Attempts 6-15: ramp from 2000 toward 10000
    // attempt 10: 2000 + (10-5)*1000 = 7000
    expect(pollDelay(10)).toBe(7000)

    // Attempts > 15: capped at 10000
    expect(pollDelay(20)).toBe(10000)
  })
})

// ---------------------------------------------------------------------------
// split tasks: createKieTask + pollKieTask + runKieTask wrapper
// ---------------------------------------------------------------------------
//
// The Phase 1 reconciliation refactor splits `runKieTask` into three pieces so
// callers can persist the upstream taskId BEFORE polling (closing a small
// window where a KIE task could leak credits if the worker crashed between
// createTask success and the first DB write). `runKieTask` becomes a thin
// backwards-compat wrapper: create → opts.onTaskCreated → poll.
describe("split tasks", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function withTimers<T>(fn: () => Promise<T>, advanceMs = 60_000): Promise<T> {
    const promise = fn()
    promise.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(advanceMs)
    return promise
  }

  it("calls onTaskCreated with the taskId BEFORE the first poll", async () => {
    const order: string[] = []
    const onTaskCreated = vi.fn(async (id: string) => {
      order.push(`onTaskCreated:${id}`)
    })

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/createTask")) {
        return new Response(JSON.stringify({ code: 0, data: { taskId: "t1" } }), { status: 200 })
      }
      if (url.includes("/recordInfo")) {
        order.push("recordInfo")
        return new Response(JSON.stringify({
          code: 0,
          data: { taskId: "t1", state: "success", resultJson: JSON.stringify({ resultUrls: ["https://r.example/1.png"] }) },
        }), { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })

    const { runKieTask } = await import("../client.js")
    await withTimers(() => runKieTask("nano-banana", { prompt: "x" }, undefined, undefined, { onTaskCreated }))

    expect(onTaskCreated).toHaveBeenCalledWith("t1")
    expect(order[0]).toBe("onTaskCreated:t1")
    expect(order).toContain("recordInfo")
    expect(order.indexOf("onTaskCreated:t1")).toBeLessThan(order.indexOf("recordInfo"))
  })

  it("createKieTask returns the taskId without polling", async () => {
    fetchMock.mockImplementation(async () => {
      return new Response(JSON.stringify({ code: 0, data: { taskId: "t-create-only" } }), { status: 200 })
    })
    const { createKieTask } = await import("../client.js")
    const { taskId } = await createKieTask("nano-banana", { prompt: "x" })
    expect(taskId).toBe("t-create-only")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// VEO onTaskCreated — Phase 1 reconciliation hook for VEO variants
// ---------------------------------------------------------------------------
//
// runVeoTask / runVeoExtendTask / runVeo4kTask all create their own upstream
// task with a fresh taskId, just like runKieTask. Same Phase 1 reconciliation
// requirement applies: the caller needs a chance to persist
// jobs.provider_task_id BEFORE polling starts so a worker crash mid-poll can
// be reconciled later. runVeo1080pTask is excluded — it takes an EXISTING
// taskId as input and does NOT create a new one.
describe("VEO onTaskCreated", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function withTimers<T>(fn: () => Promise<T>, advanceMs = 60_000): Promise<T> {
    const promise = fn()
    promise.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(advanceMs)
    return promise
  }

  it("runVeoTask calls onTaskCreated with the VEO taskId before polling", async () => {
    let onTaskCreatedTaskId: string | null = null
    let recordInfoCalled = false

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/veo/generate")) {
        return new Response(JSON.stringify({ code: 0, data: { taskId: "veo-1" } }), { status: 200 })
      }
      if (url.includes("/veo/record-info")) {
        recordInfoCalled = true
        // Assert onTaskCreated already fired by the time we poll
        expect(onTaskCreatedTaskId).toBe("veo-1")
        return new Response(JSON.stringify({
          code: 0,
          data: {
            taskId: "veo-1",
            successFlag: 1,
            response: { resultUrls: ["https://veo.example/clip.mp4"] },
          },
        }), { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })

    const { runVeoTask } = await import("../client.js")
    await withTimers(() => runVeoTask("veo3", "a prompt", undefined, undefined, {
      onTaskCreated: async (id) => { onTaskCreatedTaskId = id },
    }))

    expect(onTaskCreatedTaskId).toBe("veo-1")
    expect(recordInfoCalled).toBe(true)
  })

  it("runVeoExtendTask calls onTaskCreated with the extend taskId before polling", async () => {
    let onTaskCreatedTaskId: string | null = null
    let recordInfoCalled = false

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/veo/extend")) {
        return new Response(JSON.stringify({ code: 0, data: { taskId: "veo-extend-1" } }), { status: 200 })
      }
      if (url.includes("/veo/record-info")) {
        recordInfoCalled = true
        expect(onTaskCreatedTaskId).toBe("veo-extend-1")
        return new Response(JSON.stringify({
          code: 0,
          data: {
            taskId: "veo-extend-1",
            successFlag: 1,
            response: { resultUrls: ["https://veo.example/extended.mp4"] },
          },
        }), { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })

    const { runVeoExtendTask } = await import("../client.js")
    await withTimers(() => runVeoExtendTask("prior-task-id", "extend prompt", undefined, undefined, {
      onTaskCreated: async (id) => { onTaskCreatedTaskId = id },
    }))

    expect(onTaskCreatedTaskId).toBe("veo-extend-1")
    expect(recordInfoCalled).toBe(true)
  })

  it("runVeo4kTask calls onTaskCreated in the async path (taskId for polling)", async () => {
    let onTaskCreatedTaskId: string | null = null
    let recordInfoCalled = false

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/veo/get-4k-video")) {
        // code 422 = still processing, taskId returned for polling
        return new Response(JSON.stringify({
          code: 422,
          data: { taskId: "veo-4k-1" },
        }), { status: 200 })
      }
      if (url.includes("/veo/record-info")) {
        recordInfoCalled = true
        expect(onTaskCreatedTaskId).toBe("veo-4k-1")
        return new Response(JSON.stringify({
          code: 0,
          data: {
            taskId: "veo-4k-1",
            successFlag: 1,
            response: { resultUrls: ["https://veo.example/4k.mp4"] },
          },
        }), { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })

    const { runVeo4kTask } = await import("../client.js")
    await withTimers(() => runVeo4kTask("prior-task-id", 0, {
      onTaskCreated: async (id) => { onTaskCreatedTaskId = id },
    }))

    expect(onTaskCreatedTaskId).toBe("veo-4k-1")
    expect(recordInfoCalled).toBe(true)
  })

  it("runVeo4kTask does NOT call onTaskCreated in the synchronous immediate-result path", async () => {
    const onTaskCreated = vi.fn(async () => {})

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/veo/get-4k-video")) {
        // code 200 with resultUrls = immediate sync return, no new task created
        return new Response(JSON.stringify({
          code: 200,
          data: { resultUrls: ["https://veo.example/already-4k.mp4"] },
        }), { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })

    const { runVeo4kTask } = await import("../client.js")
    const result = await runVeo4kTask("prior-task-id", 0, { onTaskCreated })

    expect(onTaskCreated).not.toHaveBeenCalled()
    expect(result.resultJson.resultUrls).toEqual(["https://veo.example/already-4k.mp4"])
  })
})
