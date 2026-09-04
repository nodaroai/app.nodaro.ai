import { describe, expect, it } from "vitest"

import { redactPrivateJobData } from "../public-job-data.js"

describe("redactPrivateJobData", () => {
  it("removes unscoredUrl recursively while preserving siblings and arrays", () => {
    const source = {
      output_data: {
        pro: {
          unscoredUrl: "https://private.example/base.mp4",
          publicUrl: "https://public.example/final.mp4",
        },
        layers: [
          { kind: "dialogue", unscoredUrl: "https://private.example/dialogue.mp4" },
          { kind: "music", url: "https://public.example/music.m4a" },
        ],
      },
    }

    expect(redactPrivateJobData(source)).toEqual({
      output_data: {
        pro: { publicUrl: "https://public.example/final.mp4" },
        layers: [
          { kind: "dialogue" },
          { kind: "music", url: "https://public.example/music.m4a" },
        ],
      },
    })
    expect(source.output_data.pro.unscoredUrl).toContain("private.example")
  })

  it("terminates on cyclic values without mutating or losing graph identity", () => {
    const source: Record<string, unknown> = {
      label: "root",
      unscoredUrl: "https://private.example/base.mp4",
    }
    source.self = source

    const redacted = redactPrivateJobData(source)

    expect(redacted).not.toBe(source)
    expect(redacted).not.toHaveProperty("unscoredUrl")
    expect(redacted.self).toBe(redacted)
    expect(source).toHaveProperty("unscoredUrl")
  })
})

/**
 * `redactPrivateJobData` runs over the WHOLE job row before the allowlist pick
 * (routes/jobs.ts's sanitizeJobForPublic), so it is the last place a withheld
 * payload could be copied out of. It must not resurrect one: the held columns
 * are dropped by the allowlist, and this asserts the redactor leaves them
 * exactly where they were rather than promoting anything out of them.
 */
describe("a held job's quarantined payload passes through untouched (D6)", () => {
  it("does not merge, rename or promote held_* into output_data", () => {
    const source = {
      status: "pending_review",
      output_data: null,
      held_output_data: { videoUrl: "https://cdn.example.com/videos/j1.mp4", unscoredUrl: "https://private.example/base.mp4" },
      held_completion_fields: { provider: "kie", metered: true },
      held_objects: [{ key: "videos/j1.mp4", kind: "video", index: 0 }],
    }
    const out = redactPrivateJobData(source) as Record<string, unknown>
    expect(out.output_data).toBeNull()
    // The recursive unscoredUrl redaction still applies wherever it appears —
    // it is about the Recast remux base, not about the hold.
    expect(out.held_output_data).toEqual({ videoUrl: "https://cdn.example.com/videos/j1.mp4" })
    // and nothing was hoisted:
    expect(Object.keys(out).sort()).toEqual(
      ["held_completion_fields", "held_objects", "held_output_data", "output_data", "status"],
    )
  })
})
