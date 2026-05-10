/**
 * Kling 3.0 video client tests.
 *
 * kling3-client.ts uses the standard /jobs/createTask endpoint but layers
 * substantial input-building logic on top:
 *   - Multi-shot mode (multi_prompt + sound force-enable + duration sum)
 *   - Single-shot motion prompt (motionPrompt > prompt > "")
 *   - Duration: string→number, multiPrompt sum, default 5, range 3-15s
 *   - Element prefixing: kling_elements requires "element_" prefix on names,
 *     and any @name reference in the prompt or multi_prompt must be
 *     rewritten to @element_name
 *   - Description truncation at 100 chars
 *   - Long-name-first ordering to prevent partial-replace collisions
 *
 * Polling is also branchy:
 *   - URL extraction tries 4 top-level keys, then falls through to
 *     resultJson (which may be string OR object) with another 3 keys
 *   - Multiple terminal states: success/completed/fail/failed/error
 *   - onProgress callback fires whenever data.progress is present
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

import { kling3Generate } from "../kling3-client.js"
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

/** Small helper: queue a successful create+single-poll-success pair. */
function queueSuccess(taskId = "kt-1", videoUrl = "https://r2/k3.mp4") {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId } }))
    .mockResolvedValueOnce(jsonResponse({
      data: { state: "success", videoUrl, progress: 100 },
    }))
}

/** Pull the create-task POST body for assertions. */
function getCreateBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as { body: string }
  return JSON.parse(init.body)
}

// ===========================================================================
// 1) Happy path + create-task shape
// ===========================================================================

describe("kling3Generate — create-task request shape", () => {
  it("returns { taskId, videoUrl } on success", async () => {
    queueSuccess("task-1", "https://r2/clip.mp4")
    const result = await withTimers(() => kling3Generate({ prompt: "a dog" }))
    expect(result).toEqual({ taskId: "task-1", videoUrl: "https://r2/clip.mp4" })
  })

  it("POSTs to /api/v1/jobs/createTask with model 'kling-3.0/video'", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p" }))

    expect(fetchMock.mock.calls[0][0]).toBe(`${KIE_API_BASE}/api/v1/jobs/createTask`)
    expect(getCreateBody().model).toBe("kling-3.0/video")
  })

  it("includes Bearer KIE_API_KEY auth header", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p" }))

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers["Authorization"]).toBe("Bearer test-kie-key")
    expect(init.headers["Content-Type"]).toBe("application/json")
  })

  it("polls /api/v1/jobs/recordInfo with taskId", async () => {
    queueSuccess("task-poll")
    await withTimers(() => kling3Generate({ prompt: "p" }))

    expect(fetchMock.mock.calls[1][0]).toBe(
      `${KIE_API_BASE}/api/v1/jobs/recordInfo?taskId=task-poll`,
    )
  })

  it("throws when KIE_API_KEY missing", async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({
      config: { KIE_API_KEY: undefined, NODE_ENV: "test", EDITION: "cloud" },
      hasCredits: () => true, isCloud: () => true, isCommunity: () => false,
      isBusiness: () => false, hasAdmin: () => true,
    }))
    const mod = await import("../kling3-client.js")
    await expect(mod.kling3Generate({ prompt: "p" })).rejects.toThrow(
      /Service is not properly configured/,
    )
    vi.doUnmock("@/lib/config.js")
  })
})

// ===========================================================================
// 2) Default values
// ===========================================================================

describe("kling3Generate — default values", () => {
  it("default mode is 'pro'", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p" }))
    expect((getCreateBody().input as Record<string, unknown>).mode).toBe("pro")
  })

  it("default aspect_ratio is '1:1'", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p" }))
    expect((getCreateBody().input as Record<string, unknown>).aspect_ratio).toBe("1:1")
  })

  it("default duration is 5 (stringified)", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p" }))
    expect((getCreateBody().input as Record<string, unknown>).duration).toBe("5")
  })

  it("default sound is true (single-shot)", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p" }))
    expect((getCreateBody().input as Record<string, unknown>).sound).toBe(true)
  })

  it("respects sound: false in single-shot mode", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p", sound: false }))
    expect((getCreateBody().input as Record<string, unknown>).sound).toBe(false)
  })

  it("respects custom mode + aspectRatio", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({ prompt: "p", mode: "std", aspectRatio: "16:9" }),
    )
    const input = getCreateBody().input as Record<string, unknown>
    expect(input.mode).toBe("std")
    expect(input.aspect_ratio).toBe("16:9")
  })
})

// ===========================================================================
// 3) Duration handling
// ===========================================================================

describe("kling3Generate — duration", () => {
  it("accepts numeric duration", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p", duration: 10 }))
    expect((getCreateBody().input as Record<string, unknown>).duration).toBe("10")
  })

  it("parses string duration as integer", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p", duration: "8" }))
    expect((getCreateBody().input as Record<string, unknown>).duration).toBe("8")
  })

  it("falls back to 5 when string duration is non-numeric", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p", duration: "abc" }))
    expect((getCreateBody().input as Record<string, unknown>).duration).toBe("5")
  })

  it("rejects duration < 3s", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await expect(
      withTimers(() => kling3Generate({ prompt: "p", duration: 2 })),
    ).rejects.toThrow(/Kling 3\.0/)
  })

  it("rejects duration > 15s", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await expect(
      withTimers(() => kling3Generate({ prompt: "p", duration: 20 })),
    ).rejects.toThrow(/Kling 3\.0/)
  })

  it("accepts 3s and 15s boundary values", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p", duration: 3 }))
    expect((getCreateBody().input as Record<string, unknown>).duration).toBe("3")

    fetchMock.mockClear()
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p", duration: 15 }))
    expect((getCreateBody().input as Record<string, unknown>).duration).toBe("15")
  })
})

// ===========================================================================
// 4) Multi-shot mode
// ===========================================================================

describe("kling3Generate — multi-shot mode", () => {
  it("forces sound: true even when sound: false is passed", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "p",
        sound: false,
        multiShots: true,
        multiPrompt: [
          { prompt: "shot 1", duration: 4 },
          { prompt: "shot 2", duration: 6 },
        ],
      }),
    )
    expect((getCreateBody().input as Record<string, unknown>).sound).toBe(true)
  })

  it("computes duration as sum of shot durations", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "p",
        multiShots: true,
        multiPrompt: [
          { prompt: "a", duration: 3 },
          { prompt: "b", duration: 4 },
          { prompt: "c", duration: 5 },
        ],
      }),
    )
    expect((getCreateBody().input as Record<string, unknown>).duration).toBe("12")
  })

  it("clears the top-level prompt when multi_prompt is present", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "should be ignored",
        motionPrompt: "should also be ignored",
        multiShots: true,
        multiPrompt: [{ prompt: "shot", duration: 5 }],
      }),
    )
    expect((getCreateBody().input as Record<string, unknown>).prompt).toBe("")
  })

  it("emits multi_prompt array in input", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "p",
        multiShots: true,
        multiPrompt: [
          { prompt: "x", duration: 3 },
          { prompt: "y", duration: 4 },
        ],
      }),
    )
    const input = getCreateBody().input as Record<string, unknown>
    expect(input.multi_shots).toBe(true)
    expect(input.multi_prompt).toEqual([
      { prompt: "x", duration: 3 },
      { prompt: "y", duration: 4 },
    ])
  })

  it("falls back to single-shot when multiShots true but multiPrompt missing/empty", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({ prompt: "p", multiShots: true, multiPrompt: [] }),
    )
    const input = getCreateBody().input as Record<string, unknown>
    // multi_shots is still true (forces sound on) but no multi_prompt and
    // duration falls back to default 5.
    expect(input.multi_shots).toBe(true)
    expect(input.duration).toBe("5")
    expect(input.multi_prompt).toBeUndefined()
  })
})

// ===========================================================================
// 5) Prompt selection (motionPrompt > prompt) in single-shot
// ===========================================================================

describe("kling3Generate — prompt selection (single-shot)", () => {
  it("uses motionPrompt when set", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({ prompt: "ignored", motionPrompt: "use this" }),
    )
    expect((getCreateBody().input as Record<string, unknown>).prompt).toBe("use this")
  })

  it("falls back to prompt when motionPrompt is empty", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({ prompt: "use prompt", motionPrompt: "" }),
    )
    expect((getCreateBody().input as Record<string, unknown>).prompt).toBe("use prompt")
  })

  it("emits empty string when both prompt and motionPrompt are empty/undefined", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "" }))
    expect((getCreateBody().input as Record<string, unknown>).prompt).toBe("")
  })
})

// ===========================================================================
// 6) Image URLs
// ===========================================================================

describe("kling3Generate — image URLs", () => {
  it("includes image_urls when array is non-empty", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "p",
        imageUrls: ["https://a.png", "https://b.png"],
      }),
    )
    const input = getCreateBody().input as Record<string, unknown>
    expect(input.image_urls).toEqual(["https://a.png", "https://b.png"])
  })

  it("omits image_urls when empty array", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p", imageUrls: [] }))
    expect((getCreateBody().input as Record<string, unknown>).image_urls).toBeUndefined()
  })

  it("omits image_urls when undefined", async () => {
    queueSuccess()
    await withTimers(() => kling3Generate({ prompt: "p" }))
    expect((getCreateBody().input as Record<string, unknown>).image_urls).toBeUndefined()
  })
})

// ===========================================================================
// 7) Kling elements (kling_elements + name prefixing + prompt rewrites)
// ===========================================================================

describe("kling3Generate — kling_elements name prefixing", () => {
  it("emits kling_elements with element_-prefixed names", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "@cat sits on @table",
        klingElements: [
          { name: "cat", description: "an orange cat" },
          { name: "table", description: "a wooden table" },
        ],
      }),
    )
    const elements = (getCreateBody().input as Record<string, unknown>).kling_elements as Array<{ name: string; description: string }>
    expect(elements).toHaveLength(2)
    expect(elements[0].name).toBe("element_cat")
    expect(elements[1].name).toBe("element_table")
  })

  it("rewrites @name → @element_name in prompt", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "@cat sits on @table",
        klingElements: [
          { name: "cat", description: "c" },
          { name: "table", description: "t" },
        ],
      }),
    )
    expect((getCreateBody().input as Record<string, unknown>).prompt).toBe(
      "@element_cat sits on @element_table",
    )
  })

  it("rewrites @name → @element_name in element descriptions", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "@adi enters the frame",
        klingElements: [
          { name: "adi", description: "Close-up of @adi walking through the man" },
        ],
      }),
    )
    const elements = (getCreateBody().input as Record<string, unknown>).kling_elements as Array<{ name: string; description: string }>
    expect(elements[0].description).toBe("Close-up of @element_adi walking through the man")
  })

  it("preserves names that already have element_ prefix without double-prefixing", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "@element_cat sits down",
        klingElements: [
          { name: "element_cat", description: "an already-prefixed cat" },
        ],
      }),
    )
    const elements = (getCreateBody().input as Record<string, unknown>).kling_elements as Array<{ name: string }>
    expect(elements[0].name).toBe("element_cat")
    // Prompt should not become @element_element_cat
    expect((getCreateBody().input as Record<string, unknown>).prompt).toBe(
      "@element_cat sits down",
    )
  })

  it("truncates description longer than 100 chars", async () => {
    const longDesc = "x".repeat(150)
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "@x",
        klingElements: [{ name: "x", description: longDesc }],
      }),
    )
    const elements = (getCreateBody().input as Record<string, unknown>).kling_elements as Array<{ description: string }>
    expect(elements[0].description.length).toBe(100)
    expect(elements[0].description).toBe("x".repeat(100))
  })

  it("preserves descriptions <= 100 chars", async () => {
    const exactDesc = "y".repeat(100)
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "@y",
        klingElements: [{ name: "y", description: exactDesc }],
      }),
    )
    const elements = (getCreateBody().input as Record<string, unknown>).kling_elements as Array<{ description: string }>
    expect(elements[0].description.length).toBe(100)
  })

  it("includes element_input_urls when provided", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "@a",
        klingElements: [
          { name: "a", description: "d", element_input_urls: ["https://img.png"] },
        ],
      }),
    )
    const elements = (getCreateBody().input as Record<string, unknown>).kling_elements as Array<{ element_input_urls?: string[] }>
    expect(elements[0].element_input_urls).toEqual(["https://img.png"])
  })

  it("includes element_input_video_urls when provided", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "@v",
        klingElements: [
          { name: "v", description: "d", element_input_video_urls: ["https://vid.mp4"] },
        ],
      }),
    )
    const elements = (getCreateBody().input as Record<string, unknown>).kling_elements as Array<{ element_input_video_urls?: string[] }>
    expect(elements[0].element_input_video_urls).toEqual(["https://vid.mp4"])
  })

  it("avoids partial-prefix collisions: 'cat' inside 'cat2' is rewritten correctly", async () => {
    // Sort-by-length-desc in applyElementNamePrefixes prevents @cat2 from
    // being matched as @cat-with-suffix during the @cat → @element_cat
    // pass. Verify @cat2 stays intact even when @cat is also defined.
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "@cat and @cat2 are different",
        klingElements: [
          { name: "cat", description: "first" },
          { name: "cat2", description: "second" },
        ],
      }),
    )
    expect((getCreateBody().input as Record<string, unknown>).prompt).toBe(
      "@element_cat and @element_cat2 are different",
    )
  })

  it("rewrites @names inside multi_prompt entries too", async () => {
    queueSuccess()
    await withTimers(() =>
      kling3Generate({
        prompt: "ignored",
        multiShots: true,
        multiPrompt: [
          { prompt: "@cat appears", duration: 3 },
          { prompt: "@cat exits", duration: 4 },
        ],
        klingElements: [{ name: "cat", description: "an orange cat" }],
      }),
    )
    const input = getCreateBody().input as Record<string, unknown>
    expect(input.multi_prompt).toEqual([
      { prompt: "@element_cat appears", duration: 3 },
      { prompt: "@element_cat exits", duration: 4 },
    ])
  })
})

// ===========================================================================
// 8) Create-task error paths
// ===========================================================================

describe("kling3Generate — create-task errors", () => {
  it("throws on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("server error", 500))
    await expect(
      withTimers(() => kling3Generate({ prompt: "p" })),
    ).rejects.toThrow(/Kling 3\.0/)
  })

  it("throws on non-JSON response", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("<html>error</html>"))
    await expect(
      withTimers(() => kling3Generate({ prompt: "p" })),
    ).rejects.toThrow(/Kling 3\.0/)
  })

  it("throws when code is not 200/0", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 999, msg: "internal" }))
    await expect(
      withTimers(() => kling3Generate({ prompt: "p" })),
    ).rejects.toThrow(/Kling 3\.0/)
  })

  it("throws when taskId is missing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }))
    await expect(
      withTimers(() => kling3Generate({ prompt: "p" })),
    ).rejects.toThrow(/Kling 3\.0/)
  })

  it("accepts code: 0 (some endpoints prefer this)", async () => {
    queueSuccess("via-code-zero")
    const result = await withTimers(() => kling3Generate({ prompt: "p" }))
    expect(result.taskId).toBe("via-code-zero")
  })

  it("accepts code: 200", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: { taskId: "via-200" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "success", videoUrl: "u" },
      }))
    const result = await withTimers(() => kling3Generate({ prompt: "p" }))
    expect(result.taskId).toBe("via-200")
  })
})

// ===========================================================================
// 9) Polling — URL extraction fallback chain
// ===========================================================================

describe("kling3Generate — URL extraction (success path)", () => {
  async function pollSuccess(pollData: Record<string, unknown>): Promise<string> {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({ data: pollData }))
    const result = await withTimers(() => kling3Generate({ prompt: "p" }))
    return result.videoUrl
  }

  it("uses videoUrl (camelCase) at top level", async () => {
    expect(await pollSuccess({ state: "success", videoUrl: "https://A.mp4" }))
      .toBe("https://A.mp4")
  })

  it("falls back to video_url (snake_case)", async () => {
    expect(await pollSuccess({ state: "success", video_url: "https://B.mp4" }))
      .toBe("https://B.mp4")
  })

  it("falls back to resultUrl", async () => {
    expect(await pollSuccess({ state: "success", resultUrl: "https://C.mp4" }))
      .toBe("https://C.mp4")
  })

  it("falls back to result_url (snake_case)", async () => {
    expect(await pollSuccess({ state: "success", result_url: "https://D.mp4" }))
      .toBe("https://D.mp4")
  })

  it("falls back to resultJson.resultUrls[0] (object form)", async () => {
    expect(await pollSuccess({
      state: "success",
      resultJson: { resultUrls: ["https://E.mp4"] },
    })).toBe("https://E.mp4")
  })

  it("falls back to resultJson.videoUrl", async () => {
    expect(await pollSuccess({
      state: "success",
      resultJson: { videoUrl: "https://F.mp4" },
    })).toBe("https://F.mp4")
  })

  it("falls back to resultJson.video_url", async () => {
    expect(await pollSuccess({
      state: "success",
      resultJson: { video_url: "https://G.mp4" },
    })).toBe("https://G.mp4")
  })

  it("parses resultJson when it's a JSON-encoded string", async () => {
    expect(await pollSuccess({
      state: "success",
      resultJson: JSON.stringify({ resultUrls: ["https://H.mp4"] }),
    })).toBe("https://H.mp4")
  })

  it("treats state 'completed' as success too", async () => {
    expect(await pollSuccess({ state: "completed", videoUrl: "https://done.mp4" }))
      .toBe("https://done.mp4")
  })

  it("throws when state=success but no URL is found anywhere", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { state: "success" } }))
    await expect(
      withTimers(() => kling3Generate({ prompt: "p" })),
    ).rejects.toThrow(/Kling 3\.0/)
  })
})

// ===========================================================================
// 10) Polling — failure / timeout / resilience
// ===========================================================================

describe("kling3Generate — polling failure paths", () => {
  it("throws on state=fail", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        // Use a neutral failMsg so the sanitizer hits the generic
        // "<context> failed" branch, not a transient-error mapping (e.g.
        // "rate limited" is rewritten to "Service is temporarily busy").
        data: { state: "fail", failMsg: "internal error" },
      }))
    await expect(
      withTimers(() => kling3Generate({ prompt: "p" })),
    ).rejects.toThrow(/Kling 3\.0/)
  })

  it("throws on state=failed", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "failed", fail_msg: "snake-case fail" },
      }))
    await expect(
      withTimers(() => kling3Generate({ prompt: "p" })),
    ).rejects.toThrow(/Kling 3\.0/)
  })

  it("throws on state=error with errorMessage fallback", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "error", errorMessage: "internal" },
      }))
    await expect(
      withTimers(() => kling3Generate({ prompt: "p" })),
    ).rejects.toThrow(/Kling 3\.0/)
  })

  it("uses status field as fallback when state is missing", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { status: "success", videoUrl: "u" },
      }))
    const result = await withTimers(() => kling3Generate({ prompt: "p" }))
    expect(result.videoUrl).toBe("u")
  })

  it("continues polling when poll response has no data field", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({})) // no data
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "success", videoUrl: "u" },
      }))
    const result = await withTimers(() => kling3Generate({ prompt: "p" }))
    expect(result.videoUrl).toBe("u")
  })

  it("continues polling on non-200 poll responses", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(textResponse("transient", 503))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "success", videoUrl: "u" },
      }))
    const result = await withTimers(() => kling3Generate({ prompt: "p" }))
    expect(result.videoUrl).toBe("u")
  })

  it("continues polling on invalid-JSON poll responses", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(textResponse("not json"))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "success", videoUrl: "u" },
      }))
    const result = await withTimers(() => kling3Generate({ prompt: "p" }))
    expect(result.videoUrl).toBe("u")
  })
})

// ===========================================================================
// 11) onProgress callback
// ===========================================================================

describe("kling3Generate — onProgress", () => {
  it("invokes onProgress with progress value when present", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "queued", progress: 25 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "generating", progress: 75 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "success", videoUrl: "u", progress: 100 },
      }))
    const onProgress = vi.fn()

    await withTimers(() => kling3Generate({ prompt: "p", onProgress }))

    expect(onProgress).toHaveBeenCalledWith(25)
    expect(onProgress).toHaveBeenCalledWith(75)
    expect(onProgress).toHaveBeenCalledWith(100)
  })

  it("does not invoke onProgress when progress is missing from poll response", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "success", videoUrl: "u" },
      }))
    const onProgress = vi.fn()

    await withTimers(() => kling3Generate({ prompt: "p", onProgress }))

    expect(onProgress).not.toHaveBeenCalled()
  })

  it("awaits async onProgress callbacks", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { taskId: "t" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { state: "success", videoUrl: "u", progress: 100 },
      }))
    let resolved = false
    const onProgress = vi.fn(async () => {
      await new Promise<void>((r) => {
        setTimeout(() => { resolved = true; r() }, 0)
      })
    })

    await withTimers(() => kling3Generate({ prompt: "p", onProgress }))

    expect(onProgress).toHaveBeenCalledOnce()
    expect(resolved).toBe(true)
  })
})
