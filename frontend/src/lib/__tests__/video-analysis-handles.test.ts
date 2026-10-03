/**
 * Video Analysis `video` takes a video file, or a post's link from a text
 * output (the Telegram Account Trigger's Video link, a Text node). One
 * predicate is read by the node's own pip, the drag-to-connect validator and
 * the source-direction popover, so these cases pin all three.
 */
import { describe, it, expect } from "vitest"
import { ACCEPTS_VIDEO_OR_POST_LINK, initialEdgeData } from "../video-analysis-handles"
import { isValidWorkflowConnection } from "../connection-validation"
import { getTargetHandlesAccepting } from "../target-handle-registry"

const FITS = ["telegram-account-trigger", "text-prompt", "llm-chat", "youtube-video", "generate-video", "upload-video"]
const DOES_NOT_FIT = ["generate-image", "upload-image", "upload-audio"]

describe("Video Analysis video input", () => {
  it("takes a video, or a text output that can carry a post's link", () => {
    for (const source of FITS) expect(ACCEPTS_VIDEO_OR_POST_LINK(source), source).toBe(true)
    for (const source of DOES_NOT_FIT) expect(ACCEPTS_VIDEO_OR_POST_LINK(source), source).toBe(false)
  })

  it("the drag-to-connect validator agrees: the account trigger's Video link connects", () => {
    const connects = (sourceType: string, sourceHandle: string) =>
      isValidWorkflowConnection(
        { source: "src", target: "va", sourceHandle, targetHandle: "video" },
        (id) => (id === "va" ? "video-analysis" : sourceType),
      )
    expect(connects("telegram-account-trigger", "videoLink")).toBe(true)
    expect(connects("text-prompt", "prompt")).toBe(true)
    expect(connects("youtube-video", "video")).toBe(true)
    expect(connects("generate-image", "image")).toBe(false)
  })

  it("the source-direction popover agrees", () => {
    const offersVideoAnalysis = (sourceType: string) =>
      getTargetHandlesAccepting(sourceType).some((m) => m.nodeType === "video-analysis" && m.handleId === "video")
    for (const source of FITS) expect(offersVideoAnalysis(source), source).toBe(true)
    for (const source of DOES_NOT_FIT) expect(offersVideoAnalysis(source), source).toBe(false)
  })
})

describe("Video Analysis video input from a Social Search", () => {
  const connects = (sourceHandle: string) =>
    isValidWorkflowConnection(
      { source: "src", target: "va", sourceHandle, targetHandle: "video" },
      (id) => (id === "va" ? "video-analysis" : "social-search"),
    )

  it("connects by its posts, never by its digest", () => {
    expect(ACCEPTS_VIDEO_OR_POST_LINK("social-search")).toBe(true)
    expect(connects("json")).toBe(true)
    expect(connects("text")).toBe(false)
  })

  it("offers Video Analysis from the posts output's popover", () => {
    expect(getTargetHandlesAccepting("social-search").some((m) => m.nodeType === "video-analysis" && m.handleId === "video")).toBe(true)
  })

  it("starts the wire in Each mode, so every post passed on is analyzed", () => {
    expect(initialEdgeData("social-search", "json", "video-analysis", "video")).toEqual({ outputMode: "each" })
    expect(initialEdgeData("social-search", "json", "content-recipe", "in")).toBeUndefined()
    expect(initialEdgeData("text-prompt", "prompt", "video-analysis", "video")).toBeUndefined()
  })
})
