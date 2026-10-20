import { describe, expect, it } from "vitest"

import { isServerOnlyOutputKey, withoutServerOnlyKeys } from "../job-output-visibility.js"
import { redactPrivateJobData, redactPrivateJobOutput } from "../public-job-data.js"

describe("isServerOnlyOutputKey", () => {
  it("is true only for a double-underscore prefix", () => {
    expect(isServerOnlyOutputKey("__resume")).toBe(true)
    expect(isServerOnlyOutputKey("__")).toBe(true)
    expect(isServerOnlyOutputKey("_single")).toBe(false)
    expect(isServerOnlyOutputKey("videoUrl")).toBe(false)
    expect(isServerOnlyOutputKey("a__b")).toBe(false)
  })
})

describe("withoutServerOnlyKeys", () => {
  it("drops top-level __ keys and keeps every other key, without mutating the input", () => {
    const output = { videoUrl: "https://public.example/v.mp4", __stage: { step: 3 }, __x: 1, _keep: true }
    expect(withoutServerOnlyKeys(output)).toEqual({ videoUrl: "https://public.example/v.mp4", _keep: true })
    expect(output).toHaveProperty("__stage")
  })

  it("keeps a nested __ key (only output_data's own keys are server-only)", () => {
    const output = { json: { __nested: 1, a: 2 } }
    expect(withoutServerOnlyKeys(output)).toEqual({ json: { __nested: 1, a: 2 } })
  })

  it("passes null, undefined, arrays and scalars through unchanged", () => {
    expect(withoutServerOnlyKeys(null)).toBeNull()
    expect(withoutServerOnlyKeys(undefined)).toBeUndefined()
    const arr = [{ __x: 1 }]
    expect(withoutServerOnlyKeys(arr)).toBe(arr)
    expect(withoutServerOnlyKeys("text")).toBe("text")
  })

  it("returns the same object when there is nothing to drop", () => {
    const output = { imageUrl: "https://public.example/i.png" }
    expect(withoutServerOnlyKeys(output)).toBe(output)
  })
})

describe("redactPrivateJobData — server-only output keys", () => {
  it("strips __ keys from a row's output_data, wherever the row sits in the answer", () => {
    const answer = {
      data: [
        {
          id: "j1",
          input_data: { __nodaroContinue: { from: "x" }, prompt: "p" },
          output_data: { videoUrl: "https://public.example/v.mp4", __checkpoint: { stage: 2 } },
        },
      ],
    }
    expect(redactPrivateJobData(answer)).toEqual({
      data: [
        {
          id: "j1",
          // input_data is not output_data: the ruling covers output keys only.
          input_data: { __nodaroContinue: { from: "x" }, prompt: "p" },
          output_data: { videoUrl: "https://public.example/v.mp4" },
        },
      ],
    })
    expect(answer.data[0]!.output_data).toHaveProperty("__checkpoint")
  })

  it("redactPrivateJobOutput strips both __ keys and unscoredUrl from a bare output_data", () => {
    expect(
      redactPrivateJobOutput({ __checkpoint: 1, pro: { unscoredUrl: "https://private.example/b.mp4", url: "u" }, videoUrl: "v" }),
    ).toEqual({ pro: { url: "u" }, videoUrl: "v" })
    expect(redactPrivateJobOutput(null)).toBeNull()
  })
})
