import { describe, it, expect } from "vitest"
import { KieError } from "../../providers/kie/client.js"
import {
  safetyBlockOf,
  isFinalAttemptFor,
  errorHintFor,
  inputRefusedHint,
  inputVideoRefusedOf,
  sentVideoInput,
  refusalHintFor,
  jobModelIdOf,
  safetyBlockMessage,
  fallbackLabelOf,
  type SafetyBlock,
} from "../safety-block.js"

function kieError(contentPolicyClass: "copyright" | "likeness" | "safety", message = "blocked"): KieError {
  return new KieError(message, "internal detail", "test-context", true, true, contentPolicyClass)
}

function duckTypedError(contentPolicyClass: "copyright" | "likeness" | "safety"): Error {
  return Object.assign(new Error("blocked"), { contentPolicyClass })
}

describe("safetyBlockOf", () => {
  it("classifies a safety block on a flagged model with the catalog's maxAttempts + fallback", () => {
    expect(safetyBlockOf(kieError("safety"), "gpt-image-2")).toEqual({
      class: "safety",
      maxAttempts: 2,
      fallback: "nano-banana-pro",
    })
  })

  it("classifies a safety block on an unflagged model with a single attempt and no fallback", () => {
    expect(safetyBlockOf(kieError("safety"), "nano-banana-pro")).toEqual({
      class: "safety",
      maxAttempts: 1,
    })
  })

  it("classifies copyright with a single attempt and no fallback, regardless of the model's safety policy", () => {
    expect(safetyBlockOf(kieError("copyright"), "gpt-image-2")).toEqual({
      class: "copyright",
      maxAttempts: 1,
    })
  })

  it("classifies likeness with a single attempt and no fallback", () => {
    expect(safetyBlockOf(kieError("likeness"), "gpt-image-2")).toEqual({
      class: "likeness",
      maxAttempts: 1,
    })
  })

  it("returns null for a plain Error", () => {
    expect(safetyBlockOf(new Error("boom"), "gpt-image-2")).toBeNull()
  })

  it("returns null for a non-Error value", () => {
    expect(safetyBlockOf("boom", "gpt-image-2")).toBeNull()
    expect(safetyBlockOf(null, "gpt-image-2")).toBeNull()
    expect(safetyBlockOf(undefined, "gpt-image-2")).toBeNull()
  })

  it("recognises the plugin-toolkit duck-type (an Error carrying contentPolicyClass, not a KieError instance)", () => {
    expect(safetyBlockOf(duckTypedError("safety"), "gpt-image-2")).toEqual({
      class: "safety",
      maxAttempts: 2,
      fallback: "nano-banana-pro",
    })
  })

  it("treats a missing/null modelId as an unrecognized model (single attempt)", () => {
    expect(safetyBlockOf(kieError("safety"), null)).toEqual({ class: "safety", maxAttempts: 1 })
    expect(safetyBlockOf(kieError("safety"), undefined)).toEqual({ class: "safety", maxAttempts: 1 })
  })
})

describe("isFinalAttemptFor", () => {
  const twoAttemptBlock: SafetyBlock = { class: "safety", maxAttempts: 2, fallback: "nano-banana-pro" }
  const oneAttemptBlock: SafetyBlock = { class: "copyright", maxAttempts: 1 }

  it("is not final on the first attempt of a two-attempt policy", () => {
    expect(isFinalAttemptFor({ attemptsMade: 0 }, twoAttemptBlock)).toBe(false)
  })

  it("is final on the second attempt of a two-attempt policy", () => {
    expect(isFinalAttemptFor({ attemptsMade: 1 }, twoAttemptBlock)).toBe(true)
  })

  it("is final immediately for a one-attempt policy", () => {
    expect(isFinalAttemptFor({ attemptsMade: 0 }, oneAttemptBlock)).toBe(true)
  })
})

describe("errorHintFor", () => {
  it("includes suggestedProvider when the block carries a fallback", () => {
    const block: SafetyBlock = { class: "safety", maxAttempts: 2, fallback: "nano-banana-pro" }
    expect(errorHintFor(block, true)).toEqual({
      kind: "safety-block",
      class: "safety",
      retried: true,
      suggestedProvider: "nano-banana-pro",
    })
  })

  it("omits suggestedProvider when the block carries no fallback", () => {
    const block: SafetyBlock = { class: "copyright", maxAttempts: 1 }
    expect(errorHintFor(block, false)).toEqual({
      kind: "safety-block",
      class: "copyright",
      retried: false,
    })
    expect(errorHintFor(block, false)).not.toHaveProperty("suggestedProvider")
  })
})

describe("errorHintFor — input-video refusal", () => {
  const copyright: SafetyBlock = { class: "copyright", maxAttempts: 1 }

  it("marks the subject when the provider refused the input video", () => {
    expect(errorHintFor(copyright, false, { inputVideoRefused: true })).toEqual({
      kind: "safety-block",
      class: "copyright",
      retried: false,
      subject: "input_video",
    })
  })

  it("leaves today's hint untouched otherwise", () => {
    expect(errorHintFor(copyright, false, { inputVideoRefused: false })).toEqual({
      kind: "safety-block",
      class: "copyright",
      retried: false,
    })
    expect(errorHintFor(copyright, false, {})).not.toHaveProperty("subject")
  })
})

describe("inputRefusedHint", () => {
  it("is the input-refused arm for the input video", () => {
    expect(inputRefusedHint()).toEqual({ kind: "input-refused", subject: "input_video" })
  })
})

describe("inputVideoRefusedOf", () => {
  it("reads the flag off a KieError", () => {
    const err = new KieError("m", "d", "c", true, false, null, true)
    expect(inputVideoRefusedOf(err)).toBe(true)
    expect(inputVideoRefusedOf(new KieError("m", "d", "c", true))).toBe(false)
  })

  it("reads a duck-typed flag anywhere on the cause chain", () => {
    const inner = Object.assign(new Error("refused"), { inputVideoRefused: true })
    expect(inputVideoRefusedOf(new Error("outer", { cause: new Error("mid", { cause: inner }) }))).toBe(true)
  })

  it("accepts only `true`", () => {
    expect(inputVideoRefusedOf(Object.assign(new Error("x"), { inputVideoRefused: "true" }))).toBe(false)
    expect(inputVideoRefusedOf(Object.assign(new Error("x"), { inputVideoRefused: 1 }))).toBe(false)
    expect(inputVideoRefusedOf(new Error("x"))).toBe(false)
    expect(inputVideoRefusedOf(null)).toBe(false)
    expect(inputVideoRefusedOf("File processing failed")).toBe(false)
  })

  it("never throws", () => {
    const hostile = new Proxy(new Error("x"), {
      get() {
        throw new Error("boom")
      },
    })
    expect(() => inputVideoRefusedOf(hostile)).not.toThrow()
    expect(inputVideoRefusedOf(hostile)).toBe(false)
  })
})

describe("sentVideoInput", () => {
  it("is true when the job sent a source or reference video", () => {
    expect(sentVideoInput({ videoUrl: "https://x/a.mp4" })).toBe(true)
    expect(sentVideoInput({ referenceVideoUrl: "https://x/a.mp4" })).toBe(true)
    expect(sentVideoInput({ referenceVideoUrls: ["https://x/a.mp4"] })).toBe(true)
    expect(sentVideoInput({ referenceVideoUrls: ["", "https://x/b.mp4"] })).toBe(true)
  })

  it("is false without one", () => {
    expect(sentVideoInput({ imageUrl: "https://x/a.png", prompt: "p" })).toBe(false)
    expect(sentVideoInput({ videoUrl: "", referenceVideoUrls: [] })).toBe(false)
    expect(sentVideoInput({ videoUrl: 3, referenceVideoUrls: [null, " "] })).toBe(false)
    expect(sentVideoInput(null)).toBe(false)
    expect(sentVideoInput(undefined)).toBe(false)
  })
})

describe("safetyBlockMessage", () => {
  it("names the fallback label verbatim when one is given", () => {
    expect(safetyBlockMessage("Nano Banana Pro")).toBe(
      "The provider's safety filter blocked this output. This filter is not always consistent, so the request was retried once. You can try the same prompt and references on Nano Banana Pro, or adjust the prompt.",
    )
  })

  it("does not claim a retry when none happened (retried = false)", () => {
    expect(safetyBlockMessage("Nano Banana Pro", false)).toBe(
      "The provider's safety filter blocked this output. You can try the same prompt and references on Nano Banana Pro, or adjust the prompt.",
    )
    expect(safetyBlockMessage(undefined, false)).toBe(
      "The provider's safety filter blocked this output. Try adjusting the prompt or the input image.",
    )
  })

  it("falls back to the generic prompt/image nudge verbatim when there is no label", () => {
    expect(safetyBlockMessage()).toBe(
      "The provider's safety filter blocked this output. This filter is not always consistent, so the request was retried once. Try adjusting the prompt or the input image.",
    )
  })
})

describe("fallbackLabelOf", () => {
  it("resolves a catalog model id to its display label", () => {
    expect(fallbackLabelOf("nano-banana-pro")).toBe("Nano Banana Pro")
  })

  it("returns undefined for an unknown model id", () => {
    expect(fallbackLabelOf("totally-not-a-real-model-id")).toBeUndefined()
  })
})

// The one mapping both failure writers use (the worker's catch and the
// reconcile path) — a re-picked job must carry the same hint as a live one.
describe("refusalHintFor", () => {
  const copyright: SafetyBlock = { class: "copyright", maxAttempts: 1 }

  it("a classified block → its safety-block hint, naming the input video when it was refused", () => {
    expect(refusalHintFor(copyright, false, true)).toEqual({
      kind: "safety-block", class: "copyright", retried: false, subject: "input_video",
    })
    expect(refusalHintFor(copyright, true, false)).toEqual({ kind: "safety-block", class: "copyright", retried: true })
  })

  it("a refused input video with no class → the input-refused hint", () => {
    expect(refusalHintFor(null, false, true)).toEqual({ kind: "input-refused", subject: "input_video" })
  })

  it("neither → null", () => {
    expect(refusalHintFor(null, false, false)).toBeNull()
  })
})

describe("jobModelIdOf", () => {
  it("prefers model over provider, as the worker always has", () => {
    expect(jobModelIdOf({ model: "lora-x", provider: "flux" })).toBe("lora-x")
    expect(jobModelIdOf({ provider: "seedance-2" })).toBe("seedance-2")
    // An image job's input_data: the model the worker ran wins over the one asked for.
    expect(jobModelIdOf({ resolvedModel: "gpt-image-2-i2i", provider: "gpt-image-2" })).toBe("gpt-image-2-i2i")
    expect(jobModelIdOf({ model: "lora-x", resolvedModel: "lora-x", provider: "flux" })).toBe("lora-x")
    expect(jobModelIdOf({ resolvedModel: 7, provider: "flux" })).toBe("flux")
  })

  it("null for a payload without a model, or no payload", () => {
    expect(jobModelIdOf({})).toBeNull()
    expect(jobModelIdOf(null)).toBeNull()
    expect(jobModelIdOf({ provider: 42 })).toBeNull()
  })
})
