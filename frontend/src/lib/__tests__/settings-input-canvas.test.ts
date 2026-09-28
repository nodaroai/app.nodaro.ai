/**
 * The Settings input on Generate Video / Generate Video Pro / Generate Image:
 * one pip that takes the Generation Settings nodes each accepts (Aspect Ratio,
 * Duration, Provider — no Duration on a still). The canvas drop, the handle
 * registry, the add-node popup (both directions), the fan-out plan and the
 * price read one rule — `@nodaro/shared` settings-input.ts.
 */
import { describe, it, expect } from "vitest"
import { SETTINGS_INPUT_CONSUMERS, SETTINGS_INPUT_HANDLE, buildVideoCreditModelIdentifier, planFanOut, withWiredSettings } from "@nodaro/shared"
import { TARGET_HANDLE_ACCEPTS } from "../target-handle-registry"
import { getCompatibleNodes, resolveTargetHandle, TYPED_HANDLE_IDS, PARAMETER_ACCEPTING_HANDLE_IDS } from "../node-compatibility"
import { getNodeOptions } from "../node-options"
import { NODE_DEF_MAP, type WorkflowEdge, type WorkflowNode } from "@/types/nodes"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"

const CONSUMERS = ["generate-video", "generate-video-pro"] as const
const ALL_CONSUMERS = [...CONSUMERS, "generate-image"] as const

describe("Settings input — canvas rule", () => {
  it.each(ALL_CONSUMERS)("%s declares the input and registers its rule with a label", (type) => {
    expect(NODE_DEF_MAP.get(type)?.inputs).toContain(SETTINGS_INPUT_HANDLE)
    const entry = TARGET_HANDLE_ACCEPTS[type]?.find((e) => e.handleId === SETTINGS_INPUT_HANDLE)
    expect(entry?.label).toBe("Settings")
    for (const source of SETTINGS_INPUT_CONSUMERS[type] ?? []) expect(entry?.accepts(source), source).toBe(true)
    expect(entry?.accepts("text-prompt")).toBe(false)
    expect(entry?.accepts("scene-count")).toBe(false)
  })

  it("Generate Image takes no Duration (a still has no length)", () => {
    const entry = TARGET_HANDLE_ACCEPTS["generate-image"]?.find((e) => e.handleId === SETTINGS_INPUT_HANDLE)
    expect(entry?.accepts("duration")).toBe(false)
  })

  it("is a typed, Parameter-accepting handle, so the popup shows the settings nodes", () => {
    expect(TYPED_HANDLE_IDS.has(SETTINGS_INPUT_HANDLE)).toBe(true)
    expect(PARAMETER_ACCEPTING_HANDLE_IDS.has(SETTINGS_INPUT_HANDLE)).toBe(true)
  })

  it.each(ALL_CONSUMERS)("dragging from %s's Settings pip offers exactly the settings nodes it takes", (type) => {
    const offered = getCompatibleNodes(SETTINGS_INPUT_HANDLE, "target", getNodeOptions(), type).direct.map((o) => o.type)
    expect([...offered].sort()).toEqual([...(SETTINGS_INPUT_CONSUMERS[type] ?? [])].sort())
  })

  it("every consumer with a Settings input is a node that renders one", () => {
    for (const type of Object.keys(SETTINGS_INPUT_CONSUMERS)) {
      expect(NODE_DEF_MAP.get(type as never)?.inputs, type).toContain(SETTINGS_INPUT_HANDLE)
    }
  })
})

describe("dragging out of a settings node", () => {
  it.each([
    ["ratio", "aspect-ratio"],
    ["duration", "duration"],
    ["provider", "provider"],
  ])("from the %s output offers the nodes that take it and wires their Settings input", (sourceHandle, type) => {
    const takers = ALL_CONSUMERS.filter((c) => (SETTINGS_INPUT_CONSUMERS[c] as readonly string[]).includes(type))
    const offered = getCompatibleNodes(sourceHandle, "source", getNodeOptions(), type).direct.map((o) => o.type)
    expect(offered).toEqual(expect.arrayContaining(takers))
    for (const consumer of takers) expect(resolveTargetHandle(consumer, sourceHandle, "source")).toBe(SETTINGS_INPUT_HANDLE)
  })

  it("a Duration is not offered to Generate Image", () => {
    const offered = getCompatibleNodes("duration", "source", getNodeOptions(), "duration").direct.map((o) => o.type)
    expect(offered).not.toContain("generate-image")
  })

  it("a Duration dropped on Generate Script lands on its Duration input", () => {
    expect(resolveTargetHandle("generate-script", "duration", "source")).toBe("field-targetLength")
  })
})

describe("a Provider wired into Generate Image", () => {
  const image = { id: "i", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "Image", provider: "nano-banana-pro", providers: ["nano-banana-pro", "seedream"] } } as unknown as WorkflowNode
  const provider = { id: "p", type: "provider", position: { x: 0, y: 0 }, data: { label: "Provider", category: "image", provider: "nano-banana" } } as unknown as WorkflowNode
  const edges = [{ id: "e", source: "p", target: "i", targetHandle: SETTINGS_INPUT_HANDLE }] as unknown as WorkflowEdge[]

  // Two models run one image each; a wired Provider makes it one run of its model.
  it("turns a several-model run into one run", () => {
    expect(planFanOut(undefined, "generate-image", image.data as Record<string, unknown>)?.items).toHaveLength(2)
    expect(planFanOut(undefined, "generate-image", withWiredSettings(image, [image, provider], edges).data as Record<string, unknown>)).toBeNull()
  })
})

describe("pricing a node with wired settings", () => {
  const video = { id: "v", type: "generate-video", position: { x: 0, y: 0 }, data: { label: "Video", provider: "seedance-2-fast", duration: 4 } } as unknown as WorkflowNode
  const nodes = [
    video,
    { id: "len", type: "duration", position: { x: 0, y: 0 }, data: { label: "Duration", seconds: 60 } },
    { id: "veo", type: "provider", position: { x: 0, y: 0 }, data: { label: "Provider", category: "video", provider: "veo3" } },
  ] as unknown as WorkflowNode[]
  const edges = [
    { id: "e1", source: "len", target: "v", targetHandle: SETTINGS_INPUT_HANDLE },
    { id: "e2", source: "veo", target: "v", targetHandle: SETTINGS_INPUT_HANDLE },
  ] as unknown as WorkflowEdge[]

  it("prices the wired model at the fitted length, as the run reserves", () => {
    const expected = buildVideoCreditModelIdentifier("veo3", 8, undefined, "image-to-video", undefined, undefined, false)
    expect(getModelIdentifier(video, edges, nodes)).toBe(expected)
  })

  it("prices the node as stored without the graph", () => {
    expect(withWiredSettings(video)).toBe(video)
    expect(getModelIdentifier(video)).toBe(buildVideoCreditModelIdentifier("seedance-2-fast", 4, undefined, "image-to-video", undefined, undefined, false))
  })
})
