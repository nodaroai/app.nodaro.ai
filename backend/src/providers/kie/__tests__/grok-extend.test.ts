import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../client.js", () => ({
  MAX_POLL_ATTEMPTS_VIDEO: 120,
  createKieTask: vi.fn(),
  pollKieTask: vi.fn(),
  createSanitizedError: (msg: string) => new Error(msg),
}))

import { createKieTask, pollKieTask } from "../client.js"
import { runGrokExtend, GROK_EXTEND_FIELDS } from "../grok-extend.js"

const create = vi.mocked(createKieTask)
const poll = vi.mocked(pollKieTask)

const BASE = { taskId: "task-grok-src", prompt: "the fox turns and runs into the snow", extendAtSec: 6.041667, extendSec: 6 as const }

/** The `input` of the one createTask call. */
function sentInput(): Record<string, unknown> {
  expect(create).toHaveBeenCalledTimes(1)
  return create.mock.calls[0]![1]
}

beforeEach(() => {
  create.mockReset()
  poll.mockReset()
  create.mockResolvedValue({ taskId: "task-grok-ext-1" })
  poll.mockResolvedValue({ resultJson: { resultUrls: ["https://tempfile.example/joined.mp4"] }, taskId: "task-grok-ext-1", providerMs: 52_000 })
})

describe("runGrokExtend — the request", () => {
  it("extends from the source's end", async () => {
    await runGrokExtend(BASE)
    expect(create.mock.calls[0]![0]).toBe("grok-imagine/extend")
    const input = sentInput()
    // The source's own task, by snake_case `task_id` — Grok extends only its own clips, never a URL.
    expect(input.task_id).toBe("task-grok-src")
    expect(input).not.toHaveProperty("video_url")
    expect(input).not.toHaveProperty("taskId")
    // An explicit allow-list: exactly the schema's four input fields.
    expect(Object.keys(input).sort()).toEqual([...GROK_EXTEND_FIELDS].sort())
    // The source's exact picture length, to the hundredth: extend from where it ends.
    expect(input.extend_at).toBe(6.04)

    // Cut down to the hundredth, never rounded up past the source's last frame
    // (6.29 stays 6.29: a float that lands a hair below its hundredth is not cut a hundredth short).
    for (const [sourceSec, at] of [[10, 10], [10.04, 10.04], [10.041667, 10.04], [9.999, 9.99], [6.29, 6.29], [6.0999999, 6.09], [6, 6], [2, 2], [2.005, 2]] as const) {
      create.mockClear()
      await runGrokExtend({ ...BASE, extendAtSec: sourceSec })
      expect(sentInput().extend_at, String(sourceSec)).toBe(at)
    }
    // Never before KIE's minimum of 2 s.
    for (const sourceSec of [1.5, 0.4, 0]) {
      create.mockClear()
      await runGrokExtend({ ...BASE, extendAtSec: sourceSec })
      expect(sentInput().extend_at, String(sourceSec)).toBe(2)
    }
    // A number on the wire, never a string.
    expect(typeof sentInput().extend_at).toBe("number")
  })

  it("refuses an unknown source length before calling KIE", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      create.mockClear()
      await expect(runGrokExtend({ ...BASE, extendAtSec: bad })).rejects.toThrow(/source length/)
      expect(create).not.toHaveBeenCalled()
    }
  })

  it('sends extend_times as "6" or "10"', async () => {
    for (const extendSec of [6, 10] as const) {
      create.mockClear()
      await runGrokExtend({ ...BASE, extendSec })
      const sent = sentInput().extend_times
      expect(sent).toBe(String(extendSec))
      expect(typeof sent).toBe("string")
    }
    // Any other length is refused before KIE is called (its schema takes only these two).
    for (const extendSec of [5, 8, 15]) {
      create.mockClear()
      await expect(runGrokExtend({ ...BASE, extendSec: extendSec as 6 })).rejects.toThrow(/6 or 10/)
      expect(create).not.toHaveBeenCalled()
    }
  })

  it("sends the prompt as written", async () => {
    await runGrokExtend({ ...BASE, prompt: "  keep the @image_1 lantern swinging  " })
    expect(sentInput().prompt).toBe("  keep the @image_1 lantern swinging  ")
  })

  it("refuses a blank source task before calling KIE", async () => {
    await expect(runGrokExtend({ ...BASE, taskId: "  " })).rejects.toThrow(/task/)
    expect(create).not.toHaveBeenCalled()
  })
})

describe("runGrokExtend — the task", () => {
  it("names our model key and the seconds added to the egress seam, keeps the caller's dimensions, fires onTaskCreated, and polls on the video budget", async () => {
    const onTaskCreated = vi.fn(async () => undefined)
    const onProgress = vi.fn()
    await runGrokExtend({ ...BASE, extendSec: 10 }, { onTaskCreated, dimensions: { resolution: "720p", userTier: "pro" } }, onProgress)
    expect(create.mock.calls[0]![2]).toEqual({
      modelKey: "grok-extend",
      dimensions: expect.objectContaining({ resolution: "720p", userTier: "pro", duration: 10, durationLabel: "10s" }),
    })
    expect(onTaskCreated).toHaveBeenCalledWith("task-grok-ext-1")
    expect(poll).toHaveBeenCalledWith("task-grok-ext-1", 120, onProgress)
  })

  it("returns the output URL, KIE's task id and the provider time", async () => {
    await expect(runGrokExtend(BASE)).resolves.toEqual({
      url: "https://tempfile.example/joined.mp4",
      kieTaskId: "task-grok-ext-1",
      providerMs: 52_000,
    })
  })

  it("reads a videoUrl result too, and fails — never an empty success — when the task returns no URL", async () => {
    poll.mockResolvedValueOnce({ resultJson: { videoUrl: "https://tempfile.example/v.mp4" }, taskId: "task-grok-ext-1" })
    await expect(runGrokExtend(BASE)).resolves.toMatchObject({ url: "https://tempfile.example/v.mp4" })
    poll.mockResolvedValueOnce({ resultJson: {}, taskId: "task-grok-ext-1" })
    await expect(runGrokExtend(BASE)).rejects.toThrow(/no URL/)
  })
})
