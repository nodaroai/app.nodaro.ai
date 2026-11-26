import { describe, expect, it } from "vitest"
import { isValidWorkflowConnection } from "../connection-validation"
import { COMPOSER_PLAN_MAP } from "@nodaro/shared/models"
import { NODE_DEF_MAP } from "@/types/nodes"
import { HANDLE_OUTPUT_TYPES } from "../handle-output-types"
import { TARGET_HANDLE_ACCEPTS } from "../target-handle-registry"

/** `getNodeType` for a two-node graph. */
function types(map: Record<string, string>) {
  return (id: string) => map[id]
}

describe("Generate 3D Scene's `prompt` input — text becomes the brief", () => {
  it("takes both of a Video Analysis's outputs, and a Video Audit's", () => {
    for (const [sourceType, sourceHandle] of [["video-analysis", "json"], ["video-analysis", "text"], ["video-audit", "json"]]) {
      expect(
        isValidWorkflowConnection(
          { source: "a", target: "g", sourceHandle, targetHandle: "prompt" },
          types({ a: sourceType, g: "generate-3d-scene" }),
        ),
      ).toBe(true)
    }
  })

  it("takes plain text producers", () => {
    for (const sourceType of ["text-prompt", "llm-chat"]) {
      expect(
        isValidWorkflowConnection(
          { source: "t", target: "g", sourceHandle: "out", targetHandle: "prompt" },
          types({ t: sourceType, g: "generate-3d-scene" }),
        ),
      ).toBe(true)
    }
  })

  it("refuses media on the prompt, and still refuses text on References", () => {
    expect(
      isValidWorkflowConnection(
        { source: "i", target: "g", sourceHandle: "image", targetHandle: "prompt" },
        types({ i: "generate-image", g: "generate-3d-scene" }),
      ),
    ).toBe(false)
    expect(
      isValidWorkflowConnection(
        { source: "a", target: "g", sourceHandle: "json", targetHandle: "references" },
        types({ a: "video-analysis", g: "generate-3d-scene" }),
      ),
    ).toBe(false)
  })

  it("is declared, and the drop rule and the popover agree", () => {
    expect(NODE_DEF_MAP.get("generate-3d-scene")?.inputs).toContain("prompt")
    const entry = TARGET_HANDLE_ACCEPTS["generate-3d-scene"]?.find((h) => h.handleId === "prompt")
    expect(entry?.accepts("video-analysis")).toBe(true)
    expect(entry?.accepts("generate-image")).toBe(false)
  })
})

describe("3D scene wiring — generate → edit → render-video", () => {
  it("lets a generated scene feed Edit 3D Scene's `scene` input", () => {
    expect(
      isValidWorkflowConnection(
        { source: "gen", target: "edit", sourceHandle: "composition", targetHandle: "scene" },
        types({ gen: "generate-3d-scene", edit: "edit-3d-scene" }),
      ),
    ).toBe(true)
  })

  it("lets an EDITED scene feed another Edit 3D Scene (revisions chain)", () => {
    expect(
      isValidWorkflowConnection(
        { source: "e1", target: "e2", sourceHandle: "composition", targetHandle: "scene" },
        types({ e1: "edit-3d-scene", e2: "edit-3d-scene" }),
      ),
    ).toBe(true)
  })

  it("lets both 3D nodes feed render-video", () => {
    for (const sourceType of ["generate-3d-scene", "edit-3d-scene", "pro-3d-render"]) {
      expect(
        isValidWorkflowConnection(
          { source: "s", target: "rv", sourceHandle: "composition", targetHandle: "in" },
          types({ s: sourceType, rv: "render-video" }),
        ),
      ).toBe(true)
    }
  })

  it("still refuses a composition wire to an unrelated node", () => {
    expect(
      isValidWorkflowConnection(
        { source: "gen", target: "tv", sourceHandle: "composition", targetHandle: "in" },
        types({ gen: "generate-3d-scene", tv: "trim-video" }),
      ),
    ).toBe(false)
  })

  it("refuses a NON-scene composition (3d-title) on the `scene` input", () => {
    expect(
      isValidWorkflowConnection(
        { source: "t", target: "edit", sourceHandle: "composition", targetHandle: "scene" },
        types({ t: "3d-title", edit: "edit-3d-scene" }),
      ),
    ).toBe(false)
  })

  it("refuses a scene wire onto the wrong handle of Edit 3D Scene", () => {
    expect(
      isValidWorkflowConnection(
        { source: "gen", target: "edit", sourceHandle: "composition", targetHandle: "references" },
        types({ gen: "generate-3d-scene", edit: "edit-3d-scene" }),
      ),
    ).toBe(false)
  })
})

describe("3D scene `references` input", () => {
  it("accepts an image producer and a video producer", () => {
    for (const [sourceType, sourceHandle] of [
      ["generate-image", "image"],
      ["generate-video", "video"],
      ["upload-image", "image"],
    ] as const) {
      expect(
        isValidWorkflowConnection(
          { source: "s", target: "g", sourceHandle, targetHandle: "references" },
          types({ s: sourceType, g: "generate-3d-scene" }),
        ),
        `${sourceType} should reach references`,
      ).toBe(true)
    }
  })

  it("refuses a text producer on `references`", () => {
    expect(
      isValidWorkflowConnection(
        { source: "s", target: "g", sourceHandle: "text", targetHandle: "references" },
        types({ s: "ai-writer", g: "generate-3d-scene" }),
      ),
    ).toBe(false)
  })
})

describe("3D scene node registration", () => {
  it.each(["generate-3d-scene", "edit-3d-scene", "pro-3d-render"])("%s is a composer emitting a 3d-scene plan", (type) => {
    expect(COMPOSER_PLAN_MAP[type]).toEqual({ planType: "3d-scene", planField: "scenePlan" })
    expect(NODE_DEF_MAP.get(type)?.outputs).toContain("composition")
    expect(HANDLE_OUTPUT_TYPES[type]?.composition).toBe("control")
    expect(TARGET_HANDLE_ACCEPTS[type]?.map((h) => h.handleId)).toContain("references")
  })

  it("previz defaults are the short, cheap ones the spec asks for", () => {
    const data = NODE_DEF_MAP.get("generate-3d-scene")?.defaultData as Record<string, unknown>
    expect(data.fps).toBe(24)
    expect(data.durationSeconds).toBe(4)
    expect(data.aspectRatio).toBe("16:9")
    expect(data.scenePrompt).toBe("")
  })

  it("edit-3d-scene declares the scene input the validator relies on", () => {
    expect(NODE_DEF_MAP.get("edit-3d-scene")?.inputs).toEqual(["scene", "references"])
    expect(TARGET_HANDLE_ACCEPTS["edit-3d-scene"]?.map((h) => h.handleId)).toEqual(["scene", "references"])
  })
})
