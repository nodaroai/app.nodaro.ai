// @test-units-by-name looks up replace-audio and the media nodes it names
/**
 * Replace Audio's input pips — one set of rows (replace-audio-handles.ts) for
 * its own pips, the drag-to-connect validator, the source-direction popover and
 * the add-node popup: `in` takes a video, `music` an audio or a video whose
 * sound is used, and no other id is an input.
 */
import { describe, it, expect } from "vitest"
import { REPLACE_AUDIO_TARGET_HANDLES, isValidReplaceAudioConnection } from "../replace-audio-handles"
import { isValidWorkflowConnection } from "../connection-validation"
import { TARGET_HANDLE_ACCEPTS } from "../target-handle-registry"
import { addNodeConnection, getCompatibleNodes } from "../node-compatibility"
import { NODE_OPTIONS } from "../node-options"
import { NODE_DEF_MAP } from "@/types/nodes"

const types: Record<string, string> = { src: "", ra: "replace-audio" }
const drop = (sourceType: string, targetHandle: string, sourceHandle = "out") => {
  types.src = sourceType
  return isValidWorkflowConnection({ source: "src", sourceHandle, target: "ra", targetHandle }, (id) => types[id])
}

describe("replace-audio's input pips", () => {
  it("the definition declares exactly the pips the rows draw", () => {
    expect([...NODE_DEF_MAP.get("replace-audio")!.inputs]).toEqual(REPLACE_AUDIO_TARGET_HANDLES.map((h) => h.handleId))
    expect([...NODE_DEF_MAP.get("replace-audio")!.outputs]).toEqual(["video-out"])
  })

  it("`in` takes a video, never an audio", () => {
    expect(isValidReplaceAudioConnection("in", "upload-video")).toBe(true)
    expect(isValidReplaceAudioConnection("in", "generate-video")).toBe(true)
    expect(isValidReplaceAudioConnection("in", "upload-audio")).toBe(false)
    expect(isValidReplaceAudioConnection("in", "generate-music")).toBe(false)
  })

  it("`music` takes an audio or a video", () => {
    expect(isValidReplaceAudioConnection("music", "upload-audio")).toBe(true)
    expect(isValidReplaceAudioConnection("music", "generate-music")).toBe(true)
    expect(isValidReplaceAudioConnection("music", "upload-video")).toBe(true)
    expect(isValidReplaceAudioConnection("music", "text-prompt")).toBe(false)
    expect(isValidReplaceAudioConnection("music", "upload-image")).toBe(false)
  })

  it("no other id is an input", () => {
    expect(isValidReplaceAudioConnection("audio", "upload-audio")).toBe(false)
    expect(isValidReplaceAudioConnection("video", "upload-video")).toBe(false)
  })

  it("the canvas drop applies the same rows", () => {
    expect(drop("upload-video", "in", "video")).toBe(true)
    expect(drop("upload-audio", "in", "audio")).toBe(false)
    expect(drop("upload-audio", "music", "audio")).toBe(true)
    expect(drop("upload-video", "music", "video")).toBe(true)
    expect(drop("upload-image", "music", "image")).toBe(false)
  })

  it("the source-direction popover lists the same rows", () => {
    expect(TARGET_HANDLE_ACCEPTS["replace-audio"]).toEqual(REPLACE_AUDIO_TARGET_HANDLES)
  })

  it("the add-node popup opened from a pip offers what that pip takes", () => {
    const fromIn = getCompatibleNodes("in", "target", NODE_OPTIONS, "replace-audio")
    expect(fromIn.directTypes.has("upload-video")).toBe(true)
    expect(fromIn.directTypes.has("upload-audio")).toBe(false)
    expect(fromIn.compatible).toEqual([])
    const fromMusic = getCompatibleNodes("music", "target", NODE_OPTIONS, "replace-audio")
    expect(fromMusic.directTypes.has("upload-audio")).toBe(true)
    expect(fromMusic.directTypes.has("upload-video")).toBe(true)
    expect(fromMusic.directTypes.has("text-prompt")).toBe(false)
  })

  it("a Replace Audio added from an audio output is wired on `music`", () => {
    const edge = addNodeConnection({ nodeId: "a", handleId: "audio", direction: "source" }, { id: "ra", type: "replace-audio" }, "upload-audio")
    expect(edge?.targetHandle).toBe("music")
  })
})
