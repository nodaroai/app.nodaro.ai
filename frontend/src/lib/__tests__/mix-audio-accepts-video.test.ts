import { describe, it, expect } from "vitest"
import { isValidWorkflowConnection } from "@/lib/connection-validation"
import { isValidFfmpegConnection } from "@/lib/ffmpeg-handles"
import { TARGET_HANDLE_ACCEPTS, getTargetHandlesAccepting } from "@/lib/target-handle-registry"

const typeOf = (id: string) => ({ rec: "upload-video", sv: "speaker-view", cut: "apply-edl", tts: "text-to-speech", mix: "mix-audio", img: "upload-image" } as Record<string, string>)[id]

describe("Mix Audio takes a video's audio (decided 2026-10-13)", () => {
  it("accepts a video producer, a render and audio; still refuses an image", () => {
    expect(isValidWorkflowConnection({ source: "rec", target: "mix", sourceHandle: "video", targetHandle: "in" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "sv", target: "mix", sourceHandle: "video", targetHandle: "in" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "cut", target: "mix", sourceHandle: "media", targetHandle: "in" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "tts", target: "mix", sourceHandle: null, targetHandle: "in" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "img", target: "mix", sourceHandle: "image", targetHandle: "in" }, typeOf)).toBe(false)
  })

  it("the drop validator and the handle popover registry agree", () => {
    expect(isValidFfmpegConnection("mix-audio", "in", "speaker-view")).toBe(true)
    expect(isValidFfmpegConnection("mix-audio", "in", "upload-image")).toBe(false)
    const spec = TARGET_HANDLE_ACCEPTS["mix-audio"]!.find((s) => s.handleId === "in")!
    expect(spec.accepts("speaker-view")).toBe(true)
    expect(spec.accepts("upload-video")).toBe(true)
    expect(spec.accepts("upload-image")).toBe(false)
    // A video's source popover offers Mix Audio as a consumer.
    expect(getTargetHandlesAccepting("speaker-view")).toContainEqual({ nodeType: "mix-audio", handleId: "in" })
  })
})
