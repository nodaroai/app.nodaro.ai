// @test-watches frontend/src/nodes/** backend/src/nodes/**
/**
 * Every tool a share can show has a name a person reads (tool-names.ts): each
 * node that makes an image, a video or a sound, each queue name the gallery
 * lists (the `job_type` a video job is renamed to at pickup), and the job
 * types run outside the canvas. A new one fails here until it is named. The
 * names are plain words, never a vendor's.
 */
import { describe, it, expect } from "vitest"
import { NODE_REGISTRY } from "../../node-registry.js"
import { GALLERY_LISTED_JOB_TYPES } from "../../gallery-listing.js"
import { SHARE_TOOLS, SHARE_WORK_KINDS, shareToolOf, shareWorkOf } from "../tool-names.js"

/** Media nodes that never make a job of their own: what a person brings in. */
const SOURCE_NODES: Readonly<Record<string, string>> = {
  "upload-image": "an upload, not a result",
  "upload-video": "an upload, not a result",
  "upload-audio": "an upload, not a result",
  "youtube-video": "a linked video, not a result",
  "reference-audio": "a reference sound, not a result",
}

/** Job types run outside the canvas that a share can show. */
const OTHER_SHOWN_TYPES = ["cast-swap", "image-edit"] as const

/** Words that name a model, a vendor or another product: never in a tool's name. */
const VENDOR_WORDS = /\b(suno|kling|veo|sora|runway|elevenlabs|eleven labs|minimax|hailuo|seedance|bytedance|wan|grok|flux|ideogram|topaz|gpt|gemini|claude|adobe|after effects|lottie|replicate|kie)\b/i

describe("share tool names", () => {
  it("names every node that makes an image, a video or a sound", () => {
    const media = NODE_REGISTRY.filter((n) => n.outputType === "image" || n.outputType === "video" || n.outputType === "audio").map((n) => n.type)
    expect(media.length).toBeGreaterThan(50)
    const unnamed = media.filter((type) => !Object.hasOwn(SOURCE_NODES, type) && !shareToolOf(type))
    expect(unnamed, "give each a name in lib/share-links/tool-names.ts").toEqual([])
  })

  it("names every queue name the gallery lists, and the job types run outside the canvas", () => {
    const unnamed = [...GALLERY_LISTED_JOB_TYPES, ...OTHER_SHOWN_TYPES].filter((type) => !shareToolOf(type))
    expect(unnamed).toEqual([])
  })

  it("a node unit names itself: its own label, and the medium it makes", () => {
    expect(shareToolOf("clip-pack")).toEqual({ name: "Clip Pack", work: "video" })
    expect(shareToolOf("split-into-layers")?.work).toBe("image")
    expect(Object.keys(SHARE_TOOLS)).not.toContain("clip-pack")
  })

  it("every name in the table is plain words, never a model's, a vendor's or another product's", () => {
    for (const [type, tool] of Object.entries(SHARE_TOOLS)) {
      expect(tool.name, type).not.toMatch(VENDOR_WORDS)
      expect(tool.name.trim(), type).toBe(tool.name)
      expect(SHARE_WORK_KINDS, type).toContain(tool.work)
    }
    expect(shareToolOf("suno-mashup")?.name).toBe("Song Mashup")
  })

  it("the kind of work follows the media a result is", () => {
    expect(shareWorkOf("suno-mashup", "audio")).toBe("song")
    expect(shareWorkOf("text-to-speech", "audio")).toBe("speech")
    expect(shareWorkOf("text-to-audio", "audio")).toBe("sound-effect")
    expect(shareWorkOf("voice-changer", "video")).toBe("video")
    expect(shareWorkOf("unknown-plugin-type", "image")).toBe("image")
    expect(shareToolOf("unknown-plugin-type")).toBeNull()
    expect(shareToolOf("constructor")).toBeNull()
  })
})
