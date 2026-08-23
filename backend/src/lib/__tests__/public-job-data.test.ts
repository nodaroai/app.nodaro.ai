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
