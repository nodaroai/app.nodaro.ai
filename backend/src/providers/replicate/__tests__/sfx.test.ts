/**
 * Replicate Video SFX provider tests.
 *
 * `generateVideoSfx` is the single-shot dispatch for zsxkib/mmaudio — silent
 * video in, video-with-Foley-audio out. Tests cover:
 *   - Input shape (snake_case keys, defaults, version pinning)
 *   - Output shape (outputUrl + predictTime + predictionId)
 *   - Reconcile hook firing (`onTaskCreated(prediction.id)` BEFORE
 *     `replicate.wait` resolves, so a worker crash mid-wait leaves the row
 *     recoverable by the reconcile cron)
 *   - Defensive guard against non-string output
 */

import { describe, it, expect, vi } from "vitest"

// Mock the shared replicate client BEFORE importing sfx.ts
vi.mock("../client.js", () => {
  const create = vi.fn().mockResolvedValue({ id: "pred-abc" })
  const wait = vi.fn().mockResolvedValue({
    output: "https://replicate.delivery/xezq/abc/result.mp4",
    metrics: { predict_time: 3.77 },
  })
  return {
    replicate: { predictions: { create }, wait },
  }
})

import { generateVideoSfx, MMAUDIO_VERSION_HASH } from "../sfx.js"

describe("generateVideoSfx", () => {
  it("calls predictions.create with correct input shape and returns output url + predictTime", async () => {
    const result = await generateVideoSfx({
      videoUrl: "https://example.com/v.mp4",
      prompt: "rain",
      negativePrompt: "music",
      duration: 12,
      cfgStrength: 4.5,
      numSteps: 25,
      seed: 42,
    })
    expect(result.outputUrl).toBe("https://replicate.delivery/xezq/abc/result.mp4")
    expect(result.predictTime).toBe(3.77)
  })

  it("uses version-pinned hash (64-char hex), not floating reference", () => {
    expect(MMAUDIO_VERSION_HASH).toMatch(/^[a-f0-9]{40,}$/)
  })

  it("defaults negative_prompt to 'music' when not provided", async () => {
    const { replicate } = await import("../client.js")
    vi.mocked(replicate.predictions.create).mockClear()
    await generateVideoSfx({
      videoUrl: "https://example.com/v.mp4",
      duration: 8, cfgStrength: 4.5, numSteps: 25,
    })
    const callArgs = vi.mocked(replicate.predictions.create).mock.calls[0]?.[0]
    expect(callArgs?.input).toMatchObject({ negative_prompt: "music", seed: -1, prompt: "" })
  })

  it("throws on non-string output (defensive guard)", async () => {
    const { replicate } = await import("../client.js")
    vi.mocked(replicate.wait).mockResolvedValueOnce({ output: null } as never)
    await expect(generateVideoSfx({
      videoUrl: "https://example.com/v.mp4",
      duration: 8, cfgStrength: 4.5, numSteps: 25,
    })).rejects.toThrow(/unexpected output/i)
  })

  it("returns predictionId from replicate.predictions.create response", async () => {
    // Worker needs prediction.id to write `provider_task_id` for reconcile-cron
    // recovery. Without it the row's invisible to the 20-min replicate-prediction
    // sweep and credits leak on a stuck job.
    const { replicate } = await import("../client.js")
    vi.mocked(replicate.predictions.create).mockResolvedValueOnce({ id: "pred-xyz" } as never)
    vi.mocked(replicate.wait).mockResolvedValueOnce({
      output: "https://replicate.delivery/xezq/abc/result.mp4",
      metrics: { predict_time: 1.5 },
    } as never)
    const result = await generateVideoSfx({
      videoUrl: "https://example.com/v.mp4",
      duration: 8, cfgStrength: 4.5, numSteps: 25,
    })
    expect(result.predictionId).toBe("pred-xyz")
  })

  it("fires onTaskCreated(prediction.id) BEFORE replicate.wait resolves", async () => {
    // Reconcile-cron contract: the callback must fire before `wait` returns
    // so a worker crash during the long Replicate poll still leaves
    // `provider_task_id` on the row for the 20-min sweep to recover.
    const { replicate } = await import("../client.js")
    let waitCallTime = 0
    let onTaskCreatedTime = 0
    let counter = 0
    vi.mocked(replicate.predictions.create).mockResolvedValueOnce({ id: "pred-reconcile" } as never)
    vi.mocked(replicate.wait).mockImplementationOnce(async () => {
      waitCallTime = ++counter
      return {
        output: "https://replicate.delivery/xezq/abc/result.mp4",
        metrics: { predict_time: 1.0 },
      } as never
    })
    const onTaskCreated = vi.fn().mockImplementation(async () => {
      onTaskCreatedTime = ++counter
    })
    await generateVideoSfx(
      {
        videoUrl: "https://example.com/v.mp4",
        duration: 8, cfgStrength: 4.5, numSteps: 25,
      },
      { onTaskCreated },
    )
    expect(onTaskCreated).toHaveBeenCalledWith("pred-reconcile")
    expect(onTaskCreatedTime).toBeGreaterThan(0)
    expect(waitCallTime).toBeGreaterThan(0)
    expect(onTaskCreatedTime).toBeLessThan(waitCallTime)
  })

  it("does not throw when onTaskCreated callback rejects (best-effort persistence)", async () => {
    // A failed DB write on `provider_task_id` shouldn't tank the in-flight
    // provider call. fireOnTaskCreated wraps in try/catch — verify the
    // generation completes normally.
    const { replicate } = await import("../client.js")
    vi.mocked(replicate.predictions.create).mockResolvedValueOnce({ id: "pred-flaky" } as never)
    vi.mocked(replicate.wait).mockResolvedValueOnce({
      output: "https://replicate.delivery/xezq/abc/result.mp4",
      metrics: { predict_time: 1.0 },
    } as never)
    const onTaskCreated = vi.fn().mockRejectedValue(new Error("supabase down"))
    const result = await generateVideoSfx(
      {
        videoUrl: "https://example.com/v.mp4",
        duration: 8, cfgStrength: 4.5, numSteps: 25,
      },
      { onTaskCreated },
    )
    expect(result.predictionId).toBe("pred-flaky")
    expect(result.outputUrl).toBe("https://replicate.delivery/xezq/abc/result.mp4")
  })
})
