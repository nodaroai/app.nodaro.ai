import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../client.js", () => ({
  MAX_POLL_ATTEMPTS_VIDEO: 120,
  createKieTask: vi.fn(),
  pollKieTask: vi.fn(),
  createSanitizedError: (msg: string) => new Error(msg),
}))

import { createKieTask, pollKieTask } from "../client.js"
import { runPixverseExtend, PIXVERSE_EXTEND_FIELDS } from "../pixverse-extend.js"

const create = vi.mocked(createKieTask)
const poll = vi.mocked(pollKieTask)

const SOURCE = "https://cdn.example/source.mp4"
const BASE = { videoUrl: SOURCE, prompt: "the camera keeps drifting toward the lighthouse", durationSec: 5, quality: "540p" as const, sound: true }

/** The `input` of the one createTask call. */
function sentInput(): Record<string, unknown> {
  expect(create).toHaveBeenCalledTimes(1)
  return create.mock.calls[0]![1]
}

beforeEach(() => {
  create.mockReset()
  poll.mockReset()
  create.mockResolvedValue({ taskId: "task-pv-1" })
  poll.mockResolvedValue({ resultJson: { resultUrls: ["https://tempfile.example/out.mp4"] }, taskId: "task-pv-1", providerMs: 41_000 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("runPixverseExtend — the request", () => {
  it("sends video_url, never taskId", async () => {
    await runPixverseExtend({ ...BASE, seed: 7 })
    expect(create.mock.calls[0]![0]).toBe("pixverse-v6/extend")
    const input = sentInput()
    expect(input.video_url).toBe(SOURCE)
    expect(input).not.toHaveProperty("taskId")
    expect(input).not.toHaveProperty("task_id")
    // An explicit allow-list: exactly the documented fields of the video-URL form.
    expect(Object.keys(input).sort()).toEqual([...PIXVERSE_EXTEND_FIELDS].sort())
    expect(input).toEqual({
      prompt: BASE.prompt,
      duration: 5,
      quality: "540p",
      generate_audio_switch: true,
      seed: 7,
      video_url: SOURCE,
    })
  })

  it("fills a random seed", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    await runPixverseExtend(BASE)
    const seed = sentInput().seed
    expect(seed).toBe(1073741824)

    // Any draw lands on a whole number inside the schema's range, the top included.
    for (const draw of [0, 0.999999999999]) {
      create.mockClear()
      vi.spyOn(Math, "random").mockReturnValue(draw)
      await runPixverseExtend(BASE)
      const s = sentInput().seed as number
      expect(Number.isInteger(s)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(2147483647)
    }

    // A given seed is kept — 0 included.
    create.mockClear()
    await runPixverseExtend({ ...BASE, seed: 0 })
    expect(sentInput().seed).toBe(0)
  })

  // The schema requires a seed in 0..2147483647 and KIE refuses any other after
  // the run is reserved: a seed the caller gave that it would refuse (-1, the
  // common "random" spelling, a fraction, one past either end) is replaced by
  // a random one, as an absent seed is.
  it("replaces a seed the schema refuses with a random one in range", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.25)
    for (const bad of [-1, 1.5, 2147483648, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      create.mockClear()
      await runPixverseExtend({ ...BASE, seed: bad })
      const s = sentInput().seed as number
      expect(s, String(bad)).toBe(536870912)
      expect(Number.isInteger(s) && s >= 0 && s <= 2147483647, String(bad)).toBe(true)
    }
    // Both ends of the range are seeds it takes as they are.
    for (const edge of [0, 2147483647, 42]) {
      create.mockClear()
      await runPixverseExtend({ ...BASE, seed: edge })
      expect(sentInput().seed).toBe(edge)
    }
  })

  it("passes the quality and sound through", async () => {
    for (const quality of ["360p", "540p", "720p", "1080p"] as const) {
      for (const sound of [true, false]) {
        create.mockClear()
        await runPixverseExtend({ ...BASE, quality, sound, durationSec: 12, seed: 1 })
        const input = sentInput()
        expect(input.quality).toBe(quality)
        expect(input.generate_audio_switch).toBe(sound)
        // An integer duration — never the string the generic path sends.
        expect(input.duration).toBe(12)
      }
    }
  })

  it("sends the prompt as written", async () => {
    await runPixverseExtend({ ...BASE, prompt: "  keep the @image_1 flag waving  ", seed: 1 })
    expect(sentInput().prompt).toBe("  keep the @image_1 flag waving  ")
  })
})

describe("runPixverseExtend — the task", () => {
  it("names our model key and the run's levers to the egress seam, fires onTaskCreated, and polls on the video budget", async () => {
    const onTaskCreated = vi.fn(async () => undefined)
    const onProgress = vi.fn()
    await runPixverseExtend({ ...BASE, quality: "1080p", sound: false, durationSec: 8, seed: 3 }, { onTaskCreated, dimensions: { userTier: "pro" } }, onProgress)
    expect(create.mock.calls[0]![2]).toEqual({
      modelKey: "pixverse-v6-extend",
      dimensions: expect.objectContaining({ resolution: "1080p", audio: false, duration: 8, videoInput: true, userTier: "pro" }),
    })
    expect(onTaskCreated).toHaveBeenCalledWith("task-pv-1")
    expect(poll).toHaveBeenCalledWith("task-pv-1", 120, onProgress)
  })

  it("returns the output URL, KIE's task id and the provider time", async () => {
    await expect(runPixverseExtend({ ...BASE, seed: 1 })).resolves.toEqual({
      url: "https://tempfile.example/out.mp4",
      kieTaskId: "task-pv-1",
      providerMs: 41_000,
    })
  })

  it("reads a videoUrl result too, and fails — never an empty success — when the task returns no URL", async () => {
    poll.mockResolvedValueOnce({ resultJson: { videoUrl: "https://tempfile.example/v.mp4" }, taskId: "task-pv-1" })
    await expect(runPixverseExtend({ ...BASE, seed: 1 })).resolves.toMatchObject({ url: "https://tempfile.example/v.mp4" })
    poll.mockResolvedValueOnce({ resultJson: {}, taskId: "task-pv-1" })
    await expect(runPixverseExtend({ ...BASE, seed: 1 })).rejects.toThrow(/no URL/)
  })
})
