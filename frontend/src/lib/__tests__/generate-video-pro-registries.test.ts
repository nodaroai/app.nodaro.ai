import { describe, it, expect } from "vitest"
import { VIDEO_PRODUCER_TYPES, NODE_MAPPABLE_FIELDS } from "@nodaro/shared"
import { MAIN_TEXT_HANDLE } from "../main-text-handle"
import { NODE_PROMPT_FIELDS } from "../prompt-fields"
import { getHandleConnectionLimit } from "../handle-limits"
import { HANDLE_OUTPUT_TYPES } from "../handle-output-types"
import { isValidGenerateVideoProConnection } from "../generate-video-pro-handles"
import { NODE_DEFINITIONS } from "@/types/nodes"
import type { WorkflowNode } from "@/types/nodes"

/**
 * Registry-completeness guard for generate-video-pro's shared + frontend
 * data-layer registration (Task 11 — no UI components yet, see Task 12).
 * Mirrors the sibling voice-changer-pro / generate-video registration checks:
 * a node absent from any ONE of these registries silently breaks a different
 * subsystem —
 *   - VIDEO_PRODUCER_TYPES: its output can't connect downstream at all.
 *   - NODE_MAPPABLE_FIELDS: fieldMappings / {} injection never resolves.
 *   - MAIN_TEXT_HANDLE: wiring a text source never auto-fills {Label}.
 *   - NODE_PROMPT_FIELDS: the quick-edit Prompt modal does nothing.
 *   - handle-limits: the connection popover shows no cap (or the wrong one).
 *   - HANDLE_OUTPUT_TYPES: the output wire renders with the wrong edge color.
 *   - NODE_DEFINITIONS: the node doesn't exist on the canvas at all.
 */
describe("generate-video-pro registries", () => {
  it("is registered as a video producer (its output can connect downstream)", () => {
    expect(VIDEO_PRODUCER_TYPES.has("generate-video-pro")).toBe(true)
  })

  it("NODE_MAPPABLE_FIELDS exposes only prompt (no negativePrompt field on the node)", () => {
    expect(NODE_MAPPABLE_FIELDS["generate-video-pro"]).toEqual(["prompt"])
  })

  it("MAIN_TEXT_HANDLE wires the real 'prompt' handle (NOT generate-video's stale 'in')", () => {
    expect(MAIN_TEXT_HANDLE["generate-video-pro"]?.[0]?.handle).toBe("prompt")
    expect(MAIN_TEXT_HANDLE["generate-video-pro"]?.[0]?.field).toBe("prompt")
  })

  it("NODE_PROMPT_FIELDS declares an inline video-media prompt with no negative field", () => {
    expect(NODE_PROMPT_FIELDS["generate-video-pro"]).toMatchObject({
      prompt: "prompt",
      media: "video",
      inline: true,
    })
    expect(NODE_PROMPT_FIELDS["generate-video-pro"]?.negative).toBeUndefined()
  })

  it("caps imageReferences at 9 and startFrame at 1", () => {
    const node = {
      id: "n",
      type: "generate-video-pro",
      data: { provider: "seedance-2" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "imageReferences")?.limit).toBe(9)
    expect(getHandleConnectionLimit(node, "startFrame")?.limit).toBe(1)
  })

  it("maps its single video output handle to the video edge color", () => {
    expect(HANDLE_OUTPUT_TYPES["generate-video-pro"]).toEqual({ video: "video" })
  })

  it("NODE_DEFINITIONS registers the node with the documented default data", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "generate-video-pro")
    expect(def).toBeDefined()
    const data = def!.defaultData as Record<string, unknown>
    expect(data.provider).toBe("seedance-2")
    expect(data.duration).toBe(8)
    expect(data.resolution).toBe("720p")
    expect(data.generateAudio).toBe(true)
  })
})

describe("isValidGenerateVideoProConnection", () => {
  const isPicker = (t: string) => new Set(["mood", "setting", "person"]).has(t)

  it("prompt handle accepts text producers and visual pickers", () => {
    expect(isValidGenerateVideoProConnection("prompt", "text-prompt", isPicker)).toBe(true)
    expect(isValidGenerateVideoProConnection("prompt", "mood", isPicker)).toBe(true)
  })

  it("prompt handle rejects image producers", () => {
    expect(isValidGenerateVideoProConnection("prompt", "generate-image", isPicker)).toBe(false)
  })

  it("startFrame and imageReferences accept image producers", () => {
    expect(isValidGenerateVideoProConnection("startFrame", "generate-image", isPicker)).toBe(true)
    expect(isValidGenerateVideoProConnection("imageReferences", "upload-image", isPicker)).toBe(true)
  })

  it("startFrame and imageReferences reject text producers", () => {
    expect(isValidGenerateVideoProConnection("startFrame", "text-prompt", isPicker)).toBe(false)
    expect(isValidGenerateVideoProConnection("imageReferences", "text-prompt", isPicker)).toBe(false)
  })

  it("unknown handle returns false", () => {
    expect(isValidGenerateVideoProConnection("negative", "text-prompt", isPicker)).toBe(false)
  })
})
