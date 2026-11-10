// @test-watches frontend/src/nodes/**
// (It reads no file: it holds every node type's default data, units included, to the rule.)
/**
 * The store applies "a new node starts on a model the deployment offers"
 * (`components/editor/config-panels/new-node-models.ts`) wherever it makes a
 * node from its default data — and nowhere else: a copy keeps the source's
 * model, a saved node keeps its own.
 * A node made before the availability answer lands is judged again, once, when
 * it does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react")
  return actual
})
vi.mock("@/lib/parameter-node-prefs", () => ({
  getStickyParameterDisplayMode: vi.fn(() => "picks"),
  setStickyParameterDisplayMode: vi.fn(),
  getStickyLookPreviewStyle: vi.fn(() => undefined),
  setStickyLookPreviewStyle: vi.fn(),
}))
vi.mock("@/components/editor/workflow-editor/auto-execute", () => ({
  autoExecuteNode: vi.fn(),
  cascadeAutoExecute: vi.fn(),
}))

import { buildDuplicatedNodeData, newNodeDefaultData, useWorkflowStore } from "../use-workflow-store"
import { addNodeOrMacro } from "../use-canvas-macro"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { curatedNodeDefaults } from "@/lib/curated-node-defaults"
import { MODIFY_IMAGE_MODELS } from "@/components/editor/config-panels/model-options"
import { NODE_DEFINITIONS, type SceneNodeType, type WorkflowNode } from "@/types/nodes"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { LLM_MODELS } from "@nodaro/shared/llm-models"

const initialState = useWorkflowStore.getState()
const st = () => useWorkflowStore.getState()
const FLARE = "gpt-image-2-6-flare-i2i"
const FIRST_OFFERED = MODIFY_IMAGE_MODELS[0]!.value
const providerOf = (id: string | undefined) => (st().nodes.find((n) => n.id === id)?.data as { provider?: string } | undefined)?.provider

beforeEach(() => {
  useWorkflowStore.setState(initialState, true)
  st().loadWorkflow("wf-1", "W", [], [])
})
afterEach(() => __resetSurfaceAvailabilityForTests(null))

describe("every way the editor makes a node from its defaults", () => {
  beforeEach(() => __resetSurfaceAvailabilityForTests({ nodes: [], models: [FLARE], modelsRestricted: true }))

  it("addNode (the popup, the sidebar, a shortcut, the Connect dialog)", () => {
    expect(providerOf(st().addNode("modify-image", { x: 0, y: 0 }))).toBe(FIRST_OFFERED)
  })

  it("addNodeAndOpenPicker (the handle popover and the popup)", () => {
    expect(providerOf(st().addNodeAndOpenPicker("modify-image", { x: 0, y: 0 }))).toBe(FIRST_OFFERED)
  })

  it("addNodeOrMacro", () => {
    expect(providerOf(addNodeOrMacro("modify-image", { x: 0, y: 0 }))).toBe(FIRST_OFFERED)
  })

  it("newNodeDefaultData, which the macros, render swaps and the add-a-step actions read", () => {
    expect(newNodeDefaultData("modify-image")?.provider).toBe(FIRST_OFFERED)
  })

  it("a model the caller passes is its own choice and stays", () => {
    expect(providerOf(st().addNode("modify-image", { x: 0, y: 0 }, { provider: "nano-banana-edit" }))).toBe("nano-banana-edit")
  })
})

describe("what keeps the model it has", () => {
  const saved = (): WorkflowNode => ({ id: "node_1", type: "modify-image", position: { x: 0, y: 0 }, data: { label: "Modify Image", provider: FLARE } } as unknown as WorkflowNode)

  beforeEach(() => __resetSurfaceAvailabilityForTests({ nodes: [], models: [FLARE], modelsRestricted: true }))

  it("a saved node keeps its stored model (still shown, refused at run)", () => {
    st().loadWorkflow("wf-2", "W", [saved()], [])
    expect(providerOf("node_1")).toBe(FLARE)
  })

  it("a duplicate and a paste keep the source's model", () => {
    st().loadWorkflow("wf-2", "W", [saved()], [])
    st().duplicateNode("node_1")
    const copy = st().nodes.find((n) => n.id !== "node_1")
    expect((copy?.data as { provider?: string }).provider).toBe(FLARE)
    expect((buildDuplicatedNodeData(saved()) as { provider?: string }).provider).toBe(FLARE)
  })
})

describe("byte-identical where models are not restricted", () => {
  const everyModel = [...Object.keys(MODEL_CATALOG), ...LLM_MODELS.map((m) => m.id)]

  it("every node type starts on exactly its curated defaults, whatever is switched off", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: everyModel, modelsRestricted: false })
    for (const def of NODE_DEFINITIONS) {
      const factory = { ...(def.defaultData as Record<string, unknown>) }
      expect(newNodeDefaultData(def.type as SceneNodeType), def.type).toEqual({ ...curatedNodeDefaults(def.type, factory) })
    }
  })
})

describe("a node made before the availability answer lands", () => {
  beforeEach(() => __resetSurfaceAvailabilityForTests(null))

  it("is judged again once, when the answer lands", () => {
    const id = st().addNode("modify-image", { x: 0, y: 0 })
    expect(providerOf(id)).toBe(FLARE)
    useWorkflowStore.setState({ isDirty: false })

    __resetSurfaceAvailabilityForTests({ nodes: [], models: [FLARE], modelsRestricted: true })
    expect(providerOf(id)).toBe(FIRST_OFFERED)
    expect(st().isDirty).toBe(true)

    // Once: a later change of the answer moves nothing.
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [FLARE, FIRST_OFFERED], modelsRestricted: true })
    expect(providerOf(id)).toBe(FIRST_OFFERED)
  })

  it("keeps a model the user picked in the meantime", () => {
    const id = st().addNode("modify-image", { x: 0, y: 0 })!
    st().updateNodeData(id, { provider: "nano-banana-edit" })
    // Withheld too, but picked by the user rather than given by the defaults: it stays.
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [FLARE, "nano-banana-edit"], modelsRestricted: true })
    expect(providerOf(id)).toBe("nano-banana-edit")
  })

  it("leaves everything as it is when the deployment turns out not to restrict models", () => {
    const id = st().addNode("modify-image", { x: 0, y: 0 })
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [FLARE], modelsRestricted: false })
    expect(providerOf(id)).toBe(FLARE)
  })

  it("never touches a node of another workflow loaded since", () => {
    st().addNode("modify-image", { x: 0, y: 0 })
    const other = { id: "node_1", type: "modify-image", position: { x: 0, y: 0 }, data: { label: "Modify Image", provider: FLARE } } as unknown as WorkflowNode
    st().loadWorkflow("wf-3", "Other", [other], [])
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [FLARE], modelsRestricted: true })
    expect(providerOf("node_1")).toBe(FLARE)
  })
})
