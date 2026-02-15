import { create } from "zustand"
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react"
import type { WorkflowNode, WorkflowEdge, SceneNodeData, SceneNodeType, CharacterDefinition, LoopNodeData } from "@/types/nodes"
import { NODE_DEFINITIONS } from "@/types/nodes"

export type SaveStatus = "idle" | "saving" | "saved" | "error"

interface WorkflowState {
  readonly workflowId: string | null
  readonly projectId: string | null
  readonly workflowName: string
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
  readonly selectedNodeId: string | null
  readonly isDirty: boolean
  readonly saveStatus: SaveStatus
  readonly saveError: string | null
  readonly videoAutoplay: boolean
  readonly newNodeIds: Set<string>
  readonly characterDefinitions: CharacterDefinition[]
  readonly userPromptTemplates: Record<string, string>
  readonly flowPromptTemplates: Record<string, string>

  readonly setWorkflowId: (id: string | null) => void
  readonly setProjectId: (id: string | null) => void
  readonly setWorkflowName: (name: string) => void
  readonly onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void
  readonly onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void
  readonly onConnect: (connection: Connection) => void
  readonly addNode: (type: SceneNodeType, position: { x: number; y: number }, initialData?: Record<string, unknown>) => string | undefined
  readonly updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
  readonly deleteNode: (nodeId: string) => void
  readonly deleteEdge: (edgeId: string) => void
  readonly duplicateNode: (nodeId: string) => void
  readonly selectNode: (nodeId: string | null) => void
  readonly setUserPromptTemplates: (templates: Record<string, string>) => void
  readonly setFlowPromptTemplates: (templates: Record<string, string>) => void
  readonly loadWorkflow: (id: string, name: string, nodes: WorkflowNode[], edges: WorkflowEdge[], characterDefinitions?: CharacterDefinition[], flowPromptTemplates?: Record<string, string>) => void
  readonly clearWorkflow: () => void
  readonly markClean: () => void
  readonly setSaveStatus: (status: SaveStatus, error?: string | null) => void
  readonly setVideoAutoplay: (autoplay: boolean) => void
  readonly clearNewNode: (id: string) => void
  readonly runSingleNode: ((nodeId: string) => void) | null
  readonly setRunSingleNode: (fn: ((nodeId: string) => void) | null) => void
  readonly generateSceneImage: ((scriptNodeId: string, sceneIndex: number) => Promise<void>) | null
  readonly setGenerateSceneImage: (fn: ((scriptNodeId: string, sceneIndex: number) => Promise<void>) | null) => void
  readonly addCharacterDefinition: (char: CharacterDefinition) => void
  readonly updateCharacterDefinition: (id: string, updates: Partial<Omit<CharacterDefinition, "id">>) => void
  readonly removeCharacterDefinition: (id: string) => void
  readonly batchAddNodesAndEdges: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void
  readonly expandStoryboard: ((scriptNodeId: string, options: { layout: "horizontal" | "vertical"; autoRun: boolean; includeCombine: boolean; narrationSource?: "visualDescription" | "action" | "imagePrompt"; nodeType?: "pipeline" | "scene" }) => void) | null
  readonly setExpandStoryboard: (fn: ((scriptNodeId: string, options: { layout: "horizontal" | "vertical"; autoRun: boolean; includeCombine: boolean; narrationSource?: "visualDescription" | "action" | "imagePrompt"; nodeType?: "pipeline" | "scene" }) => void) | null) => void
  readonly autoOpenEditorNodeId: string | null
  readonly setAutoOpenEditorNodeId: (id: string | null) => void
  readonly createSceneNodeFromScript: ((scriptNodeId: string, sceneIndex: number) => void) | null
  readonly setCreateSceneNodeFromScript: (fn: ((scriptNodeId: string, sceneIndex: number) => void) | null) => void
  readonly generateCharacterAssetFn: ((nodeId: string, assetType: "expressions" | "poses" | "lighting" | "angles") => Promise<void>) | null
  readonly setGenerateCharacterAssetFn: (fn: ((nodeId: string, assetType: "expressions" | "poses" | "lighting" | "angles") => Promise<void>) | null) => void
  readonly generateObjectAssetFn: ((nodeId: string, assetType: "angles" | "materials" | "variations") => Promise<void>) | null
  readonly setGenerateObjectAssetFn: (fn: ((nodeId: string, assetType: "angles" | "materials" | "variations") => Promise<void>) | null) => void
  readonly generateLocationAssetFn: ((nodeId: string, assetType: "timeOfDay" | "weather" | "angles") => Promise<void>) | null
  readonly setGenerateLocationAssetFn: (fn: ((nodeId: string, assetType: "timeOfDay" | "weather" | "angles") => Promise<void>) | null) => void
  readonly createNodesFromWriter: ((writerNodeId: string) => void) | null
  readonly setCreateNodesFromWriter: (fn: ((writerNodeId: string) => void) | null) => void
  readonly runAllWriterImageNodes: ((writerNodeId: string) => void) | null
  readonly setRunAllWriterImageNodes: (fn: ((writerNodeId: string) => void) | null) => void
}

let nextNodeId = 1

function generateNodeId(): string {
  const id = `node_${nextNodeId}`
  nextNodeId += 1
  return id
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  workflowId: null,
  projectId: null,
  workflowName: "Untitled Workflow",
  nodes: [],
  edges: [],
  selectedNodeId: null,
  isDirty: false,
  saveStatus: "idle" as SaveStatus,
  saveError: null,
  videoAutoplay: true,
  newNodeIds: new Set<string>(),
  characterDefinitions: [],
  userPromptTemplates: {},
  flowPromptTemplates: {},

  setWorkflowId: (id) => set({ workflowId: id }),

  setProjectId: (id) => set({ projectId: id }),

  setWorkflowName: (name) => set({ workflowName: name, isDirty: true }),

  onNodesChange: (changes) =>
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      isDirty: true,
    })),

  onEdgesChange: (changes) =>
    set((state) => {
      const newEdges = applyEdgeChanges(changes, state.edges)
      const removedEdges = changes
        .filter((c): c is EdgeChange<WorkflowEdge> & { type: "remove" } => c.type === "remove")
        .map((c) => state.edges.find((e) => e.id === c.id))
        .filter((e): e is WorkflowEdge => e !== undefined)

      if (removedEdges.length === 0) {
        return { edges: newEdges, isDirty: true }
      }

      const nodes = state.nodes.map((node) => {
        const edgesRemovedFromThisTarget = removedEdges.filter((e) => e.target === node.id)
        if (edgesRemovedFromThisTarget.length === 0) return node

        const nodeData = node.data as Record<string, unknown>
        const fieldMappings = (nodeData.fieldMappings ?? {}) as Record<string, { sourceNodeId: string }>
        if (Object.keys(fieldMappings).length === 0) return node

        const removedSourceIds = new Set(edgesRemovedFromThisTarget.map((e) => e.source))
        const stillConnectedSources = new Set(
          newEdges.filter((e) => e.target === node.id).map((e) => e.source)
        )
        const trulyRemovedSources = [...removedSourceIds].filter((s) => !stillConnectedSources.has(s))
        if (trulyRemovedSources.length === 0) return node

        const trulyRemovedSet = new Set(trulyRemovedSources)
        const cleanedMappings = Object.fromEntries(
          Object.entries(fieldMappings).filter(([, v]) => !trulyRemovedSet.has(v.sourceNodeId))
        )

        return { ...node, data: { ...nodeData, fieldMappings: cleanedMappings } as SceneNodeData }
      })

      return { nodes, edges: newEdges, isDirty: true }
    }),

  onConnect: (connection) =>
    set((state) => {
      const newEdges = addEdge(
        { ...connection, id: `edge_${Date.now()}` },
        state.edges,
      )

      // Auto-create "Prompt" column when connecting to a Loop node with 0 columns
      let newNodes = state.nodes
      if (connection.targetHandle === "in") {
        const targetNode = state.nodes.find((n) => n.id === connection.target)
        if (targetNode?.type === "loop") {
          const loopData = targetNode.data as LoopNodeData
          if (!loopData.columns || loopData.columns.length === 0) {
            newNodes = state.nodes.map((n) =>
              n.id === connection.target
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      columns: [{ id: crypto.randomUUID(), name: "Prompt", handleId: "prompt" }],
                      rows: [[""]],
                    },
                  }
                : n,
            )
          }
        }
      }

      return { nodes: newNodes, edges: newEdges, isDirty: true }
    }),

  addNode: (type, position, initialData) => {
    const definition = NODE_DEFINITIONS.find((d) => d.type === type)
    if (!definition) return undefined

    const id = generateNodeId()
    const newNode: WorkflowNode = {
      id,
      type,
      position,
      data: { ...definition.defaultData, ...initialData },
      // Sticky notes should appear behind other nodes
      ...(type === "sticky-note" ? { zIndex: -1 } : {}),
    }

    set((state) => ({
      nodes: [...state.nodes, newNode],
      newNodeIds: new Set([...state.newNodeIds, id]),
      isDirty: true,
    }))

    return id
  },

  updateNodeData: (nodeId, data) =>
    set((state) => {
      // Only dirty the store when the node actually exists. This prevents
      // stale polling callbacks (from a previously loaded workflow) from
      // falsely marking the current workflow as unsaved.
      if (!state.nodes.some((n) => n.id === nodeId)) return state
      return {
        nodes: state.nodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, ...data } as SceneNodeData }
            : node,
        ),
        isDirty: true,
      }
    }),

  duplicateNode: (nodeId) =>
    set((state) => {
      const source = state.nodes.find((n) => n.id === nodeId)
      if (!source) return state

      // Clone data, but clear characterDbId for character nodes
      // so the duplicate is treated as a new, unpersisted character
      const clonedData = { ...source.data } as SceneNodeData
      if (source.type === "character" && "characterDbId" in clonedData) {
        (clonedData as Record<string, unknown>).characterDbId = ""
      }

      const newNode: WorkflowNode = {
        id: generateNodeId(),
        type: source.type,
        position: {
          x: source.position.x + 50,
          y: source.position.y + 50,
        },
        data: clonedData,
      }

      return {
        nodes: [...state.nodes, newNode],
        newNodeIds: new Set([...state.newNodeIds, newNode.id]),
        selectedNodeId: newNode.id,
        isDirty: true,
      }
    }),

  deleteNode: (nodeId) =>
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId,
      ),
      selectedNodeId:
        state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      isDirty: true,
    })),

  deleteEdge: (edgeId) =>
    set((state) => {
      const removedEdge = state.edges.find((e) => e.id === edgeId)
      const newEdges = state.edges.filter((e) => e.id !== edgeId)

      if (!removedEdge) return { edges: newEdges, isDirty: true }

      const stillConnected = newEdges.some(
        (e) => e.target === removedEdge.target && e.source === removedEdge.source
      )
      if (stillConnected) return { edges: newEdges, isDirty: true }

      const nodes = state.nodes.map((node) => {
        if (node.id !== removedEdge.target) return node
        const nodeData = node.data as Record<string, unknown>
        const fieldMappings = (nodeData.fieldMappings ?? {}) as Record<string, { sourceNodeId: string }>
        if (Object.keys(fieldMappings).length === 0) return node

        const cleanedMappings = Object.fromEntries(
          Object.entries(fieldMappings).filter(([, v]) => v.sourceNodeId !== removedEdge.source)
        )
        return { ...node, data: { ...nodeData, fieldMappings: cleanedMappings } as SceneNodeData }
      })

      return { nodes, edges: newEdges, isDirty: true }
    }),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  setUserPromptTemplates: (templates) => set({ userPromptTemplates: templates }),

  setFlowPromptTemplates: (templates) => set({ flowPromptTemplates: templates, isDirty: true }),

  loadWorkflow: (id, name, nodes, edges, characterDefinitions, flowPromptTemplates) => {
    nextNodeId =
      nodes.reduce((max, n) => {
        const num = parseInt(n.id.replace("node_", ""), 10)
        return isNaN(num) ? max : Math.max(max, num)
      }, 0) + 1

    set({
      workflowId: id,
      workflowName: name,
      nodes,
      edges,
      selectedNodeId: null,
      isDirty: false,
      saveStatus: "idle" as SaveStatus,
      saveError: null,
      characterDefinitions: characterDefinitions ?? [],
      flowPromptTemplates: flowPromptTemplates ?? {},
    })
  },

  clearWorkflow: () => {
    nextNodeId = 1
    set({
      workflowId: null,
      workflowName: "Untitled Workflow",
      nodes: [],
      edges: [],
      selectedNodeId: null,
      isDirty: false,
      saveStatus: "idle" as SaveStatus,
      saveError: null,
      characterDefinitions: [],
      flowPromptTemplates: {},
    })
  },

  markClean: () => set({ isDirty: false }),

  setSaveStatus: (status, error = null) => set({ saveStatus: status, saveError: error }),

  setVideoAutoplay: (autoplay) => set({ videoAutoplay: autoplay }),

  clearNewNode: (id) =>
    set((state) => {
      const next = new Set(state.newNodeIds)
      next.delete(id)
      return { newNodeIds: next }
    }),

  runSingleNode: null,
  setRunSingleNode: (fn) => set({ runSingleNode: fn }),
  generateSceneImage: null,
  setGenerateSceneImage: (fn) => set({ generateSceneImage: fn }),

  addCharacterDefinition: (char) =>
    set((state) => ({
      characterDefinitions: [...state.characterDefinitions, char],
      isDirty: true,
    })),

  updateCharacterDefinition: (id, updates) =>
    set((state) => ({
      characterDefinitions: state.characterDefinitions.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
      isDirty: true,
    })),

  removeCharacterDefinition: (id) =>
    set((state) => ({
      characterDefinitions: state.characterDefinitions.filter((c) => c.id !== id),
      isDirty: true,
    })),

  batchAddNodesAndEdges: (newNodes, newEdges) => {
    // Update nextNodeId to avoid collisions
    for (const n of newNodes) {
      const num = parseInt(n.id.replace("node_", ""), 10)
      if (!isNaN(num) && num >= nextNodeId) {
        nextNodeId = num + 1
      }
    }
    set((state) => ({
      nodes: [...state.nodes, ...newNodes],
      edges: [...state.edges, ...newEdges],
      newNodeIds: new Set([...state.newNodeIds, ...newNodes.map((n) => n.id)]),
      isDirty: true,
    }))
  },

  expandStoryboard: null,
  setExpandStoryboard: (fn) => set({ expandStoryboard: fn }),
  autoOpenEditorNodeId: null,
  setAutoOpenEditorNodeId: (id) => set({ autoOpenEditorNodeId: id }),
  createSceneNodeFromScript: null,
  setCreateSceneNodeFromScript: (fn) => set({ createSceneNodeFromScript: fn }),
  generateCharacterAssetFn: null,
  setGenerateCharacterAssetFn: (fn) => set({ generateCharacterAssetFn: fn }),
  generateObjectAssetFn: null,
  setGenerateObjectAssetFn: (fn) => set({ generateObjectAssetFn: fn }),
  generateLocationAssetFn: null,
  setGenerateLocationAssetFn: (fn) => set({ generateLocationAssetFn: fn }),
  createNodesFromWriter: null,
  setCreateNodesFromWriter: (fn) => set({ createNodesFromWriter: fn }),
  runAllWriterImageNodes: null,
  setRunAllWriterImageNodes: (fn) => set({ runAllWriterImageNodes: fn }),
}))
