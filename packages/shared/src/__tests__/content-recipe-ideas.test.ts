import { describe, it, expect } from "vitest"
import {
  clampContentIdeasCount,
  contentIdeasCreditFeature,
  contentIdeasCreditId,
  contentRecipeCreditId,
  CONTENT_RECIPE_IDEAS_CREDIT_IDS,
  effectiveContentModel,
} from "../content-recipe-ideas.js"
import { FAN_IN_TARGETS, FAN_OUT_EACH_TYPES, isFanInEdge, isFanInNodeType } from "../producer-types.js"
import { LLM_FEATURE_DEFAULTS } from "../llm-models.js"
import { videoLinkPageUrl } from "../video-link.js"

describe("content recipe / ideas pricing", () => {
  it("bills the EFFECTIVE model's tier — an unset model is the economy default, never the bare id", () => {
    expect(LLM_FEATURE_DEFAULTS["content-recipe"]).toBe("gemini-3.6-flash")
    expect(LLM_FEATURE_DEFAULTS["content-ideas"]).toBe("gemini-3.6-flash")
    expect(contentRecipeCreditId()).toBe("content-recipe:economy")
    expect(contentRecipeCreditId("claude-sonnet-4.6")).toBe("content-recipe")
    expect(contentRecipeCreditId("claude-opus-5")).toBe("content-recipe:premium")
    expect(contentIdeasCreditId(undefined)).toBe("content-ideas:economy")
  })

  it("a model without structured output falls back to the default", () => {
    expect(effectiveContentModel("content-ideas", "gpt-5.2")).toBe("gemini-3.6-flash")
    expect(effectiveContentModel("content-ideas", "no-such-model")).toBe("gemini-3.6-flash")
    expect(effectiveContentModel("content-ideas", "claude-opus-5")).toBe("claude-opus-5")
  })

  it("ideas are charged per batch of five", () => {
    expect(contentIdeasCreditFeature(5)).toBe("content-ideas")
    expect(contentIdeasCreditFeature(6)).toBe("content-ideas:10")
    expect(contentIdeasCreditId(5, "claude-sonnet-4.6")).toBe("content-ideas")
    expect(contentIdeasCreditId(6, "claude-sonnet-4.6")).toBe("content-ideas:10")
    expect(contentIdeasCreditId(10)).toBe("content-ideas:10:economy")
    expect(contentIdeasCreditId(10, "claude-opus-5")).toBe("content-ideas:10:premium")
    // an xhigh/max effort bumps one tier, as for every LLM node
    expect(contentIdeasCreditId(3, "claude-sonnet-4.6", "max")).toBe("content-ideas:premium")
  })

  it("count: numbers only, clamped to 1..10", () => {
    expect(clampContentIdeasCount(undefined)).toBe(5)
    expect(clampContentIdeasCount("8")).toBe(5)
    expect(clampContentIdeasCount(0)).toBe(1)
    expect(clampContentIdeasCount(42)).toBe(10)
    expect(clampContentIdeasCount(6.9)).toBe(6)
  })

  it("every id a run can bill is listed", () => {
    const reachable = new Set<string>()
    for (const model of [undefined, "claude-sonnet-4.6", "claude-opus-5"]) {
      reachable.add(contentRecipeCreditId(model))
      for (const count of [1, 5, 6, 10]) reachable.add(contentIdeasCreditId(count, model))
    }
    expect([...reachable].sort()).toEqual([...CONTENT_RECIPE_IDEAS_CREDIT_IDS].sort())
  })
})

describe("fan-in / fan-out vocabulary", () => {
  it("Content Ideas emits a list (each) and folds only its recipes", () => {
    expect(FAN_OUT_EACH_TYPES.has("content-ideas")).toBe(true)
    expect(isFanInNodeType("content-ideas")).toBe(true)
    expect(isFanInEdge("content-ideas", "recipes")).toBe(true)
    expect(isFanInEdge("content-ideas", undefined)).toBe(true) // agent-written JSON omits the handle
    expect(isFanInEdge("content-ideas", null)).toBe(true)
    expect(isFanInEdge("content-ideas", "field-brand")).toBe(false)
    expect(isFanInEdge("content-ideas", "field-language")).toBe(false)
  })

  it("Choose Best still folds every wire, whatever its handle", () => {
    expect(FAN_IN_TARGETS.reduce).toBe("*")
    for (const handle of [undefined, null, "", "in", "inputs", "anything"]) {
      expect(isFanInEdge("reduce", handle)).toBe(true)
    }
  })

  it("other nodes never fold", () => {
    expect(isFanInNodeType("llm-chat")).toBe(false)
    expect(isFanInNodeType("constructor")).toBe(false) // no prototype leak
    expect(isFanInEdge("generate-script", "prompt")).toBe(false)
    expect(isFanInNodeType(undefined)).toBe(false)
  })
})

describe("videoLinkPageUrl", () => {
  it("is the page link, never the downloaded file", () => {
    expect(
      videoLinkPageUrl({
        youtubeUrl: " https://www.tiktok.com/@a/video/1 ",
        downloadedVideoUrl: "https://r2.example/videos/x.mp4",
      }),
    ).toBe("https://www.tiktok.com/@a/video/1")
    expect(videoLinkPageUrl({ youtubeUrl: "  " })).toBeUndefined()
    expect(videoLinkPageUrl({})).toBeUndefined()
  })
})
