import {
  INPUT_NODE_TYPES,
  getInputNodes,
  getOutputNodes,
  getOutputType,
  getNodeResult,
  getNodeLabel,
  getInputFieldSchema,
  migrateToItems,
  validateNoNestedGroups,
  flattenItems,
  getItemSortId,
  cleanOrphanedItems,
} from "../presentation-utils.js"
import type { GenericNode, GenericEdge } from "../types.js"
import type { PresentationItem } from "../presentation-types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  hidden = false,
): GenericNode {
  return { id, type, data, ...(hidden ? { hidden: true } : {}) }
}

function mkEdge(source: string, target: string): GenericEdge {
  return { source, target }
}

// ---------------------------------------------------------------------------
// INPUT_NODE_TYPES
// ---------------------------------------------------------------------------

describe("INPUT_NODE_TYPES", () => {
  const expected = [
    "text-prompt",
    "upload-image",
    "upload-video",
    "upload-audio",
    "tone",
    "style-guide",
    "provider",
    "scene-count",
    "duration",
    "aspect-ratio",
    "motion",
    "camera-motion",
    "reference-audio",
  ]

  it("contains all expected types", () => {
    for (const t of expected) {
      expect(INPUT_NODE_TYPES.has(t)).toBe(true)
    }
  })

  it("has the expected size", () => {
    expect(INPUT_NODE_TYPES.size).toBe(expected.length)
  })
})

// ---------------------------------------------------------------------------
// getInputNodes
// ---------------------------------------------------------------------------

describe("getInputNodes", () => {
  describe("curatedOnly (default)", () => {
    it("includes nodes with presentationInput=true", () => {
      const nodes = [
        mkNode("n1", "generate-image", { presentationInput: true }),
      ]
      expect(getInputNodes(nodes)).toEqual([nodes[0]])
    })

    it("includes nodes with presentationInput=true regardless of type", () => {
      const nodes = [
        mkNode("n1", "some-custom-type", { presentationInput: true }),
      ]
      expect(getInputNodes(nodes)).toHaveLength(1)
    })

    it("includes legacy presentationVisible=true when type is an input type", () => {
      const nodes = [
        mkNode("n1", "text-prompt", { presentationVisible: true }),
      ]
      expect(getInputNodes(nodes)).toEqual([nodes[0]])
    })

    it("excludes legacy presentationVisible=true when type is NOT an input type", () => {
      const nodes = [
        mkNode("n1", "generate-image", { presentationVisible: true }),
      ]
      expect(getInputNodes(nodes)).toHaveLength(0)
    })

    it("excludes nodes without presentationInput or presentationVisible", () => {
      const nodes = [mkNode("n1", "text-prompt", {})]
      expect(getInputNodes(nodes)).toHaveLength(0)
    })

    it("excludes sticky-note even with presentationInput", () => {
      const nodes = [
        mkNode("n1", "sticky-note", { presentationInput: true }),
      ]
      expect(getInputNodes(nodes)).toHaveLength(0)
    })

    it("excludes webhook-trigger even with presentationInput", () => {
      const nodes = [
        mkNode("n1", "webhook-trigger", { presentationInput: true }),
      ]
      expect(getInputNodes(nodes)).toHaveLength(0)
    })

    it("excludes schedule-trigger even with presentationInput", () => {
      const nodes = [
        mkNode("n1", "schedule-trigger", { presentationInput: true }),
      ]
      expect(getInputNodes(nodes)).toHaveLength(0)
    })

    it("excludes sub-workflow-input even with presentationInput", () => {
      const nodes = [
        mkNode("n1", "sub-workflow-input", { presentationInput: true }),
      ]
      expect(getInputNodes(nodes)).toHaveLength(0)
    })

    it("excludes sub-workflow-output even with presentationInput", () => {
      const nodes = [
        mkNode("n1", "sub-workflow-output", { presentationInput: true }),
      ]
      expect(getInputNodes(nodes)).toHaveLength(0)
    })

    it("excludes hidden nodes", () => {
      const nodes = [
        mkNode("n1", "text-prompt", { presentationInput: true }, true),
      ]
      expect(getInputNodes(nodes)).toHaveLength(0)
    })

    it("excludes nodes with no type", () => {
      const nodes = [mkNode("n1", "", { presentationInput: true })]
      expect(getInputNodes(nodes)).toHaveLength(0)
    })
  })

  describe("curatedOnly=false", () => {
    it("includes all valid non-excluded, non-hidden nodes", () => {
      const nodes = [
        mkNode("n1", "text-prompt", {}),
        mkNode("n2", "generate-image", {}),
        mkNode("n3", "ai-writer", {}),
      ]
      expect(getInputNodes(nodes, false)).toHaveLength(3)
    })

    it("still excludes always-excluded types", () => {
      const nodes = [
        mkNode("n1", "sticky-note", {}),
        mkNode("n2", "webhook-trigger", {}),
        mkNode("n3", "text-prompt", {}),
      ]
      expect(getInputNodes(nodes, false)).toEqual([nodes[2]])
    })

    it("still excludes hidden nodes", () => {
      const nodes = [mkNode("n1", "text-prompt", {}, true)]
      expect(getInputNodes(nodes, false)).toHaveLength(0)
    })

    it("still excludes nodes with no type", () => {
      const nodes = [mkNode("n1", "", {})]
      expect(getInputNodes(nodes, false)).toHaveLength(0)
    })
  })

  it("preserves generic type narrowing", () => {
    interface MyNode extends GenericNode {
      extra: number
    }
    const nodes: MyNode[] = [
      { id: "n1", type: "text-prompt", data: { presentationInput: true }, extra: 42 },
    ]
    const result = getInputNodes(nodes)
    expect(result[0].extra).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// getOutputNodes
// ---------------------------------------------------------------------------

describe("getOutputNodes", () => {
  describe("curatedOnly (default)", () => {
    it("includes nodes with presentationOutput=true", () => {
      const nodes = [
        mkNode("n1", "generate-image", { presentationOutput: true }),
      ]
      expect(getOutputNodes(nodes, [])).toEqual([nodes[0]])
    })

    it("includes presentationOutput=true even for non-media types", () => {
      const nodes = [
        mkNode("n1", "combine-text", { presentationOutput: true }),
      ]
      // combine-text is a NON_OUTPUT_TYPE but presentationOutput overrides that
      expect(getOutputNodes(nodes, [])).toHaveLength(1)
    })

    it("includes legacy presentationVisible=true leaf node", () => {
      const nodes = [
        mkNode("n1", "generate-image", { presentationVisible: true }),
      ]
      // No outgoing edges => leaf
      expect(getOutputNodes(nodes, [])).toEqual([nodes[0]])
    })

    it("includes legacy presentationVisible=true media producer with outgoing edge", () => {
      const nodes = [
        mkNode("n1", "generate-image", { presentationVisible: true }),
        mkNode("n2", "image-to-video", {}),
      ]
      const edges = [mkEdge("n1", "n2")]
      // generate-image is a MEDIA_PRODUCING_TYPE, so included despite having outgoing
      expect(getOutputNodes(nodes, edges)).toEqual([nodes[0]])
    })

    it("excludes legacy presentationVisible=true non-media node with outgoing edge", () => {
      const nodes = [
        mkNode("n1", "transcribe", { presentationVisible: true }),
        mkNode("n2", "ai-writer", {}),
      ]
      const edges = [mkEdge("n1", "n2")]
      // transcribe is NOT a MEDIA_PRODUCING_TYPE and has outgoing edge
      expect(getOutputNodes(nodes, edges)).toHaveLength(0)
    })

    it("excludes NON_OUTPUT_TYPES even with presentationVisible", () => {
      const nodes = [
        mkNode("n1", "text-prompt", { presentationVisible: true }),
        mkNode("n2", "upload-image", { presentationVisible: true }),
        mkNode("n3", "sticky-note", { presentationVisible: true }),
        mkNode("n4", "combine-text", { presentationVisible: true }),
      ]
      expect(getOutputNodes(nodes, [])).toHaveLength(0)
    })

    it("excludes nodes without presentationOutput or presentationVisible", () => {
      const nodes = [mkNode("n1", "generate-image", {})]
      expect(getOutputNodes(nodes, [])).toHaveLength(0)
    })

    it("excludes always-excluded types even with presentationOutput", () => {
      const excluded = [
        "sticky-note",
        "webhook-trigger",
        "schedule-trigger",
        "sub-workflow-input",
        "sub-workflow-output",
      ]
      for (const t of excluded) {
        const nodes = [mkNode("n1", t, { presentationOutput: true })]
        expect(getOutputNodes(nodes, [])).toHaveLength(0)
      }
    })

    it("excludes hidden nodes", () => {
      const nodes = [
        mkNode("n1", "generate-image", { presentationOutput: true }, true),
      ]
      expect(getOutputNodes(nodes, [])).toHaveLength(0)
    })

    it("excludes nodes with no type", () => {
      const nodes = [mkNode("n1", "", { presentationOutput: true })]
      expect(getOutputNodes(nodes, [])).toHaveLength(0)
    })
  })

  describe("curatedOnly=false", () => {
    it("includes all valid non-excluded, non-hidden nodes", () => {
      const nodes = [
        mkNode("n1", "generate-image", {}),
        mkNode("n2", "text-to-video", {}),
      ]
      expect(getOutputNodes(nodes, [], false)).toHaveLength(2)
    })

    it("still excludes always-excluded types", () => {
      const nodes = [
        mkNode("n1", "sticky-note", {}),
        mkNode("n2", "generate-image", {}),
      ]
      expect(getOutputNodes(nodes, [], false)).toEqual([nodes[1]])
    })

    it("still excludes hidden nodes", () => {
      const nodes = [mkNode("n1", "generate-image", {}, true)]
      expect(getOutputNodes(nodes, [], false)).toHaveLength(0)
    })
  })
})

// ---------------------------------------------------------------------------
// getOutputType
// ---------------------------------------------------------------------------

describe("getOutputType", () => {
  describe("image types", () => {
    it.each(["generate-image", "edit-image", "image-to-image", "upload-image"])(
      "%s -> image",
      (t) => {
        expect(getOutputType(t)).toBe("image")
      },
    )
  })

  describe("video types", () => {
    it.each([
      "image-to-video",
      "text-to-video",
      "video-to-video",
      "extend-video",
      "render-video",
      "video-composer",
      "after-effects",
      "lottie-overlay",
      "3d-title",
      "motion-graphics",
      "composite",
      "combine-videos",
      "merge-video-audio",
      "resize-video",
      "trim-video",
      "speed-ramp",
      "loop-video",
      "fade-video",
      "transcode-video",
      "upload-video",
      "lip-sync",
      "motion-transfer",
      "video-upscale",
      "add-captions",
      "social-media-format",
    ])("%s -> video", (t) => {
      expect(getOutputType(t)).toBe("video")
    })
  })

  describe("audio types", () => {
    it.each([
      "text-to-speech",
      "generate-music",
      "text-to-audio",
      "text-to-dialogue",
      "voice-changer",
      "dubbing",
      "voice-remix",
      "voice-design",
      "mix-audio",
      "adjust-volume",
      "trim-audio",
      "audio-isolation",
      "upload-audio",
    ])("%s -> audio", (t) => {
      expect(getOutputType(t)).toBe("audio")
    })
  })

  describe("text types", () => {
    it.each([
      "generate-script",
      "ai-writer",
      "transcribe",
      "image-to-text",
      "qa-check",
      "text-prompt",
    ])("%s -> text", (t) => {
      expect(getOutputType(t)).toBe("text")
    })
  })

  describe("data / unknown", () => {
    it("returns data for unknown type", () => {
      expect(getOutputType("some-unknown-type")).toBe("data")
    })

    it("returns data for undefined", () => {
      expect(getOutputType(undefined)).toBe("data")
    })
  })
})

// ---------------------------------------------------------------------------
// getNodeResult
// ---------------------------------------------------------------------------

describe("getNodeResult", () => {
  describe("previewItems", () => {
    it("returns url from first visible image item", () => {
      const data = {
        previewItems: [
          { type: "image", value: "url1", visible: true },
          { type: "image", value: "url2", visible: true },
        ],
      }
      expect(getNodeResult(data)).toEqual({ url: "url1" })
    })

    it("returns url from first visible video item", () => {
      const data = {
        previewItems: [{ type: "video", value: "vid-url", visible: true }],
      }
      expect(getNodeResult(data)).toEqual({ url: "vid-url" })
    })

    it("returns url from first visible audio item", () => {
      const data = {
        previewItems: [{ type: "audio", value: "audio-url", visible: true }],
      }
      expect(getNodeResult(data)).toEqual({ url: "audio-url" })
    })

    it("returns text from a non-media preview item", () => {
      const data = {
        previewItems: [{ type: "text", value: "some text", visible: true }],
      }
      expect(getNodeResult(data)).toEqual({ text: "some text" })
    })

    it("skips visible=false items and picks the next visible one", () => {
      const data = {
        previewItems: [
          { type: "image", value: "hidden-url", visible: false },
          { type: "image", value: "shown-url", visible: true },
        ],
      }
      expect(getNodeResult(data)).toEqual({ url: "shown-url" })
    })

    it("falls back to first item when all are visible=false", () => {
      const data = {
        previewItems: [
          { type: "image", value: "only-option", visible: false },
        ],
      }
      expect(getNodeResult(data)).toEqual({ url: "only-option" })
    })

    it("treats undefined visible as visible", () => {
      const data = {
        previewItems: [{ type: "video", value: "vid" }],
      }
      expect(getNodeResult(data)).toEqual({ url: "vid" })
    })
  })

  describe("generatedResults", () => {
    it("returns url from first result when no activeResultIndex", () => {
      const data = {
        generatedResults: [{ url: "r1" }, { url: "r2" }],
      }
      expect(getNodeResult(data)).toEqual({ url: "r1", text: undefined })
    })

    it("returns url from active result index", () => {
      const data = {
        generatedResults: [{ url: "r0" }, { url: "r1" }, { url: "r2" }],
        activeResultIndex: 2,
      }
      expect(getNodeResult(data)).toEqual({ url: "r2", text: undefined })
    })

    it("falls back to first result when activeResultIndex is out of bounds", () => {
      const data = {
        generatedResults: [{ url: "r0" }],
        activeResultIndex: 99,
      }
      expect(getNodeResult(data)).toEqual({ url: "r0", text: undefined })
    })

    it("reads imageUrl field", () => {
      const data = {
        generatedResults: [{ imageUrl: "img" }],
      }
      expect(getNodeResult(data)).toEqual({ url: "img", text: undefined })
    })

    it("reads videoUrl field", () => {
      const data = {
        generatedResults: [{ videoUrl: "vid" }],
      }
      expect(getNodeResult(data)).toEqual({ url: "vid", text: undefined })
    })

    it("reads audioUrl field", () => {
      const data = {
        generatedResults: [{ audioUrl: "aud" }],
      }
      expect(getNodeResult(data)).toEqual({ url: "aud", text: undefined })
    })

    it("reads text field", () => {
      const data = {
        generatedResults: [{ text: "hello" }],
      }
      expect(getNodeResult(data)).toEqual({ url: undefined, text: "hello" })
    })

    it("reads script field", () => {
      const data = {
        generatedResults: [{ script: "scene 1" }],
      }
      expect(getNodeResult(data)).toEqual({ url: undefined, text: "scene 1" })
    })

    it("prefers url over imageUrl", () => {
      const data = {
        generatedResults: [{ url: "primary", imageUrl: "fallback" }],
      }
      expect(getNodeResult(data)).toEqual({ url: "primary", text: undefined })
    })

    it("prefers text over script", () => {
      const data = {
        generatedResults: [{ text: "primary", script: "fallback" }],
      }
      expect(getNodeResult(data)).toEqual({ url: undefined, text: "primary" })
    })
  })

  describe("fallback individual fields", () => {
    it("reads generatedImageUrl", () => {
      expect(getNodeResult({ generatedImageUrl: "img" })).toEqual({
        url: "img",
        text: undefined,
      })
    })

    it("reads generatedVideoUrl", () => {
      expect(getNodeResult({ generatedVideoUrl: "vid" })).toEqual({
        url: "vid",
        text: undefined,
      })
    })

    it("reads generatedAudioUrl", () => {
      expect(getNodeResult({ generatedAudioUrl: "aud" })).toEqual({
        url: "aud",
        text: undefined,
      })
    })

    it("reads generatedScript", () => {
      expect(getNodeResult({ generatedScript: "script text" })).toEqual({
        url: undefined,
        text: "script text",
      })
    })

    it("reads generatedText", () => {
      expect(getNodeResult({ generatedText: "some text" })).toEqual({
        url: undefined,
        text: "some text",
      })
    })

    it("prefers generatedImageUrl over generatedVideoUrl", () => {
      expect(
        getNodeResult({
          generatedImageUrl: "img",
          generatedVideoUrl: "vid",
        }),
      ).toEqual({ url: "img", text: undefined })
    })

    it("prefers generatedScript over generatedText", () => {
      expect(
        getNodeResult({
          generatedScript: "script",
          generatedText: "text",
        }),
      ).toEqual({ url: undefined, text: "script" })
    })
  })

  describe("empty / no result", () => {
    it("returns undefined url and text for empty data", () => {
      expect(getNodeResult({})).toEqual({ url: undefined, text: undefined })
    })

    it("returns undefined for empty generatedResults array", () => {
      expect(getNodeResult({ generatedResults: [] })).toEqual({
        url: undefined,
        text: undefined,
      })
    })

    it("returns undefined for empty previewItems array", () => {
      // empty previewItems falls through to generatedResults/fallback
      expect(getNodeResult({ previewItems: [] })).toEqual({
        url: undefined,
        text: undefined,
      })
    })
  })

  describe("priority: previewItems > generatedResults > fallback", () => {
    it("previewItems take priority over generatedResults", () => {
      const data = {
        previewItems: [{ type: "image", value: "preview-url", visible: true }],
        generatedResults: [{ url: "result-url" }],
        generatedImageUrl: "fallback-url",
      }
      expect(getNodeResult(data)).toEqual({ url: "preview-url" })
    })

    it("generatedResults take priority over fallback fields", () => {
      const data = {
        generatedResults: [{ url: "result-url" }],
        generatedImageUrl: "fallback-url",
      }
      expect(getNodeResult(data)).toEqual({ url: "result-url", text: undefined })
    })
  })
})

// ---------------------------------------------------------------------------
// getNodeLabel
// ---------------------------------------------------------------------------

describe("getNodeLabel", () => {
  it("returns data.label when present", () => {
    const node = mkNode("n1", "generate-image", { label: "My Node" })
    expect(getNodeLabel(node)).toBe("My Node")
  })

  it("converts type to title case when no label", () => {
    const node = mkNode("n1", "generate-image", {})
    expect(getNodeLabel(node)).toBe("Generate Image")
  })

  it("handles single-word type", () => {
    const node = mkNode("n1", "transcribe", {})
    expect(getNodeLabel(node)).toBe("Transcribe")
  })

  it("handles multi-dash type", () => {
    const node = mkNode("n1", "text-to-speech", {})
    expect(getNodeLabel(node)).toBe("Text To Speech")
  })

  it("handles 3d-title (leading digit)", () => {
    const node = mkNode("n1", "3d-title", {})
    expect(getNodeLabel(node)).toBe("3d Title")
  })

  it("returns 'Node' when type is empty and no label", () => {
    const node = mkNode("n1", "", {})
    expect(getNodeLabel(node)).toBe("Node")
  })

  it("prefers label over type-derived name", () => {
    const node = mkNode("n1", "generate-image", { label: "Custom Name" })
    expect(getNodeLabel(node)).toBe("Custom Name")
  })

  it("ignores empty string label and falls back to type", () => {
    const node = mkNode("n1", "text-prompt", { label: "" })
    expect(getNodeLabel(node)).toBe("Text Prompt")
  })
})

// ---------------------------------------------------------------------------
// getInputFieldSchema
// ---------------------------------------------------------------------------

describe("getInputFieldSchema", () => {
  it("returns schema for text-prompt", () => {
    expect(getInputFieldSchema("text-prompt")).toEqual({
      key: "text",
      type: "text",
    })
  })

  it("returns schema for upload-image", () => {
    expect(getInputFieldSchema("upload-image")).toEqual({
      key: "url",
      type: "image-url",
    })
  })

  it("returns schema for upload-video", () => {
    expect(getInputFieldSchema("upload-video")).toEqual({
      key: "url",
      type: "video-url",
    })
  })

  it("returns schema for upload-audio", () => {
    expect(getInputFieldSchema("upload-audio")).toEqual({
      key: "url",
      type: "audio-url",
    })
  })

  it("returns schema for duration (number type)", () => {
    expect(getInputFieldSchema("duration")).toEqual({
      key: "duration",
      type: "number",
    })
  })

  it("returns schema for tone (select type)", () => {
    expect(getInputFieldSchema("tone")).toEqual({
      key: "tone",
      type: "select",
    })
  })

  it("returns schema for reference-audio", () => {
    expect(getInputFieldSchema("reference-audio")).toEqual({
      key: "extractedAudioUrl",
      type: "audio-url",
    })
  })

  it("returns undefined for unknown type", () => {
    expect(getInputFieldSchema("generate-image")).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(getInputFieldSchema("")).toBeUndefined()
  })

  it("has entries for all INPUT_NODE_TYPES", () => {
    for (const t of INPUT_NODE_TYPES) {
      expect(getInputFieldSchema(t)).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// migrateToItems
// ---------------------------------------------------------------------------

describe("migrateToItems", () => {
  it("returns undefined for undefined input", () => {
    expect(migrateToItems(undefined)).toBeUndefined()
  })

  it("migrates string array to node items", () => {
    expect(migrateToItems(["n1", "n2"])).toEqual([
      { type: "node", nodeId: "n1" },
      { type: "node", nodeId: "n2" },
    ])
  })

  it("returns empty array for empty input", () => {
    expect(migrateToItems([])).toEqual([])
  })

  it("preserves order", () => {
    const result = migrateToItems(["c", "a", "b"])!
    expect(result.map((i) => (i as { nodeId: string }).nodeId)).toEqual([
      "c",
      "a",
      "b",
    ])
  })
})

// ---------------------------------------------------------------------------
// validateNoNestedGroups
// ---------------------------------------------------------------------------

describe("validateNoNestedGroups", () => {
  it("returns non-group items unchanged", () => {
    const items: PresentationItem[] = [
      { type: "node", nodeId: "n1" },
      { type: "field", id: "f1", nodeId: "n1", field: "text" },
    ]
    expect(validateNoNestedGroups(items)).toEqual(items)
  })

  it("strips nested groups from a group's children", () => {
    const nested: PresentationItem = {
      type: "group",
      id: "inner",
      title: "Inner",
      items: [{ type: "node", nodeId: "n2" }],
    }
    const items: PresentationItem[] = [
      {
        type: "group",
        id: "outer",
        title: "Outer",
        items: [{ type: "node", nodeId: "n1" }, nested],
      },
    ]
    const result = validateNoNestedGroups(items)
    expect(result).toHaveLength(1)
    const group = result[0] as Extract<PresentationItem, { type: "group" }>
    expect(group.items).toHaveLength(1)
    expect(group.items[0]).toEqual({ type: "node", nodeId: "n1" })
  })

  it("keeps all non-group children within a group", () => {
    const items: PresentationItem[] = [
      {
        type: "group",
        id: "g1",
        title: "G1",
        items: [
          { type: "node", nodeId: "n1" },
          { type: "field", id: "f1", nodeId: "n1", field: "text" },
          { type: "output", id: "o1", nodeId: "n1", outputKey: "url" },
        ],
      },
    ]
    const result = validateNoNestedGroups(items)
    const group = result[0] as Extract<PresentationItem, { type: "group" }>
    expect(group.items).toHaveLength(3)
  })

  it("handles empty group", () => {
    const items: PresentationItem[] = [
      { type: "group", id: "g1", title: "Empty", items: [] },
    ]
    const result = validateNoNestedGroups(items)
    const group = result[0] as Extract<PresentationItem, { type: "group" }>
    expect(group.items).toHaveLength(0)
  })

  it("does not mutate the original items", () => {
    const nested: PresentationItem = {
      type: "group",
      id: "inner",
      title: "Inner",
      items: [{ type: "node", nodeId: "n2" }],
    }
    const original: PresentationItem[] = [
      {
        type: "group",
        id: "outer",
        title: "Outer",
        items: [{ type: "node", nodeId: "n1" }, nested],
      },
    ]
    validateNoNestedGroups(original)
    const group = original[0] as Extract<PresentationItem, { type: "group" }>
    expect(group.items).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// flattenItems
// ---------------------------------------------------------------------------

describe("flattenItems", () => {
  it("returns flat items unchanged", () => {
    const items: PresentationItem[] = [
      { type: "node", nodeId: "n1" },
      { type: "node", nodeId: "n2" },
    ]
    expect(flattenItems(items)).toEqual(items)
  })

  it("unwraps group items", () => {
    const items: PresentationItem[] = [
      { type: "node", nodeId: "n1" },
      {
        type: "group",
        id: "g1",
        title: "G1",
        items: [{ type: "node", nodeId: "n2" }],
      },
    ]
    expect(flattenItems(items)).toEqual([
      { type: "node", nodeId: "n1" },
      { type: "node", nodeId: "n2" },
    ])
  })

  it("recursively unwraps nested groups", () => {
    const items: PresentationItem[] = [
      {
        type: "group",
        id: "outer",
        title: "Outer",
        items: [
          {
            type: "group",
            id: "inner",
            title: "Inner",
            items: [{ type: "node", nodeId: "deep" }],
          },
        ],
      },
    ]
    expect(flattenItems(items)).toEqual([{ type: "node", nodeId: "deep" }])
  })

  it("handles empty array", () => {
    expect(flattenItems([])).toEqual([])
  })

  it("handles empty groups", () => {
    const items: PresentationItem[] = [
      { type: "group", id: "g1", title: "Empty", items: [] },
      { type: "node", nodeId: "n1" },
    ]
    expect(flattenItems(items)).toEqual([{ type: "node", nodeId: "n1" }])
  })

  it("preserves order across groups", () => {
    const items: PresentationItem[] = [
      { type: "node", nodeId: "a" },
      {
        type: "group",
        id: "g1",
        title: "G1",
        items: [
          { type: "node", nodeId: "b" },
          { type: "node", nodeId: "c" },
        ],
      },
      { type: "node", nodeId: "d" },
    ]
    const result = flattenItems(items)
    expect(result.map((i) => (i as { nodeId: string }).nodeId)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ])
  })
})

// ---------------------------------------------------------------------------
// getItemSortId
// ---------------------------------------------------------------------------

describe("getItemSortId", () => {
  it("returns nodeId for node items", () => {
    const item: PresentationItem = { type: "node", nodeId: "n1" }
    expect(getItemSortId(item)).toBe("n1")
  })

  it("returns id for field items", () => {
    const item: PresentationItem = {
      type: "field",
      id: "f1",
      nodeId: "n1",
      field: "text",
    }
    expect(getItemSortId(item)).toBe("f1")
  })

  it("returns id for output items", () => {
    const item: PresentationItem = {
      type: "output",
      id: "o1",
      nodeId: "n1",
      outputKey: "url",
    }
    expect(getItemSortId(item)).toBe("o1")
  })

  it("returns id for group items", () => {
    const item: PresentationItem = {
      type: "group",
      id: "g1",
      title: "G1",
      items: [],
    }
    expect(getItemSortId(item)).toBe("g1")
  })

  it("returns id for richtext items", () => {
    const item: PresentationItem = {
      type: "richtext",
      id: "rt1",
      content: "Hello",
    }
    expect(getItemSortId(item)).toBe("rt1")
  })
})

// ---------------------------------------------------------------------------
// cleanOrphanedItems
// ---------------------------------------------------------------------------

describe("cleanOrphanedItems", () => {
  it("removes node items whose nodeId is not in the set", () => {
    const items: PresentationItem[] = [
      { type: "node", nodeId: "n1" },
      { type: "node", nodeId: "n2" },
      { type: "node", nodeId: "n3" },
    ]
    const ids = new Set(["n1", "n3"])
    expect(cleanOrphanedItems(items, ids)).toEqual([
      { type: "node", nodeId: "n1" },
      { type: "node", nodeId: "n3" },
    ])
  })

  it("removes field items whose nodeId is not in the set", () => {
    const items: PresentationItem[] = [
      { type: "field", id: "f1", nodeId: "n1", field: "text" },
      { type: "field", id: "f2", nodeId: "gone", field: "text" },
    ]
    const ids = new Set(["n1"])
    expect(cleanOrphanedItems(items, ids)).toEqual([
      { type: "field", id: "f1", nodeId: "n1", field: "text" },
    ])
  })

  it("removes output items whose nodeId is not in the set", () => {
    const items: PresentationItem[] = [
      { type: "output", id: "o1", nodeId: "n1", outputKey: "url" },
      { type: "output", id: "o2", nodeId: "gone", outputKey: "url" },
    ]
    const ids = new Set(["n1"])
    expect(cleanOrphanedItems(items, ids)).toEqual([
      { type: "output", id: "o1", nodeId: "n1", outputKey: "url" },
    ])
  })

  it("keeps group items (they use id, not nodeId for membership)", () => {
    const items: PresentationItem[] = [
      {
        type: "group",
        id: "g1",
        title: "Group",
        items: [{ type: "node", nodeId: "n1" }],
      },
    ]
    const ids = new Set(["n1"])
    expect(cleanOrphanedItems(items, ids)).toHaveLength(1)
  })

  it("keeps richtext items (no nodeId)", () => {
    const items: PresentationItem[] = [
      { type: "richtext", id: "rt1", content: "Hello" },
    ]
    const ids = new Set<string>()
    expect(cleanOrphanedItems(items, ids)).toHaveLength(1)
  })

  it("recursively cleans children of group items", () => {
    const items: PresentationItem[] = [
      {
        type: "group",
        id: "g1",
        title: "Group",
        items: [
          { type: "node", nodeId: "n1" },
          { type: "node", nodeId: "orphan" },
          { type: "field", id: "f1", nodeId: "n1", field: "text" },
        ],
      },
    ]
    const ids = new Set(["n1"])
    const result = cleanOrphanedItems(items, ids)
    const group = result[0] as Extract<PresentationItem, { type: "group" }>
    expect(group.items).toHaveLength(2)
    expect(group.items).toEqual([
      { type: "node", nodeId: "n1" },
      { type: "field", id: "f1", nodeId: "n1", field: "text" },
    ])
  })

  it("keeps group even when all its children are orphaned", () => {
    const items: PresentationItem[] = [
      {
        type: "group",
        id: "g1",
        title: "Group",
        items: [{ type: "node", nodeId: "orphan" }],
      },
    ]
    const ids = new Set<string>()
    const result = cleanOrphanedItems(items, ids)
    expect(result).toHaveLength(1)
    const group = result[0] as Extract<PresentationItem, { type: "group" }>
    expect(group.items).toHaveLength(0)
  })

  it("handles empty items array", () => {
    expect(cleanOrphanedItems([], new Set(["n1"]))).toEqual([])
  })

  it("does not mutate the original items", () => {
    const child: PresentationItem = { type: "node", nodeId: "orphan" }
    const items: PresentationItem[] = [
      { type: "group", id: "g1", title: "G", items: [child] },
      { type: "node", nodeId: "orphan" },
    ]
    cleanOrphanedItems(items, new Set<string>())
    expect(items).toHaveLength(2)
    const group = items[0] as Extract<PresentationItem, { type: "group" }>
    expect(group.items).toHaveLength(1)
  })
})
