/**
 * The input handles of Content Recipe and Content Ideas: one predicate per
 * handle, read by the node's own handles, the drag-to-connect validator and
 * the source-direction popover — so these cases pin all three.
 */
import { describe, it, expect } from "vitest"
import { isValidContentConnection, CONTENT_RECIPE_INPUT_HANDLES, CONTENT_IDEAS_INPUT_HANDLES } from "../content-handles"
import { isValidWorkflowConnection } from "../connection-validation"
import { NODE_DEF_MAP } from "@/types/nodes"

describe("isValidContentConnection", () => {
  it("Content Recipe `in` takes the material: an analysis, scraped posts, any text", () => {
    for (const source of ["video-analysis", "instagram-scrape", "meta-ads-scrape", "text-prompt", "llm-chat", "transcribe"]) {
      expect(isValidContentConnection("content-recipe", "in", source), source).toBe(true)
    }
    expect(isValidContentConnection("content-recipe", "in", "generate-image")).toBe(false)
  })

  it("Content Recipe `link` takes a Video URL node or any text — not a downloaded clip from elsewhere", () => {
    expect(isValidContentConnection("content-recipe", "link", "youtube-video")).toBe(true)
    expect(isValidContentConnection("content-recipe", "link", "text-prompt")).toBe(true)
    expect(isValidContentConnection("content-recipe", "link", "upload-video")).toBe(false)
  })

  it("Content Ideas `recipes` takes a Content Recipe or recipe text; `field-brand` takes text only", () => {
    expect(isValidContentConnection("content-ideas", "recipes", "content-recipe")).toBe(true)
    expect(isValidContentConnection("content-ideas", "recipes", "text-prompt")).toBe(true)
    expect(isValidContentConnection("content-ideas", "recipes", "generate-image")).toBe(false)
    expect(isValidContentConnection("content-ideas", "field-brand", "text-prompt")).toBe(true)
    expect(isValidContentConnection("content-ideas", "field-brand", "content-recipe")).toBe(true)
    expect(isValidContentConnection("content-ideas", "field-brand", "upload-image")).toBe(false)
  })

  it("refuses an unknown handle rather than guessing", () => {
    expect(isValidContentConnection("content-recipe", "prompt", "text-prompt")).toBe(false)
    expect(isValidContentConnection("content-ideas", "in", "content-recipe")).toBe(false)
    expect(isValidContentConnection("generate-image", "prompt", "text-prompt")).toBe(false)
  })

  it("the handle lists match the node definitions", () => {
    expect([...CONTENT_RECIPE_INPUT_HANDLES]).toEqual(NODE_DEF_MAP.get("content-recipe")?.inputs)
    expect([...CONTENT_IDEAS_INPUT_HANDLES]).toEqual(NODE_DEF_MAP.get("content-ideas")?.inputs)
  })
})

describe("the canvas validator agrees", () => {
  const types: Record<string, string> = {
    v: "youtube-video",
    a: "video-analysis",
    r: "content-recipe",
    i: "content-ideas",
    t: "text-prompt",
    s: "generate-script",
    img: "generate-image",
  }
  const getNodeType = (id: string) => types[id]
  const ok = (source: string, sourceHandle: string, target: string, targetHandle: string) =>
    isValidWorkflowConnection({ source, target, sourceHandle, targetHandle }, getNodeType)

  it("accepts the steal-the-format wiring", () => {
    expect(ok("v", "video", "r", "link")).toBe(true)
    expect(ok("a", "json", "r", "in")).toBe(true)
    expect(ok("r", "text", "i", "recipes")).toBe(true)
    expect(ok("r", "json", "i", "recipes")).toBe(true)
    expect(ok("t", "prompt", "i", "field-brand")).toBe(true)
    expect(ok("i", "ideas", "s", "prompt")).toBe(true)
  })

  it("rejects an image into a recipe's link", () => {
    expect(ok("img", "image", "r", "link")).toBe(false)
  })
})
