import { describe, it, expect } from "vitest"
import { buildImageAssembleInput } from "../build-image-assemble-input"
import type { WorkflowNode, WorkflowEdge, CharacterDefinition } from "@/types/nodes"

/**
 * Focused tests for the preview-side assembler-input builder. It mirrors the
 * field set the RUN passes to `assembleImageInput` (execute-node.ts) AS CLOSELY
 * AS A LIVE PREVIEW CAN: it carries the user/flow templates through verbatim and
 * builds `connectedReferences` the way the quick-edit modal does.
 *
 * Pure (no store access): the hook passes store slices in. These run against the
 * real `buildImageConnectedReferences` with no mocks.
 */

describe("buildImageAssembleInput", () => {
  it("carries userTemplates + the composed userPrompt through verbatim", () => {
    const node: WorkflowNode = {
      id: "n1",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { label: "Image" },
    } as unknown as WorkflowNode

    const out = buildImageAssembleInput({
      node,
      nodes: [node],
      edges: [],
      characterDefinitions: [],
      userPromptTemplates: { greeting: "hello {name}" },
      flowPromptTemplates: {},
      // The hook passes its already-composed `preBuildPrompt`; templates are
      // resolved INSIDE buildImagePrompt, so a `{Var}`-bearing composed prompt
      // must survive into `userPrompt` unchanged here.
      composedPrompt: "a knight {greeting}",
      provider: "gpt-image",
      style: undefined,
      styleBypass: false,
      resolvedNegative: undefined,
    })

    expect(out.userPrompt).toBe("a knight {greeting}")
    expect(out.userTemplates).toEqual({ greeting: "hello {name}" })
    expect(out.provider).toBe("gpt-image")
  })

  it("clears style when styleBypass is set, else passes it through", () => {
    const node: WorkflowNode = {
      id: "n1",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { label: "Image" },
    } as unknown as WorkflowNode

    const bypassed = buildImageAssembleInput({
      node,
      nodes: [node],
      edges: [],
      characterDefinitions: [],
      composedPrompt: "a knight",
      provider: "gpt-image",
      style: "noir",
      styleBypass: true,
      resolvedNegative: undefined,
    })
    expect(bypassed.style).toBeUndefined()

    const kept = buildImageAssembleInput({
      node,
      nodes: [node],
      edges: [],
      characterDefinitions: [],
      composedPrompt: "a knight",
      provider: "gpt-image",
      style: "noir",
      styleBypass: false,
      resolvedNegative: undefined,
    })
    expect(kept.style).toBe("noir")
  })

  it("builds a non-empty connectedReferences from a wired character", () => {
    const consumer: WorkflowNode = {
      id: "n1",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { label: "Image" },
    } as unknown as WorkflowNode
    const character: WorkflowNode = {
      id: "char1",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "Hero",
        characterName: "Aria",
        sourceImageUrl: "https://example.com/aria.png",
        description: "a brave knight",
      },
    } as unknown as WorkflowNode
    const edges: WorkflowEdge[] = [
      { id: "e", source: "char1", target: "n1" } as unknown as WorkflowEdge,
    ]

    const out = buildImageAssembleInput({
      node: consumer,
      nodes: [consumer, character],
      edges,
      characterDefinitions: [],
      composedPrompt: "@Aria fighting",
      provider: "gpt-image",
      styleBypass: false,
    })

    expect(out.connectedReferences && out.connectedReferences.length).toBeGreaterThan(0)
    expect(out.connectedReferences?.[0]?.url).toBe("https://example.com/aria.png")
  })

  it("derives attachedChars from characterDefinitionIds + characterDefinitions", () => {
    const consumer: WorkflowNode = {
      id: "n1",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { label: "Image", characterDefinitionIds: ["cd1"] },
    } as unknown as WorkflowNode
    const defs: CharacterDefinition[] = [
      {
        id: "cd1",
        name: "Library Hero",
        type: "reference",
        category: "object",
        referenceImageUrl: "https://example.com/lib.png",
        description: "a library hero",
      },
    ]

    const out = buildImageAssembleInput({
      node: consumer,
      nodes: [consumer],
      edges: [],
      characterDefinitions: defs,
      composedPrompt: "a scene",
      provider: "gpt-image",
      styleBypass: false,
    })

    // The attached reference-type definition becomes a connected reference.
    expect(out.connectedReferences?.some((r) => r.url === "https://example.com/lib.png")).toBe(true)
  })

  it("only sets ancestorRefs as a fallback when there are no connected-reference URLs", () => {
    // Wired character → connectedReferences has URLs → ancestorRefs must be unset
    // (mirrors execute-node's `orderedUrls.length === 0 ? collectAncestorRefs : []`).
    const consumer: WorkflowNode = {
      id: "n1",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { label: "Image" },
    } as unknown as WorkflowNode
    const character: WorkflowNode = {
      id: "char1",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "Hero",
        characterName: "Aria",
        sourceImageUrl: "https://example.com/aria.png",
      },
    } as unknown as WorkflowNode
    const edges: WorkflowEdge[] = [
      { id: "e", source: "char1", target: "n1" } as unknown as WorkflowEdge,
    ]

    const out = buildImageAssembleInput({
      node: consumer,
      nodes: [consumer, character],
      edges,
      characterDefinitions: [],
      composedPrompt: "@Aria",
      provider: "gpt-image",
      styleBypass: false,
    })
    expect(out.ancestorRefs).toBeUndefined()
  })

  it("passes negativePrompt through as resolvedNegative (or undefined when empty)", () => {
    const node: WorkflowNode = {
      id: "n1",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { label: "Image" },
    } as unknown as WorkflowNode
    const withNeg = buildImageAssembleInput({
      node,
      nodes: [node],
      edges: [],
      characterDefinitions: [],
      composedPrompt: "a knight",
      provider: "gpt-image",
      styleBypass: false,
      resolvedNegative: "blurry",
    })
    expect(withNeg.negativePrompt).toBe("blurry")

    const noNeg = buildImageAssembleInput({
      node,
      nodes: [node],
      edges: [],
      characterDefinitions: [],
      composedPrompt: "a knight",
      provider: "gpt-image",
      styleBypass: false,
      resolvedNegative: "",
    })
    expect(noNeg.negativePrompt).toBeUndefined()
  })
})
