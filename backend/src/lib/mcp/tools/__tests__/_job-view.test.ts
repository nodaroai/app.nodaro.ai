import { describe, it, expect } from "vitest"
import { jobView, resolveOutputUrl, assetKindOf } from "../_job-view.js"

// Audit 2026-09-06 fix #2 (A-5 / A-12): two job readers, two shapes — `get_job`
// returned the raw row as text with per-type output keys, `get_asset` a
// normalised object, and every verb pointed the agent at the weaker one. One
// envelope, built here, declared as the readers' outputSchema.
describe("jobView — the one job envelope", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "completed",
    progress: 100,
    job_type: "generate-image",
    output_data: { imageUrl: "https://r2/x.png", prompt: "a cat" },
    error_message: null,
    error_hint: null,
    credits: 12,
    created_at: "2026-09-06T10:00:00Z",
    started_at: "2026-09-06T10:00:01Z",
    completed_at: "2026-09-06T10:00:20Z",
  }

  it("resolves the output url and asset kind from the per-type output keys", () => {
    expect(resolveOutputUrl({ imageUrl: "a" })).toBe("a")
    expect(resolveOutputUrl({ videoUrl: "v" })).toBe("v")
    expect(resolveOutputUrl({ audioUrl: "au" })).toBe("au")
    expect(resolveOutputUrl({ outputUrl: "o" })).toBe("o")
    expect(resolveOutputUrl({ url: "u" })).toBe("u")
    expect(resolveOutputUrl({})).toBeNull()
    expect(assetKindOf({ imageUrl: "a" })).toBe("image")
    expect(assetKindOf({ videoUrl: "v" })).toBe("video")
    expect(assetKindOf({ audioUrl: "au" })).toBe("audio")
    expect(assetKindOf({ text: "t" })).toBeNull()
  })

  it("maps a completed row to the envelope", () => {
    const v = jobView(base)
    expect(v).toEqual({
      jobId: base.id,
      status: "completed",
      progress: 100,
      jobType: "generate-image",
      assetKind: "image",
      outputUrl: "https://r2/x.png",
      outputData: { imageUrl: "https://r2/x.png", prompt: "a cat" },
      input: null,
      errorMessage: null,
      credits: 12,
      createdAt: base.created_at,
      startedAt: base.started_at,
      completedAt: base.completed_at,
    })
  })

  it("adds retryable + guidance on a failure, with the catalog fallback when the hint carries one", () => {
    const v = jobView({
      ...base,
      status: "failed",
      output_data: null,
      error_message: "Content policy violation: blocked",
      error_hint: { kind: "safety-block", suggestedProvider: "flux-2-pro" },
    })
    expect(v.status).toBe("failed")
    expect(v.retryable).toBe(false)
    expect(v.suggestedProvider).toBe("flux-2-pro")
    expect(typeof v.guidance).toBe("string")
    expect(v.outputUrl).toBeNull()
  })

  it("explains a held job as not retryable and tells the agent not to re-run it", () => {
    const v = jobView({ ...base, status: "pending_review", output_data: null })
    expect(v.status).toBe("pending_review")
    expect(v.retryable).toBe(false)
    expect(v.guidance).toContain("Do NOT re-run")
  })

  it("redacts private remux bases out of outputData", () => {
    const v = jobView({
      ...base,
      job_type: "generate-video-pro",
      output_data: { videoUrl: "https://public/final.mp4", pro: { unscoredUrl: "https://private/base.mp4?token=s", audio: { revision: "a2" } } },
    })
    expect(v.outputData).toEqual({ videoUrl: "https://public/final.mp4", pro: { audio: { revision: "a2" } } })
    expect(v.outputUrl).toBe("https://public/final.mp4")
  })
})

// F12 (transition QA): a server-side prompt fold could not be verified over
// MCP, because the envelope carried no input. It now carries an ALLOWLISTED
// subset of `input_data` — never the whole request body.
describe("jobView — the job's input, allowlisted", () => {
  const row = {
    id: "22222222-2222-4222-8222-222222222222",
    status: "completed",
    job_type: "generate-video",
    output_data: { videoUrl: "https://r2/x.mp4" },
    input_data: {
      type: "generate-video",
      prompt: "a woman turns, match cut, the transition occurs in the middle of the clip",
      userPrompt: "a woman turns",
      direction: { transition: "match-cut" },
      provider: "kling-3",
      duration: 5,
      resolution: "1080p",
      imageUrl: "https://r2/a.png",
      endFrameUrl: "https://r2/b.png",
      workflowId: "wf-internal",
      nodeId: "node-internal",
      clientRequestId: "req-1",
      attachToCharacterId: "char-1",
      unscoredUrl: "https://private/remux",
      apiKey: "sk-secret",
    },
  }

  it("echoes the rendered prompt, the source prompt, direction, frames and render settings", () => {
    expect(jobView(row).input).toEqual({
      type: "generate-video",
      prompt: row.input_data.prompt,
      userPrompt: "a woman turns",
      direction: { transition: "match-cut" },
      provider: "kling-3",
      duration: 5,
      resolution: "1080p",
      imageUrl: "https://r2/a.png",
      endFrameUrl: "https://r2/b.png",
    })
  })

  it("never carries internal ids, private urls or anything off the allowlist", () => {
    const input = jobView(row).input as Record<string, unknown>
    for (const key of ["workflowId", "nodeId", "clientRequestId", "attachToCharacterId", "unscoredUrl", "apiKey"]) {
      expect(input).not.toHaveProperty(key)
    }
  })

  it("filters direction and subject to their catalogs' keys and id-shaped values", () => {
    const input = jobView({
      ...row,
      input_data: {
        direction: {
          transition: ["match-cut"],
          cameraMotion: "dolly-in",
          internalToken: "tok-1",
          shotSize: { nested: "object" },
        },
        subject: { age: "age-custom", customAge: 42, secretNote: "x", heldProp: ["cup", 3] },
      },
    }).input as Record<string, unknown>
    expect(input.direction).toEqual({ transition: ["match-cut"], cameraMotion: "dolly-in" })
    expect(input.subject).toEqual({ age: "age-custom", customAge: 42 })
  })

  it("drops a direction or subject that holds nothing from its catalog", () => {
    const input = jobView({
      ...row,
      input_data: { prompt: "p", direction: { foreign: "x" }, subject: "not-a-record" },
    }).input as Record<string, unknown>
    expect(input).toEqual({ prompt: "p" })
  })

  it("is null when the row has no input, or none of it is allowlisted", () => {
    expect(jobView({ ...row, input_data: null }).input).toBeNull()
    expect(jobView({ ...row, input_data: undefined }).input).toBeNull()
    expect(jobView({ ...row, input_data: { workflowId: "wf" } }).input).toBeNull()
  })
})
