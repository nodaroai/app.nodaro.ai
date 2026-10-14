/**
 * Site Capture's pips connect where its docs say they do: a still into any image input
 * (Image to Text, a Generate Image reference, a video's start frame, Still to Video), every
 * still into Slideshow and Image Collage, and its JSON into Extract Field, List and a prompt.
 */
import { describe, it, expect } from "vitest"
import { isValidWorkflowConnection } from "../connection-validation"

const typeOf = (id: string) => id
const ok = (target: string, sourceHandle: string, targetHandle: string) =>
  isValidWorkflowConnection({ source: "site-capture", target, sourceHandle, targetHandle }, typeOf)

describe("Site Capture — Stills (image)", () => {
  it.each([
    ["image-to-text", "image"],
    ["generate-image", "references"],
    ["generate-video", "startFrame"],
    ["generate-video", "imageReferences"],
    ["image-to-video", "startFrame"],
    ["still-to-video", "image"],
    ["slideshow", "images"],
    ["image-collage", "in"],
  ])("connects into %s/%s", (target, handle) => expect(ok(target, "image", handle)).toBe(true))

  it("never into an audio or video input", () => {
    expect(ok("slideshow", "image", "audio")).toBe(false)
  })
})

describe("Site Capture — JSON", () => {
  it.each([
    ["extract-field", "in"],
    ["list", "in"],
    ["llm-chat", "prompt"],
  ])("connects into %s/%s", (target, handle) => expect(ok(target, "json", handle)).toBe(true))
})
