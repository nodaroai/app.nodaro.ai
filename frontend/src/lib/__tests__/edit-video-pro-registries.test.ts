import { describe, it, expect } from "vitest"
import { VIDEO_PRODUCER_TYPES, NODE_MAPPABLE_FIELDS } from "@nodaro/shared"
import { MAIN_TEXT_HANDLE } from "../main-text-handle"
import { NODE_PROMPT_FIELDS } from "../prompt-fields"
import { getHandleConnectionLimit } from "../handle-limits"
import { HANDLE_OUTPUT_TYPES } from "../handle-output-types"
import { isValidEditVideoProConnection } from "../edit-video-pro-handles"
import { NODE_DEFINITIONS } from "@/types/nodes"
import type { WorkflowNode } from "@/types/nodes"

/**
 * Registry-completeness guard for edit-video-pro's shared + frontend
 * data-layer registration (Task 12 landed the data layer; Task 13 lands the
 * node component + its HANDLE_OUTPUT_TYPES pip entry). Mirrors the sibling
 * generate-video-pro-registries.test.ts: a node absent from any ONE of these
 * registries silently breaks a different subsystem —
 *   - VIDEO_PRODUCER_TYPES: its output can't connect downstream at all.
 *   - NODE_MAPPABLE_FIELDS: fieldMappings / {} injection never resolves.
 *   - MAIN_TEXT_HANDLE: wiring a text source never auto-fills {Label}.
 *   - NODE_PROMPT_FIELDS: the quick-edit Prompt modal does nothing.
 *   - handle-limits: the connection popover shows no cap (or the wrong one).
 *   - HANDLE_OUTPUT_TYPES: the output wire renders with the wrong edge color.
 *   - NODE_DEFINITIONS: the node doesn't exist on the canvas at all.
 */
describe("edit-video-pro registries", () => {
  it("is registered as a video producer (its output can connect downstream)", () => {
    expect(VIDEO_PRODUCER_TYPES.has("edit-video-pro")).toBe(true)
  })

  it("NODE_MAPPABLE_FIELDS exposes only prompt", () => {
    expect(NODE_MAPPABLE_FIELDS["edit-video-pro"]).toEqual(["prompt"])
  })

  it("MAIN_TEXT_HANDLE wires the real 'prompt' handle", () => {
    expect(MAIN_TEXT_HANDLE["edit-video-pro"]?.[0]?.handle).toBe("prompt")
    expect(MAIN_TEXT_HANDLE["edit-video-pro"]?.[0]?.field).toBe("prompt")
  })

  it("NODE_PROMPT_FIELDS declares an inline video-media prompt with no negative field", () => {
    expect(NODE_PROMPT_FIELDS["edit-video-pro"]).toMatchObject({
      prompt: "prompt",
      media: "video",
      inline: true,
    })
    expect(NODE_PROMPT_FIELDS["edit-video-pro"]?.negative).toBeUndefined()
  })

  it("caps the video handle at 1 (single primary source clip, like video-retake)", () => {
    const node = {
      id: "n",
      type: "edit-video-pro",
      data: { provider: "seedance-2" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "video")?.limit).toBe(1)
  })

  it("caps imageReferences at 9 (Seedance-2 ref pool max, mirrors generate-video-pro)", () => {
    const node = {
      id: "n",
      type: "edit-video-pro",
      data: { provider: "seedance-2" },
    } as unknown as WorkflowNode
    expect(getHandleConnectionLimit(node, "imageReferences")?.limit).toBe(9)
  })

  it("maps its single video output handle to the video edge color", () => {
    expect(HANDLE_OUTPUT_TYPES["edit-video-pro"]).toEqual({ video: "video" })
  })

  it("NODE_DEFINITIONS registers the node with the documented default data", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "edit-video-pro")
    expect(def).toBeDefined()
    const data = def!.defaultData as Record<string, unknown>
    expect(data.provider).toBe("seedance-2")
    expect(data.mode).toBe("replace")
    expect(data.spanStart).toBe(0)
    expect(data.spanEnd).toBe(8)
    expect(data.generateAudio).toBe(true)
  })
})

describe("isValidEditVideoProConnection", () => {
  const isPicker = (t: string) => new Set(["mood", "setting", "person"]).has(t)

  it("video handle accepts video producers and DYNAMIC producers", () => {
    expect(isValidEditVideoProConnection("video", "upload-video", isPicker)).toBe(true)
    expect(isValidEditVideoProConnection("video", "generate-video", isPicker)).toBe(true)
    expect(isValidEditVideoProConnection("video", "list", isPicker)).toBe(true) // DYNAMIC_PRODUCER_TYPES
  })

  it("video handle rejects text producers", () => {
    expect(isValidEditVideoProConnection("video", "text-prompt", isPicker)).toBe(false)
  })

  it("prompt handle accepts text producers and visual pickers", () => {
    expect(isValidEditVideoProConnection("prompt", "text-prompt", isPicker)).toBe(true)
    expect(isValidEditVideoProConnection("prompt", "mood", isPicker)).toBe(true)
  })

  it("prompt handle rejects image producers", () => {
    expect(isValidEditVideoProConnection("prompt", "generate-image", isPicker)).toBe(false)
  })

  it("imageReferences handle accepts image producers", () => {
    expect(isValidEditVideoProConnection("imageReferences", "upload-image", isPicker)).toBe(true)
  })

  it("imageReferences handle rejects video producers", () => {
    expect(isValidEditVideoProConnection("imageReferences", "generate-video", isPicker)).toBe(false)
  })

  it("unknown handle returns false", () => {
    expect(isValidEditVideoProConnection("negative", "text-prompt", isPicker)).toBe(false)
  })
})
