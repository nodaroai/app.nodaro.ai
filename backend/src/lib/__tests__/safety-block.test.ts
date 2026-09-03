import { describe, it, expect } from "vitest"
import { KieError } from "../../providers/kie/client.js"
import {
  safetyBlockOf,
  isFinalAttemptFor,
  errorHintFor,
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
