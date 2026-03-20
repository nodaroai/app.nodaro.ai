import { create } from "zustand"
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react"
import type { WorkflowNode, WorkflowEdge, SceneNodeData, SceneNodeType, CharacterDefinition, LoopNodeData, PreviewItem, PreviewNodeData, TeleportSendData, TeleportReceiveData } from "@/types/nodes"
import { NODE_DEFINITIONS, TELEPORTER_CHANNEL_COLORS } from "@/types/nodes"
import type { WorkflowSnapshot } from "./use-undo-redo-store"
import { setSkipUndoCapture } from "./undo-flags"
import { filterCloneNodes } from "@nodaro-shared/clone-utils"

/**
 * Fields that are purely execution-related (job status, progress, results).
 * When an `updateNodeData` call only touches these keys, the undo system
 * will NOT capture a snapshot — preventing job polling from polluting the
 * undo history and clearing the redo stack.
 */
const EXECUTION_DATA_KEYS = new Set([
  "executionStatus",
  "currentJobId",
  "currentJobProgress",
  "errorMessage",
  "isStreaming",
  "generatedImageUrl",
  "generatedVideoUrl",
  "generatedAudioUrl",
  "generatedText",
  "generatedScript",
  "generatedItems",
  "generatedResults",
  "activeResultIndex",
  "sourceImageUrl",
  "__listTotal",
  "__listCompleted",
  "__listResults",
  "subWorkflowProgress",
  "outputResults",
  "shots",
  "result",
])

/**
 * Simplified output extraction for preview auto-populate (avoids circular import
 * with execution-graph.ts). Returns null if the node has no results yet.
 */
function getNodeOutputForPreview(node: WorkflowNode): { type: PreviewItem["type"]; value: string } | null {
  const d = node.data as Record<string, unknown>
  const t = node.type ?? ""

  // Text source nodes
  if (t === "text-prompt") {
    const v = (d.text as string)?.trim()
    return v ? { type: "text", value: v } : null
  }

  // Text output nodes
  if (t === "suno-lyrics" || t === "suno-style-boost" || t === "ai-writer" || t === "generate-script") {
    const v = (d.generatedText as string)?.trim()
    return v ? { type: "text", value: v } : null
  }

  // Upload nodes
  if (t === "upload-image") {
    const v = ((d.r2Url || d.url || d.externalUrl) as string)?.trim()
    return v ? { type: "image", value: v } : null
  }
  if (t === "upload-video") {
    const v = ((d.r2Url || d.url || d.externalUrl) as string)?.trim()
    return v ? { type: "video", value: v } : null
  }
  if (t === "upload-audio") {
    const v = ((d.r2Url || d.url || d.externalUrl) as string)?.trim()
    return v ? { type: "audio", value: v } : null
  }

  // Nodes with generatedResults array
  const results = d.generatedResults as Array<{ url?: string; text?: string }> | undefined
  const idx = (d.activeResultIndex as number) ?? 0
  const result = results?.[idx]
  if (result?.url) {
    const url = result.url.trim()
    if (/\.(png|jpe?g|gif|webp|svg|bmp)/i.test(url)) return { type: "image", value: url }
    if (/\.(mp4|mov|webm)/i.test(url)) return { type: "video", value: url }
    if (/\.(mp3|wav|ogg|aac|flac|m4a)/i.test(url)) return { type: "audio", value: url }
    // Infer from node type
    if (t.includes("image") || t === "character" || t === "face" || t === "object" || t === "location") return { type: "image", value: url }
    if (t.includes("video")) return { type: "video", value: url }
    if (t.includes("audio") || t.includes("speech") || t.includes("music") || t.includes("suno")) return { type: "audio", value: url }
    return { type: "image", value: url }
  }

  // Fallback URL fields
  const imgUrl = (d.generatedImageUrl as string)?.trim()
  if (imgUrl) return { type: "image", value: imgUrl }
  const vidUrl = (d.generatedVideoUrl as string)?.trim()
  if (vidUrl) return { type: "video", value: vidUrl }
  const audUrl = (d.generatedAudioUrl as string)?.trim()
  if (audUrl) return { type: "audio", value: audUrl }

  return null
}

export type SaveStatus = "idle" | "saving" | "saved" | "error"

export type PresentationViewMode = "horizontal" | "vertical" | "gallery" | "fullscreen" | "compare"

export interface PresentationSettings {
  runTarget: "workflow" | "sub-workflow" | "route"
  subWorkflowNodeId?: string
  selectedRouteId?: string
  splitRatio?: number // 20-80, default 50
  inputOrder?: string[] // node IDs in display order
  outputOrder?: string[] // node IDs in display order
  cardMeta?: Record<string, { title?: string; description?: string }>
  viewMode?: PresentationViewMode // defaults to "horizontal"
  compareLeft?: string // node ID for left compare item
  compareRight?: string // node ID for right compare item
  shareReadOnly?: boolean // default false — pure viewing, no inputs/run
  shareAllowedModes?: PresentationViewMode[] // default all 5 — subset viewer can use
  shareDefaultMode?: PresentationViewMode // default "horizontal" — initial mode for viewer
  outputDisplayModes?: Record<string, "gallery" | "individual"> // per-output-node display mode, default "individual"
}

export const DEFAULT_PRESENTATION_SETTINGS: PresentationSettings = { runTarget: "workflow" }

interface WorkflowState {
  readonly workflowId: string | null
  readonly projectId: string | null
  readonly workflowName: string
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
  readonly selectedNodeId: string | null
  readonly isDirty: boolean
  readonly loadGeneration: number
  readonly saveStatus: SaveStatus
  readonly saveError: string | null
  readonly videoAutoplay: boolean
  readonly newNodeIds: Set<string>
  readonly characterDefinitions: CharacterDefinition[]
  readonly userPromptTemplates: Record<string, string>
  readonly flowPromptTemplates: Record<string, string>
  readonly presentationSettings: PresentationSettings

  readonly setWorkflowId: (id: string | null) => void
  readonly setProjectId: (id: string | null) => void
  readonly setWorkflowName: (name: string) => void
  readonly onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void
  readonly onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void
  readonly onConnect: (connection: Connection) => void
  readonly addNode: (type: SceneNodeType, position: { x: number; y: number }, initialData?: Record<string, unknown>) => string | undefined
  readonly updateNode: (nodeId: string, updates: Partial<WorkflowNode>) => void
  readonly updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
  readonly deleteNode: (nodeId: string) => void
  readonly deleteEdge: (edgeId: string) => void
  readonly updateEdgeData: (edgeId: string, data: Record<string, unknown>) => void
  readonly duplicateNode: (nodeId: string) => void
  readonly selectNode: (nodeId: string | null) => void
  readonly setUserPromptTemplates: (templates: Record<string, string>) => void
  readonly setFlowPromptTemplates: (templates: Record<string, string>) => void
  readonly loadWorkflow: (id: string, name: string, nodes: WorkflowNode[], edges: WorkflowEdge[], characterDefinitions?: CharacterDefinition[], flowPromptTemplates?: Record<string, string>, presentationSettings?: PresentationSettings) => void
  readonly clearWorkflow: () => void
  readonly markClean: () => void
  readonly setSaveStatus: (status: SaveStatus, error?: string | null) => void
  readonly setVideoAutoplay: (autoplay: boolean) => void
  readonly clearNewNode: (id: string) => void
  readonly runSingleNode: ((nodeId: string) => void) | null
  readonly setRunSingleNode: (fn: ((nodeId: string) => void) | null) => void
  readonly runFromHere: ((nodeId: string) => void) | null
  readonly setRunFromHere: (fn: ((nodeId: string) => void) | null) => void
  readonly runSelected: (() => void) | null
  readonly setRunSelected: (fn: (() => void) | null) => void
  readonly generateSceneImage: ((scriptNodeId: string, sceneIndex: number) => Promise<void>) | null
  readonly setGenerateSceneImage: (fn: ((scriptNodeId: string, sceneIndex: number) => Promise<void>) | null) => void
  readonly addCharacterDefinition: (char: CharacterDefinition) => void
  readonly updateCharacterDefinition: (id: string, updates: Partial<Omit<CharacterDefinition, "id">>) => void
  readonly removeCharacterDefinition: (id: string) => void
  readonly toggleSkipNode: (nodeId: string) => void
  readonly skipSelectedNodes: (nodeIds: string[]) => void
  readonly unskipSelectedNodes: (nodeIds: string[]) => void
  readonly restoreSnapshot: (snapshot: WorkflowSnapshot) => void
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
  readonly setWorkflowThumbnail: (url: string) => void
  readonly updatePresentationSettings: (settings: Partial<PresentationSettings>) => void
  readonly syncTeleporterEdges: (channel: string) => void
  readonly replaceEdgeWithTeleporter: (edgeId: string) => void
}

function getNextChannel(nodes: WorkflowNode[]): { channel: string; channelColor: string } {
  const usedChannels = new Set(
    nodes
      .filter((n) => n.type === "teleport-send")
      .map((n) => (n.data as Record<string, unknown>).channel as string)
  )
  for (let i = 0; i < 702; i++) {
    const letter = i < 26
      ? String.fromCharCode(65 + i)
      : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26))
    if (!usedChannels.has(letter)) {
      const colorIndex = i % TELEPORTER_CHANNEL_COLORS.length
      return { channel: letter, channelColor: TELEPORTER_CHANNEL_COLORS[colorIndex] }
    }
  }
  return { channel: "A", channelColor: TELEPORTER_CHANNEL_COLORS[0] }
}

let nextNodeId = 1

function generateNodeId(): string {
  const id = `node_${nextNodeId}`
  nextNodeId += 1
  return id
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflowId: null,
  projectId: null,
  workflowName: "Untitled Workflow",
  nodes: [],
  edges: [],
  selectedNodeId: null,
  isDirty: false,
  loadGeneration: 0,
  saveStatus: "idle" as SaveStatus,
  saveError: null,
  videoAutoplay: typeof window !== "undefined" && typeof localStorage !== "undefined" && typeof localStorage.getItem === "function" && localStorage.getItem("videoAutoplay") !== null
    ? localStorage.getItem("videoAutoplay") === "true"
    : true,
  newNodeIds: new Set<string>(),
  characterDefinitions: [],
  userPromptTemplates: {},
  flowPromptTemplates: {},
  presentationSettings: DEFAULT_PRESENTATION_SETTINGS,

  setWorkflowId: (id) => set({ workflowId: id }),

  setProjectId: (id) => set({ projectId: id }),

  setWorkflowName: (name) => set({ workflowName: name, isDirty: true }),

  onNodesChange: (changes) =>
    set((state) => {
      let newNodes = applyNodeChanges(changes, state.nodes)
      // Only mark dirty for content changes (position, add, remove, replace)
      // NOT for selection or dimension measurements from React Flow
      // Single pass: detect content changes and collect selection info
      let hasContentChange = false
      let hasSelectionChange = false
      let lastSelectedId: string | null = null
      for (const c of changes) {
        if (c.type === "select") {
          hasSelectionChange = true
          if (c.selected) lastSelectedId = c.id
        } else if (c.type !== "dimensions") {
          hasContentChange = true
        }
      }

      // Don't sync selectedNodeId from React Flow selection events here.
      // Only explicit selectNode() calls (from handleNodeClick with drag guard)
      // should open the config panel. This prevents drag-start from opening settings.
      // However, if the currently selected node was deselected (e.g. removed), clear it.
      let selectedNodeId = state.selectedNodeId
      if (hasSelectionChange && selectedNodeId) {
        const stillExists = newNodes.find((n) => n.id === selectedNodeId)
        if (!stillExists) {
          selectedNodeId = null
        } else {
          // Enforce our selectedNodeId as the only selected node.
          // React Flow's internal focus may try to re-select a previously
          // clicked node, overriding programmatic selection (e.g. arrow nav).
          const wrongSelection = newNodes.some((n) =>
            (n.id === selectedNodeId && !n.selected) || (n.id !== selectedNodeId && n.selected)
          )
          if (wrongSelection) {
            newNodes = newNodes.map((n) => ({
              ...n,
              selected: n.id === selectedNodeId,
            }))
          }
        }
      }

      return {
        nodes: newNodes,
        ...(hasContentChange ? { isDirty: true } : {}),
        ...(selectedNodeId !== state.selectedNodeId ? { selectedNodeId } : {}),
      }
    }),

  onEdgesChange: (changes) =>
    set((state) => {
      const newEdges = applyEdgeChanges(changes, state.edges)
      // Only mark dirty for content changes, not selection
      const hasContentChange = changes.some((c) => c.type !== "select")
      const removedEdges = changes
        .filter((c): c is EdgeChange<WorkflowEdge> & { type: "remove" } => c.type === "remove")
        .map((c) => state.edges.find((e) => e.id === c.id))
        .filter((e): e is WorkflowEdge => e !== undefined)

      if (removedEdges.length === 0) {
        return { edges: newEdges, ...(hasContentChange ? { isDirty: true } : {}) }
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
                      columns: [{ id: crypto.randomUUID(), name: "Prompt", handleId: "prompt", type: "text" as const }],
                      rows: [[""]],
                    },
                  }
                : n,
            )
          }
        }
      }

      // Auto-populate Preview node when connecting to a source that already has results
      const previewTarget = newNodes.find((n) => n.id === connection.target && n.type === "preview")
      if (previewTarget) {
        const allIncoming = newEdges.filter((e) => e.target === previewTarget.id)
        const items: PreviewItem[] = []
        for (const edge of allIncoming) {
          const src = newNodes.find((n) => n.id === edge.source)
          if (!src) continue
          const output = getNodeOutputForPreview(src)
          if (!output) continue
          items.push({
            type: output.type,
            value: output.value,
            sourceNodeId: src.id,
            sourceNodeLabel: (src.data as Record<string, unknown>).label as string || src.type || "",
            visible: true,
          })
        }
        if (items.length > 0) {
          const prevData = previewTarget.data as PreviewNodeData
          const prevItems = prevData.previewItems ?? []
          // Merge: keep existing items, add/update from fresh data
          const merged = new Map(prevItems.map((it) => [it.sourceNodeId, it]))
          for (const item of items) merged.set(item.sourceNodeId, item)
          newNodes = newNodes.map((n) =>
            n.id === previewTarget.id
              ? { ...n, data: { ...n.data, previewItems: [...merged.values()], executionStatus: "completed" } }
              : n,
          )
        }
      }

      return { nodes: newNodes, edges: newEdges, isDirty: true }
    }),

  addNode: (type, position, initialData) => {
    const definition = NODE_DEFINITIONS.find((d) => d.type === type)
    if (!definition) return undefined

    const id = generateNodeId()
    const nodeData = { ...definition.defaultData, ...initialData }

    // Generate fresh UUIDs for sub-workflow port IDs and routeIds
    if (type === "sub-workflow-input" || type === "sub-workflow-output") {
      const d = nodeData as Record<string, unknown>
      if (!d.routeId && type === "sub-workflow-input") d.routeId = crypto.randomUUID()
      const ports = d.ports as Array<{ id: string; name: string; mediaType: string }> | undefined
      if (ports) {
        d.ports = ports.map((p) => ({ ...p, id: p.id || crypto.randomUUID() }))
        if (type === "sub-workflow-output" && !d.visibleOutputPortId && (d.ports as unknown[]).length > 0) {
          d.visibleOutputPortId = (d.ports as Array<{ id: string }>)[0].id
        }
      }
    }

    // Generate fresh UUIDs for router route IDs
    if (type === "router") {
      const d = nodeData as Record<string, unknown>
      const routes = d.routes as Array<{ id: string; name: string; active: boolean }> | undefined
      if (routes) {
        d.routes = routes.map((r) => ({ ...r, id: crypto.randomUUID() }))
      }
    }

    const newNode: WorkflowNode = {
      id,
      type,
      position,
      data: nodeData,
      ...(definition.width ? { width: definition.width } : {}),
      ...(definition.height ? { height: definition.height } : {}),
      // Sticky notes should appear behind other nodes
      ...(type === "sticky-note" ? { zIndex: -1 } : {}),
    }

    if (type === "teleport-send") {
      const { channel, channelColor } = getNextChannel(get().nodes)
      newNode.data = { ...newNode.data, channel, channelColor, label: `Send ${channel}` }
    }
    if (type === "teleport-receive") {
      const { channel, channelColor } = getNextChannel(get().nodes)
      newNode.data = { ...newNode.data, channel, channelColor, label: `Recv ${channel}` }
    }

    set((state) => ({
      nodes: [...state.nodes, newNode],
      newNodeIds: new Set([...state.newNodeIds, id]),
      isDirty: true,
    }))

    return id
  },

  updateNode: (nodeId, updates) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...updates } : node,
      ),
    })),

  updateNodeData: (nodeId, data) => {
    // If every key in the update is execution-related, tell the undo system
    // to skip snapshot capture so job polling doesn't pollute undo history.
    const isExecOnly = Object.keys(data).every((k) => EXECUTION_DATA_KEYS.has(k))
    if (isExecOnly) setSkipUndoCapture(true)
    set((state) => {
      // Detect label rename for {Node Label} ref sync
      let oldRef: string | undefined
      let newRef: string | undefined
      if (typeof data.label === "string") {
        const existing = state.nodes.find((n) => n.id === nodeId)
        if (!existing) return state // node doesn't exist — stale callback
        const prev = (existing.data as Record<string, unknown>).label as string | undefined
        if (prev && prev !== data.label) {
          oldRef = `{${prev}}`
          newRef = `{${data.label}}`
        }
      } else if (!state.nodes.some((n) => n.id === nodeId)) {
        return state // stale polling callback — node not in current workflow
      }

      // Single pass: update target node + propagate label renames
      const REF_TEXT_FIELDS = ["text", "prompt", "directText", "motionPrompt", "lyrics", "description", "transcript"] as const
      const nodes = state.nodes.map((node) => {
        if (node.id === nodeId) {
          return { ...node, data: { ...node.data, ...data } as SceneNodeData }
        }
        if (!oldRef || !newRef) return node
        const d = node.data as Record<string, unknown>
        let changed = false
        const patch: Record<string, unknown> = {}
        for (const field of REF_TEXT_FIELDS) {
          const val = d[field]
          if (typeof val === "string" && val.includes(oldRef)) {
            patch[field] = val.replaceAll(oldRef, newRef)
            changed = true
          }
        }
        if (!changed) return node
        return { ...node, data: { ...d, ...patch } as SceneNodeData }
      })

      return { nodes, isDirty: true }
    })
    if (isExecOnly) setSkipUndoCapture(false)
  },

  duplicateNode: (nodeId) =>
    set((state) => {
      const source = state.nodes.find((n) => n.id === nodeId)
      if (!source) return state

      // Clone data, stripping execution process state so the duplicate starts idle
      // but keeping generated results (images, videos, text, etc.) intact
      const clonedData = { ...source.data } as SceneNodeData
      const d = clonedData as Record<string, unknown>
      delete d.executionStatus
      delete d.currentJobId
      delete d.currentJobProgress
      delete d.errorMessage
      delete d.isStreaming
      delete d.__listTotal
      delete d.__listCompleted
      delete d.__listResults
      delete d.subWorkflowProgress
      if (source.type === "character" && "characterDbId" in clonedData) {
        (clonedData as Record<string, unknown>).characterDbId = ""
      }

      // Generate fresh UUIDs for sub-workflow port IDs and routeIds
      if (source.type === "sub-workflow-input" || source.type === "sub-workflow-output") {
        if (source.type === "sub-workflow-input") d.routeId = crypto.randomUUID()
        const ports = d.ports as Array<{ id: string; name: string; mediaType: string }> | undefined
        if (ports) {
          d.ports = ports.map((p) => ({ ...p, id: crypto.randomUUID() }))
          if (source.type === "sub-workflow-output" && (d.ports as unknown[]).length > 0) {
            d.visibleOutputPortId = (d.ports as Array<{ id: string }>)[0].id
          }
        }
        // Clear paired routeId on output so user must re-pair
        if (source.type === "sub-workflow-output") d.routeId = ""
      }

      // Generate fresh UUIDs for router route IDs
      if (source.type === "router") {
        const routes = d.routes as Array<{ id: string; name: string; active: boolean }> | undefined
        if (routes) {
          d.routes = routes.map((r) => ({ ...r, id: crypto.randomUUID() }))
        }
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

  updateEdgeData: (edgeId, data) =>
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === edgeId ? { ...e, data: { ...e.data, ...data } } : e
      ),
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

  selectNode: (nodeId) =>
    set((state) => {
      if (nodeId === null) {
        // Deselect all
        const anySelected = state.nodes.some((n) => n.selected)
        return {
          selectedNodeId: null,
          ...(anySelected ? { nodes: state.nodes.map((n) => n.selected ? { ...n, selected: false } : n) } : {}),
        }
      }

      const target = state.nodes.find((n) => n.id === nodeId)
      if (target?.selected) {
        // React Flow already handled selection — just sync selectedNodeId
        return { selectedNodeId: nodeId }
      }

      // Target not yet selected (e.g. stopPropagation prevented React Flow) — select it, deselect others
      return {
        selectedNodeId: nodeId,
        nodes: state.nodes.map((n) => ({
          ...n,
          selected: n.id === nodeId,
        })),
      }
    }),

  setUserPromptTemplates: (templates) => set({ userPromptTemplates: templates }),

  setFlowPromptTemplates: (templates) => set({ flowPromptTemplates: templates, isDirty: true }),

  loadWorkflow: (id, name, nodes, edges, characterDefinitions, flowPromptTemplates, presentationSettings) => {
    nextNodeId =
      nodes.reduce((max, n) => {
        const num = parseInt(n.id.replace("node_", ""), 10)
        return isNaN(num) ? max : Math.max(max, num)
      }, 0) + 1

    // Clean up stale loop expansion artifacts and strip explicit height.
    const cleaned = filterCloneNodes(nodes, edges)
    const cleanedNodes = cleaned.nodes.map((n) => {
      // Strip explicit height so nodes auto-size to content
      // (Sticky notes use data.height, not the node prop, so they're unaffected.)
      if (n.height != null) {
        const { height: _, ...rest } = n
        return rest as typeof n
      }
      return n
    })
    // Also drop edges referencing nodes that no longer exist
    const cleanedNodeIds = new Set(cleanedNodes.map((n) => n.id))
    const cleanedEdges = cleaned.edges.filter((e) => cleanedNodeIds.has(e.source) && cleanedNodeIds.has(e.target))

    set((state) => ({
      workflowId: id,
      workflowName: name,
      nodes: cleanedNodes,
      edges: cleanedEdges,
      selectedNodeId: null,
      isDirty: false,
      loadGeneration: state.loadGeneration + 1,
      saveStatus: "idle" as SaveStatus,
      saveError: null,
      characterDefinitions: characterDefinitions ?? [],
      flowPromptTemplates: flowPromptTemplates ?? {},
      presentationSettings: presentationSettings ?? DEFAULT_PRESENTATION_SETTINGS,
    }))
  },

  clearWorkflow: () => {
    nextNodeId = 1
    set((state) => ({
      workflowId: null,
      workflowName: "Untitled Workflow",
      nodes: [],
      edges: [],
      selectedNodeId: null,
      isDirty: false,
      loadGeneration: state.loadGeneration + 1,
      saveStatus: "idle" as SaveStatus,
      saveError: null,
      characterDefinitions: [],
      flowPromptTemplates: {},
      presentationSettings: DEFAULT_PRESENTATION_SETTINGS,
    }))
  },

  markClean: () => set({ isDirty: false }),

  setSaveStatus: (status, error = null) => set({ saveStatus: status, saveError: error }),

  setVideoAutoplay: (autoplay) => {
    if (typeof window !== "undefined") localStorage.setItem("videoAutoplay", String(autoplay))
    set({ videoAutoplay: autoplay })
  },

  clearNewNode: (id) =>
    set((state) => {
      const next = new Set(state.newNodeIds)
      next.delete(id)
      return { newNodeIds: next }
    }),

  runSingleNode: null,
  setRunSingleNode: (fn) => set({ runSingleNode: fn }),
  runFromHere: null,
  setRunFromHere: (fn) => set({ runFromHere: fn }),
  runSelected: null,
  setRunSelected: (fn) => set({ runSelected: fn }),
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

  toggleSkipNode: (nodeId) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, skipped: !(node.data as Record<string, unknown>).skipped } as SceneNodeData }
          : node,
      ),
      isDirty: true,
    })),

  skipSelectedNodes: (nodeIds) =>
    set((state) => {
      const idSet = new Set(nodeIds)
      return {
        nodes: state.nodes.map((node) =>
          idSet.has(node.id)
            ? { ...node, data: { ...node.data, skipped: true } as SceneNodeData }
            : node,
        ),
        isDirty: true,
      }
    }),

  unskipSelectedNodes: (nodeIds) =>
    set((state) => {
      const idSet = new Set(nodeIds)
      return {
        nodes: state.nodes.map((node) =>
          idSet.has(node.id)
            ? { ...node, data: { ...node.data, skipped: false } as SceneNodeData }
            : node,
        ),
        isDirty: true,
      }
    }),

  restoreSnapshot: (snapshot) => {
    // Ensure nextNodeId never goes backwards
    const maxId = snapshot.nodes.reduce((max, n) => {
      const num = parseInt(n.id.replace("node_", ""), 10)
      return isNaN(num) ? max : Math.max(max, num)
    }, 0)
    if (maxId >= nextNodeId) {
      nextNodeId = maxId + 1
    }
    set({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      characterDefinitions: snapshot.characterDefinitions,
      flowPromptTemplates: snapshot.flowPromptTemplates,
      workflowName: snapshot.workflowName,
      isDirty: true,
    })
  },

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

  setWorkflowThumbnail: (url) => {
    const { workflowId } = useWorkflowStore.getState()
    if (!workflowId) return

    // Update DB directly (thumbnail is independent of main workflow save)
    import("@/lib/supabase").then(({ createClient }) => {
      const supabase = createClient()
      supabase
        .from("workflows")
        .update({ thumbnail_url: url })
        .eq("id", workflowId)
        .then(({ error }) => {
          if (error) return
          // Also update the projects store so the card shows the thumbnail immediately
          import("@/hooks/use-projects-store").then(({ useProjectsStore }) => {
            useProjectsStore.setState((s) => ({
              workflowMetas: s.workflowMetas.map((w) =>
                w.id === workflowId ? { ...w, thumbnailUrl: url } : w,
              ),
            }))
          })
          import("sonner").then(({ toast }) => toast.success("Thumbnail set"))
        })
    })
  },

  updatePresentationSettings: (settings) =>
    set((state) => ({
      presentationSettings: { ...state.presentationSettings, ...settings },
      isDirty: true,
    })),

  syncTeleporterEdges: (channel) => {
    set((state) => {
      const sendNode = state.nodes.find(
        (n) => n.type === "teleport-send" && (n.data as Record<string, unknown>).channel === channel
      )
      if (!sendNode) return state

      const recvNodes = state.nodes.filter(
        (n) => n.type === "teleport-receive" && (n.data as Record<string, unknown>).channel === channel
      )

      // Remove existing teleporter edges from this send
      const cleanedEdges = state.edges.filter(
        (e) => !(e.source === sendNode.id && (e.data as Record<string, unknown> | undefined)?.teleporter)
      )

      // Create new hidden edges
      const newEdges = recvNodes.map((recv) => ({
        id: `teleport_${sendNode.id}_${recv.id}`,
        source: sendNode.id,
        sourceHandle: "out",
        target: recv.id,
        targetHandle: "in",
        data: { teleporter: true },
      }))

      return { edges: [...cleanedEdges, ...newEdges], isDirty: true }
    })
  },

  replaceEdgeWithTeleporter: (edgeId) => {
    set((state) => {
      const edge = state.edges.find((e) => e.id === edgeId)
      if (!edge) return state
      const sourceNode = state.nodes.find((n) => n.id === edge.source)
      const targetNode = state.nodes.find((n) => n.id === edge.target)
      if (!sourceNode || !targetNode) return state

      const { channel, channelColor } = getNextChannel(state.nodes)
      const sendId = generateNodeId()
      const recvId = generateNodeId()

      const sendNode: WorkflowNode = {
        id: sendId,
        type: "teleport-send",
        position: {
          x: (sourceNode.position?.x ?? 0) + (sourceNode.measured?.width ?? 200) + 30,
          y: sourceNode.position?.y ?? 0,
        },
        data: { label: `Send ${channel}`, channel, channelColor } as TeleportSendData,
      }

      const recvNode: WorkflowNode = {
        id: recvId,
        type: "teleport-receive",
        position: {
          x: (targetNode.position?.x ?? 0) - 180,
          y: targetNode.position?.y ?? 0,
        },
        data: { label: `Recv ${channel}`, channel, channelColor } as TeleportReceiveData,
      }

      const newEdges = state.edges
        .filter((e) => e.id !== edgeId)
        .concat([
          { id: `edge_${Date.now()}_1`, source: edge.source, sourceHandle: edge.sourceHandle ?? null, target: sendId, targetHandle: "in", data: {} },
          { id: `edge_${Date.now()}_2`, source: recvId, sourceHandle: "out", target: edge.target, targetHandle: edge.targetHandle ?? null, data: {} },
          { id: `teleport_${sendId}_${recvId}`, source: sendId, sourceHandle: "out", target: recvId, targetHandle: "in", data: { teleporter: true } },
        ])

      return {
        nodes: [...state.nodes, sendNode, recvNode],
        edges: newEdges,
        isDirty: true,
      }
    })
  },
}))
