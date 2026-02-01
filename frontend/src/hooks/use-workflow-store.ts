import { create } from "zustand"
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react"
import type { WorkflowNode, WorkflowEdge, SceneNodeData, SceneNodeType } from "@/types/nodes"
import { NODE_DEFINITIONS } from "@/types/nodes"

export type SaveStatus = "idle" | "saving" | "saved" | "error"

interface WorkflowState {
  readonly workflowId: string | null
  readonly workflowName: string
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
  readonly selectedNodeId: string | null
  readonly isDirty: boolean
  readonly saveStatus: SaveStatus
  readonly saveError: string | null
  readonly videoAutoplay: boolean

  readonly setWorkflowId: (id: string | null) => void
  readonly setWorkflowName: (name: string) => void
  readonly onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void
  readonly onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void
  readonly onConnect: (connection: Connection) => void
  readonly addNode: (type: SceneNodeType, position: { x: number; y: number }) => void
  readonly updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
  readonly deleteNode: (nodeId: string) => void
  readonly deleteEdge: (edgeId: string) => void
  readonly duplicateNode: (nodeId: string) => void
  readonly selectNode: (nodeId: string | null) => void
  readonly loadWorkflow: (id: string, name: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) => void
  readonly clearWorkflow: () => void
  readonly markClean: () => void
  readonly setSaveStatus: (status: SaveStatus, error?: string | null) => void
  readonly setVideoAutoplay: (autoplay: boolean) => void
  readonly runSingleNode: ((nodeId: string) => void) | null
  readonly setRunSingleNode: (fn: ((nodeId: string) => void) | null) => void
}

let nextNodeId = 1

function generateNodeId(): string {
  const id = `node_${nextNodeId}`
  nextNodeId += 1
  return id
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  workflowId: null,
  workflowName: "Untitled Workflow",
  nodes: [],
  edges: [],
  selectedNodeId: null,
  isDirty: false,
  saveStatus: "idle" as SaveStatus,
  saveError: null,
  videoAutoplay: true,

  setWorkflowId: (id) => set({ workflowId: id }),

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
    set((state) => ({
      edges: addEdge(
        { ...connection, id: `edge_${Date.now()}` },
        state.edges,
      ),
      isDirty: true,
    })),

  addNode: (type, position) => {
    const definition = NODE_DEFINITIONS.find((d) => d.type === type)
    if (!definition) return

    const newNode: WorkflowNode = {
      id: generateNodeId(),
      type,
      position,
      data: { ...definition.defaultData },
    }

    set((state) => ({
      nodes: [...state.nodes, newNode],
      isDirty: true,
    }))
  },

  updateNodeData: (nodeId, data) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } as SceneNodeData }
          : node,
      ),
      isDirty: true,
    })),

  duplicateNode: (nodeId) =>
    set((state) => {
      const source = state.nodes.find((n) => n.id === nodeId)
      if (!source) return state

      const newNode: WorkflowNode = {
        id: generateNodeId(),
        type: source.type,
        position: {
          x: source.position.x + 50,
          y: source.position.y + 50,
        },
        data: { ...source.data } as SceneNodeData,
      }

      return {
        nodes: [...state.nodes, newNode],
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

  loadWorkflow: (id, name, nodes, edges) => {
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
    })
  },

  markClean: () => set({ isDirty: false }),

  setSaveStatus: (status, error = null) => set({ saveStatus: status, saveError: error }),

  setVideoAutoplay: (autoplay) => set({ videoAutoplay: autoplay }),

  runSingleNode: null,
  setRunSingleNode: (fn) => set({ runSingleNode: fn }),
}))
