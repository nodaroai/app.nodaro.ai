import { describe, it, expect, afterEach } from "vitest"
import { clearPromptPolicies, registerPromptPolicy } from "../../../lib/prompt-policy.js"
import type { UnitPayloadKit } from "../../kit.js"
import { payload } from "../payload.js"

/**
 * The workflow payload: the mode's own settings and the pictures wired into
 * its own inputs (the image lane), charged the row the route charges for the
 * same run, the prompt policed here. A run that cannot be sent fails before
 * anything is reserved.
 */
function kitOf(data: Record<string, unknown>, resolved: Record<string, unknown> = {}): UnitPayloadKit {
  return {
    node: { id: "n1", type: "long-image", data },
    data,
    resolvedInputs: resolved,
    jobId: "job-1",
    usageLogId: "ul-1",
    ffmpegResult: (jobName: string, p: Record<string, unknown>, modelIdentifier = jobName) => ({ jobName, queueName: "video-generation", payload: p, modelIdentifier }),
  } as unknown as UnitPayloadKit
}

const A = "https://r2/a.png"
const B = "https://r2/b.png"

afterEach(() => clearPromptPolicies())

describe("long-image payload", () => {
  it("a webpage design from the node's prompt, at the defaults", () => {
    const r = payload(kitOf({ label: "Long Image", prompt: " a bakery page ", mode: "webpage", fieldMappings: {} }))
    expect(r.jobName).toBe("long-image")
    expect(r.modelIdentifier).toBe("long-image:webpage:2K")
    expect(r.payload).toEqual({ jobId: "job-1", mode: "webpage", resolution: "2K", prompt: "a bakery page", inputImages: 0, model: "kling-4-long-image", usageLogId: "ul-1" })
  })

  it("wired text wins, and the webpage pictures come from their own inputs; the product inputs are not read", () => {
    const r = payload(kitOf({ prompt: "own", resolution: "1K" }, { prompt: "wired prompt", unitInputs: { styleImage: A, subjectImage: B, productImage1: "https://r2/ignored.png" } }))
    expect(r.modelIdentifier).toBe("long-image:webpage:1K:2ref")
    expect(r.payload).toMatchObject({ prompt: "wired prompt", styleImageUrl: A, subjectImageUrl: B, inputImages: 2 })
    expect(r.payload).not.toHaveProperty("productImageUrls")
  })

  it("a product page keeps each picture's input as its place", () => {
    const r = payload(kitOf({ mode: "ecommerce", length: "short", prompt: "@image_3 first" }, { unitInputs: { productImage1: A, productImage3: B, styleImage: "https://r2/ignored.png" } }))
    expect(r.modelIdentifier).toBe("long-image:ecommerce:short:2K:2ref")
    expect(r.payload).toMatchObject({ mode: "ecommerce", length: "short", productImageUrls: [A, null, B], inputImages: 2 })
    expect(r.payload).not.toHaveProperty("styleImageUrl")
  })

  it("never reads a picture off the node's data", () => {
    const r = payload(kitOf({ prompt: "p", styleImageUrl: A }))
    expect(r.payload).not.toHaveProperty("styleImageUrl")
    expect(r.modelIdentifier).toBe("long-image:webpage:2K")
  })

  it("refuses, before anything is reserved: no prompt, a product page with no picture, a wired input that made no picture, something that is not a picture", () => {
    expect(() => payload(kitOf({ prompt: "  " }))).toThrow(/needs a prompt/)
    expect(() => payload(kitOf({ mode: "ecommerce", prompt: "p" }))).toThrow(/one to three product pictures/)
    expect(() => payload(kitOf({ mode: "ecommerce", prompt: "p" }, { unitInputs: { productImage1: A, productImage2: "" } }))).toThrow(/Product image 2 is wired, but its input made no picture/)
    expect(() => payload(kitOf({ prompt: "p" }, { unitInputs: { styleImage: "a caption" } }))).toThrow(/Style image is wired to something that is not a picture/)
    // The other mode's wired-but-empty input is not read.
    expect(() => payload(kitOf({ prompt: "p" }, { unitInputs: { productImage1: "" } }))).not.toThrow()
  })

  it("sends the policed prompt", () => {
    registerPromptPolicy({ id: "test", apply: (a) => ({ ...a, prompt: `${a.prompt} [policed]` }) })
    expect(payload(kitOf({ prompt: "a menu" })).payload).toMatchObject({ prompt: "a menu [policed]" })
  })
})
