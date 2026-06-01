import { create } from "zustand"
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react"
import type { WorkflowNode, WorkflowEdge, SceneNodeData, SceneNodeType, CharacterDefinition, LoopNodeData, LoopColumn, PreviewItem, PreviewNodeData, TeleportSendData, TeleportReceiveData } from "@/types/nodes"
import type { PresentationDisplay, InputMode } from "@/types/nodes"
import { NODE_DEFINITIONS, NODE_DEF_MAP, TELEPORTER_CHANNEL_COLORS, LOOP_COL_ADD_HANDLE, loopColInputHandle, loopColBaseHandle } from "@/types/nodes"
import type { WorkflowSnapshot } from "./use-undo-redo-store"
import { setSkipUndoCapture } from "./undo-flags"
import { filterCloneNodes } from "@nodaro/shared"
import type { PresentationItem, PipelineStatus } from "@nodaro/shared"
import { migrateToItems, validateNoNestedGroups, cleanOrphanedItems, isCollectInEdge } from "@nodaro/shared"
import type { VariableDisplayMode } from "@/components/editor/config-panels/types"
import { buildPreviewItemKey, getPreviewItemKey } from "@/lib/preview-items"
import { autoExecuteNode } from "@/components/editor/workflow-editor/auto-execute"
import { orderNodesParentFirst, localToWorld } from "@/components/editor/workflow-editor/group-coords"
import { MAIN_TEXT_HANDLE, TEXT_PRODUCING_SOURCE_TYPES } from "@/lib/main-text-handle"
import { resolveNodeDefaults, rememberSelection, pickRelevantFields, isNodeDefaultType, readMemory, type AdminDefault } from "@/lib/node-defaults"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { getCachedUserId } from "@/hooks/use-auth"
import { getStickyParameterDisplayMode } from "@/lib/parameter-node-prefs"
import type { GenerateTextTemplate } from "@/lib/generate-text-templates"
import { migrateGenerateImageHandles } from "@/lib/generate-image-handle-migration"
import { migrateGenerateVideoNodes } from "@/lib/generate-video-handle-migration"
import { migrateListLoopNodes } from "@/lib/list-loop-migration"
import { migratePickerSourceHandle, isTileGridPickerType } from "@/lib/picker-handles"

/**
 * Migrate legacy image node types to the new split types.
 * - `edit-image` → `modify-image`, `upscale-image`, or `remove-background` based on provider
 * - `image-to-image` → `modify-image`
 */
export function migrateImageNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map(node => {
    // Cast to string for comparison — these legacy types are no longer in SceneNodeType
    const nodeType = node.type as string
    if (nodeType === "edit-image") {
      const provider = (node.data as Record<string, unknown>).provider as string | undefined
      if (provider === "nano-banana-edit") {
        return { ...node, type: "modify-image" as SceneNodeType }
      } else if (provider === "recraft-remove-bg") {
        return { ...node, type: "remove-background" as SceneNodeType }
      } else {
        // recraft-upscale, topaz-image-upscale, grok-upscale, or unknown → upscale
        return { ...node, type: "upscale-image" as SceneNodeType }
      }
    }
    if (nodeType === "image-to-image") {
      return { ...node, type: "modify-image" as SceneNodeType }
    }
    return node
  })
}

/**
 * Fields that are purely execution-related (job status, progress, results).
 * When an `updateNodeData` call only touches these keys, the undo system
 * will NOT capture a snapshot — preventing job polling from polluting the
 * undo history and clearing the redo stack.
 */
export const EXECUTION_DATA_KEYS = new Set([
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
  // Selector node dual-channel outputs (picked + rest). Without these the
  // executeSelector store write diffs the config snapshot → useAutoExecute
  // re-runs 300ms later, and in random mode (Math.random) every re-run
  // produces a fresh pick → infinite loop. Same exemption rationale as
  // __listResults: server-side execution output, not user-edited config.
  "pickedResults",
  "restResults",
  "__pickedResults",
  "__restResults",
  "__pickedTotal",
  "__restTotal",
  "generatedJson",
  "subWorkflowProgress",
  "outputResults",
  "shots",
  "result",
  "processedResult",
  "activeRoutes",
  "routeOutputs",
  "_upstreamRefresh",
  "zoom",
  // Character LoRA training status fields — written every 8s while training
  // by the polling tick in character-page-modal + on-mount backfill in
  // character-node. Treating them as execution-only keeps the undo system
  // and isDirty flag from firing on every poll.
  "loraReplicateVersion",
  "loraTriggerWord",
  "loraTrainingStatus",
  // Collect (fan-in) execution snapshot — `lastInputs` is a 50-item / 500-char
  // bounded slice but can still be ~25KB; `lastMeta` is small but written on
  // every Collect completion; `__upstreamCount` is set on the running edge of
  // the same lifecycle. Without these here, every Collect run flipped
  // isDirty, captured an undo snapshot, and broadcast a 25KB payload over
  // Realtime + autosave. Mirrors the `__listResults` / `result` exemption
  // above.
  "lastInputs",
  "lastMeta",
  "__upstreamCount",
])

/** Detect loop column type from upstream node's output handle. */
function detectLoopColumnType(
  sourceNode: WorkflowNode,
  sourceHandle: string | null | undefined,
  allNodes?: WorkflowNode[],
  allEdges?: WorkflowEdge[],
): LoopColumn["type"] {
  // Upstream list node — inherit the source column's type directly
  if (sourceNode.type === "list" && sourceHandle) {
    const srcColumns = ((sourceNode.data as Record<string, unknown>).columns ?? []) as Array<{ handleId: string; type?: string }>
    const srcCol = srcColumns.find((c) => c.handleId === sourceHandle)
    if (srcCol?.type) return srcCol.type as LoopColumn["type"]
  }
  // Teleport nodes: follow upstream edges to detect actual source type
  // Matches resolveTeleportOrigin pattern in node-input-resolver.ts
  if ((sourceNode.type === "teleport-send" || sourceNode.type === "teleport-receive") && allNodes && allEdges) {
    const inEdge = allEdges.find((e) => e.target === sourceNode.id)
    if (inEdge) {
      const upstream = allNodes.find((n) => n.id === inEdge.source)
      if (upstream) return detectLoopColumnType(upstream, inEdge.sourceHandle, allNodes, allEdges)
    }
  }
  const def = NODE_DEF_MAP.get(sourceNode.type ?? "")
  if (!def) return "text"
  const outputs = def.outputs ?? []
  if (sourceHandle === "image" || (sourceHandle === "out" && outputs.includes("image"))) return "image-url"
  if (sourceHandle === "video" || outputs.includes("video")) return "video-url"
  if (sourceHandle === "audio" || outputs.includes("audio")) return "audio-url"
  return "text"
}

function classifyPreviewValue(
  nodeType: string,
  value: string,
  sourceHandle?: string | null,
): PreviewItem["type"] {
  if (nodeType === "voice-design" && sourceHandle === "voiceId") return "text"
  if (nodeType === "forced-alignment") return "data"
  if (/\.(png|jpe?g|gif|webp|svg|bmp)/i.test(value)) return "image"
  if (/\.(mp4|mov|webm)/i.test(value)) return "video"
  if (/\.(mp3|wav|ogg|aac|flac|m4a)/i.test(value)) return "audio"
  if (nodeType.includes("image") || nodeType === "character" || nodeType === "face" || nodeType === "object" || nodeType === "location") {
    return "image"
  }
  if (nodeType.includes("video")) return "video"
  if (
    nodeType.includes("audio") ||
    nodeType.includes("speech") ||
    nodeType.includes("music") ||
    nodeType.includes("suno") ||
    nodeType === "voice-design"
  ) {
    return "audio"
  }
  return "text"
}

/**
 * Simplified output extraction for preview auto-populate (avoids circular import
 * with execution-graph.ts). Returns null if the node has no results yet.
 */
function getNodeOutputForPreview(
  node: WorkflowNode,
  sourceHandle?: string | null,
): { type: PreviewItem["type"]; value: string } | null {
  const d = node.data as Record<string, unknown>
  const t = node.type ?? ""

  if (t === "list") {
    const columns = d.columns as Array<{ handleId: string; type?: string }> | undefined
    const rows = d.rows as string[][] | undefined
    if (columns && sourceHandle) {
      const colIndex = columns.findIndex((col) => col.handleId === sourceHandle)
      const value = rows?.[0]?.[colIndex]?.trim()
      if (value) {
        const colType = columns[colIndex]?.type ?? "text"
        if (colType === "image-url") return { type: "image", value }
        if (colType === "video-url") return { type: "video", value }
        if (colType === "audio-url") return { type: "audio", value }
        if (colType === "json") return { type: "data", value }
        return { type: "text", value }
      }
    }
    // Superset of the backend extractNodeOutput ordering: when the typed-column
    // lookup above misses (no columns, or a stale/legacy sourceHandle like "in"
    // that matches no column), fall back to the first row's first cell BEFORE
    // the legacy `items` string. Without this a columns+rows list previewed via
    // a non-matching handle returned null instead of rows[0][0].
    const rowValue = rows?.[0]?.[0]?.trim()
    if (rowValue) return { type: "text", value: rowValue }
    const first = ((d.items as string | undefined) ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean)
    return first ? { type: "text", value: first } : null
  }

  if (t === "webhook-trigger") {
    const params = d.params as Array<{ id: string; name: string }> | undefined
    const triggerData = d.__triggerData as Record<string, unknown> | undefined
    if (params && params.length > 0 && triggerData) {
      if (sourceHandle) {
        const param = params.find((p) => p.id === sourceHandle)
        const value = param ? triggerData[param.name] : undefined
        if (value != null) return { type: classifyPreviewValue(t, String(value), sourceHandle), value: String(value) }
      }
      for (const param of params) {
        const value = triggerData[param.name]
        if (value != null) return { type: classifyPreviewValue(t, String(value), sourceHandle), value: String(value) }
      }
    }
    const value = (d.text as string | undefined)?.trim()
    return value ? { type: "text", value } : null
  }

  if (t === "schedule-trigger") {
    const value =
      (d.text as string | undefined)?.trim() ||
      (d.__triggerData as Record<string, unknown> | undefined)?.timestamp as string | undefined
    return value ? { type: "text", value: value.trim() } : null
  }

  if (t === "telegram-trigger") {
    const triggerData = d.__triggerData as Record<string, unknown> | undefined
    const fields: Record<string, string> = {
      text: String((triggerData?.text ?? d.text) || ""),
      imageUrl: String((triggerData?.imageUrl ?? d.imageUrl) || ""),
      videoUrl: String((triggerData?.videoUrl ?? d.videoUrl) || ""),
      audioUrl: String((triggerData?.audioUrl ?? d.audioUrl) || ""),
      chatId: String((triggerData?.chatId ?? d.chatId) || ""),
      messageId: String((triggerData?.messageId ?? d.messageId) || ""),
    }
    const value = sourceHandle ? fields[sourceHandle] : fields.text
    return value ? { type: classifyPreviewValue(t, value, sourceHandle), value } : null
  }

  if (t === "voice-design" && sourceHandle === "voiceId") {
    const value = (d.generatedVoiceId as string | undefined)?.trim()
    return value ? { type: "text", value } : null
  }

  if (t === "split-media") {
    const videoUrls = (d.generatedVideoUrls as string[] | undefined) ?? []
    const audioUrls = (d.generatedAudioUrls as string[] | undefined) ?? []
    const value = sourceHandle === "audio-out"
      ? audioUrls[0]
      : (videoUrls[0] ?? audioUrls[0])
    return value ? { type: classifyPreviewValue(t, value, sourceHandle), value } : null
  }

  if (t === "qa-check") {
    if (d.approved == null) return null
    const approved = d.approved as boolean
    const reason = ((d.reason as string | undefined) ?? (approved ? "approved" : "rejected")).trim()
    if (sourceHandle === "approved") return approved ? { type: "text", value: reason } : null
    if (sourceHandle === "rejected") return !approved ? { type: "text", value: reason } : null
    return { type: "text", value: reason }
  }

  if (t === "router") {
    const routeOutputs = d.routeOutputs as Record<string, string | undefined> | undefined
    const value = sourceHandle
      ? routeOutputs?.[sourceHandle]
      : (d.result as string | undefined)
    return value ? { type: classifyPreviewValue(t, value, sourceHandle), value } : null
  }

  if (t === "sub-workflow" || t === "component") {
    const outputResults = d.outputResults as Record<string, string> | undefined
    if (!outputResults) return null
    let value: string | undefined
    if (sourceHandle) {
      value = outputResults[sourceHandle.replace(/^out_/, "")]
    }
    if (!value && t === "component") {
      const metadata = d.componentMetadata as { outputs?: Array<{ id: string; mediaPreview?: boolean }> } | undefined
      const previewHandle = metadata?.outputs?.find((output) => output.mediaPreview)
      if (previewHandle) value = outputResults[previewHandle.id]
    }
    if (!value) {
      const visiblePortId = (d.routeSnapshot as Record<string, unknown> | undefined)?.visibleOutputPortId as string | undefined
      value = (visiblePortId ? outputResults[visiblePortId] : undefined) ?? Object.values(outputResults)[0]
    }
    return value ? { type: classifyPreviewValue(t, value, sourceHandle), value } : null
  }

  if (t === "sub-workflow-input") {
    const injected = d.__injectedPortValues as Record<string, string> | undefined
    if (!injected) return null
    const value = sourceHandle ? injected[sourceHandle] : Object.values(injected)[0]
    return value ? { type: classifyPreviewValue(t, value, sourceHandle), value } : null
  }

  // Text source nodes
  if (t === "text-prompt") {
    const v = (d.text as string)?.trim()
    return v ? { type: "text", value: v } : null
  }

  // Text output nodes
  if (t === "suno-lyrics" || t === "suno-style-boost" || (t as string) === "ai-writer" || t === "llm-chat" || t === "generate-script") {
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
    return { type: classifyPreviewValue(t, url, sourceHandle), value: url }
  }

  // Fallback URL fields
  const imgUrl = (d.generatedImageUrl as string)?.trim()
  if (imgUrl) return { type: "image", value: imgUrl }
  const vidUrl = (d.generatedVideoUrl as string)?.trim()
  if (vidUrl) return { type: "video", value: vidUrl }
  const audUrl = (d.generatedAudioUrl as string)?.trim()
  if (audUrl) return { type: "audio", value: audUrl }

  const textUrl = (d.generatedText as string)?.trim()
  if (textUrl) return { type: "text", value: textUrl }

  return null
}

export type SaveStatus = "idle" | "saving" | "saved" | "error"

export type PresentationViewMode = "horizontal" | "vertical" | "gallery" | "fullscreen" | "compare"

export interface PresentationSettings {
  runTarget: "workflow" | "sub-workflow" | "route"
  subWorkflowNodeId?: string
  selectedRouteId?: string
  splitRatio?: number // 20-80, default 50
  inputOrder?: string[] // node IDs in display order (legacy)
  outputOrder?: string[] // node IDs in display order (legacy)
  inputItems?: PresentationItem[] // rich ordered items (groups, fields, richtext)
  outputItems?: PresentationItem[] // rich ordered items (groups, fields, richtext)
  cardMeta?: Record<string, { title?: string; description?: string; display?: Partial<PresentationDisplay>; inputMode?: InputMode; minLines?: number; pickerMode?: "inline" | "modal" | "compact"; pickerAllowedValues?: string[] }>
  viewMode?: PresentationViewMode // defaults to "horizontal"
  compareLeft?: string // node ID for left compare item
  compareRight?: string // node ID for right compare item
  shareReadOnly?: boolean // default false — pure viewing, no inputs/run
  shareAllowedModes?: PresentationViewMode[] // default all 5 — subset viewer can use
  shareDefaultMode?: PresentationViewMode // default "horizontal" — initial mode for viewer
  outputDisplayModes?: Record<string, "gallery" | "individual"> // per-output-node display mode, default "individual"
  /** Node IDs hidden by the viewer */
  hiddenNodes?: string[]
}

export const DEFAULT_PRESENTATION_SETTINGS: PresentationSettings = { runTarget: "workflow" }

interface WorkflowState {
  readonly workflowId: string | null
  readonly projectId: string | null
  readonly workflowName: string
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
  readonly selectedNodeId: string | null
  /** True when the config panel is in fullscreen (modal) mode. UI-only flag —
   *  used to gate workflow keyboard shortcuts and the global Execute button. */
  readonly configPanelFullscreen: boolean
  readonly setConfigPanelFullscreen: (open: boolean) => void
  /** One-shot flag: the next selectedNodeId change should NOT trigger the
   *  canvas viewport animation (zoom-to-fit). Set by openFullscreenSettings;
   *  consumed and cleared by the viewport effect in workflow-canvas. */
  readonly skipNextViewportAnimation: boolean
  /** Whether the sidebar was open when openFullscreenSettings was called.
   *  closeFullscreenSettings uses this to restore the sidebar on close. */
  readonly _sidebarWasOpenBeforeFullscreen: boolean
  /** Close fullscreen settings and optionally restore the sidebar if it was
   *  open before the fullscreen was triggered (via openFullscreenSettings). */
  readonly closeFullscreenSettings: () => void
  readonly isDirty: boolean
  readonly loadGeneration: number
  readonly saveStatus: SaveStatus
  readonly saveError: string | null
  /**
   * `workflows.updated_at` of the row this tab's local state was last
   * synced from. Used for optimistic locking on save (sent as
   * `expected_updated_at`) and to skip own-broadcast echoes in the
   * realtime sync. Set on load, after a successful save, and after a
   * full reconcile from a remote broadcast. Null when no workflow is
   * loaded.
   */
  readonly loadedUpdatedAt: string | null
  /**
   * Most recent `updated_at` observed on a realtime broadcast that did
   * NOT come from this tab. When this diverges from `loadedUpdatedAt`,
   * another device wrote a newer version while this tab had unsaved
   * edits — drives the "workflow updated elsewhere" banner.
   */
  readonly remoteUpdatedAt: string | null
  readonly videoAutoplay: boolean
  readonly freecutEdit: { nodeId: string; videoUrl: string; freecutProjectUrl?: string } | null
  readonly openFreeCut: (nodeId: string, videoUrl: string, freecutProjectUrl?: string) => void
  readonly closeFreeCut: () => void
  readonly imageEdit: { nodeId: string; imageUrl: string; designStateUrl?: string } | null
  readonly openImageEdit: (nodeId: string, imageUrl: string, designStateUrl?: string) => void
  readonly closeImageEdit: () => void
  readonly variableDisplayMode: VariableDisplayMode
  readonly setVariableDisplayMode: (mode: VariableDisplayMode) => void
  readonly newNodeIds: Set<string>
  readonly characterDefinitions: CharacterDefinition[]
  readonly userPromptTemplates: Record<string, string>
  /** User-defined Generate Text templates (loaded from profiles.text_templates
   *  via useLoadUserSettings). User-level, not per-workflow. */
  readonly userTextTemplates: GenerateTextTemplate[]
  readonly flowPromptTemplates: Record<string, string>
  readonly presentationSettings: PresentationSettings

  readonly setWorkflowId: (id: string | null) => void
  readonly setProjectId: (id: string | null) => void
  readonly setWorkflowName: (name: string) => void
  readonly onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void
  readonly onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void
  readonly onConnect: (connection: Connection) => void
  readonly addNode: (type: SceneNodeType, position: { x: number; y: number }, initialData?: Record<string, unknown>) => string | undefined
  /**
   * Select a node and open its config panel in fullscreen — but only for
   * tile-grid picker node types. No-op for non-pickers (text-prompt / tone /
   * generate-image / etc.). Use after `addNode` returns a fresh node id when
   * the caller wants the picker UX without bundling the create + open into
   * one step (e.g., the add-node popup's connectionContext branch needs to
   * create the node, wire the edge, THEN open the picker so the panel mounts
   * with the upstream context already present).
   */
  readonly openPickerForNode: (nodeId: string, type: SceneNodeType) => void
  /**
   * `addNode` + `openPickerForNode`, in one call. Returns the new node id
   * (or undefined if creation failed). Convenience combo for add-node entry
   * points that don't need to wire an edge between create and open (popup
   * `handleAddNode` in workflow-canvas, sidebar `handleAddNode` in
   * node-toolbar). The popup's connectionContext branch uses the two
   * actions separately so the edge lands before the picker mounts.
   */
  readonly addNodeAndOpenPicker: (type: SceneNodeType, position: { x: number; y: number }, initialData?: Record<string, unknown>) => string | undefined
  /** Select a node and open its config panel in fullscreen WITHOUT triggering
   *  the canvas zoom-to-fit animation. Used by the node icon click so the
   *  viewport stays where it is. */
  readonly openFullscreenSettings: (nodeId: string) => void
  readonly updateNode: (nodeId: string, updates: Partial<WorkflowNode>) => void
  readonly updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
  /**
   * Batched optimistic execution-status flip for many nodes in ONE store
   * update. Sets `data.executionStatus` on every matched id (to `undefined`,
   * which reads back as idle, when `status` is undefined) in a single
   * `nodes.map()` — used by the Run
   * handlers so the "pending" border appears the instant Run is clicked
   * without K separate `updateNodeData` calls. `executionStatus` is an
   * EXECUTION_DATA_KEY so this is wrapped in `setSkipUndoCapture` and never
   * registers an undo snapshot (same exemption rationale as
   * `syncNodeStatesToStore`). Unmatched nodes keep object identity.
   */
  readonly markNodesStatus: (
    ids: ReadonlyArray<string>,
    status: "pending" | "running" | "failed" | "completed" | undefined,
  ) => void
  /**
   * Phase 1B.4 — patch `data` on every node whose
   * `data.pipeline_entity_id === entityId`. Used by the pipeline SSE handler
   * to apply `entity:state_change` / `entity:stale` events without needing to
   * know each node's React Flow `id`. No-op when no match. Bypasses the
   * label-rename / `{Ref}` sync logic since pipeline lifecycle patches never
   * touch the node label.
   */
  readonly updateNodeDataByEntityId: (
    entityId: string,
    data: Record<string, unknown>,
  ) => void
  readonly updateNodeWithData: (
    nodeId: string,
    nodeUpdates: Partial<WorkflowNode>,
    dataUpdates: Record<string, unknown>,
  ) => void
  readonly deleteNode: (nodeId: string) => void
  readonly deleteEdge: (edgeId: string) => void
  readonly updateEdgeData: (edgeId: string, data: Record<string, unknown>) => void
  readonly duplicateNode: (nodeId: string, position?: { x: number; y: number }) => void
  readonly duplicateNodes: (ids: string[]) => void
  readonly selectNode: (nodeId: string | null) => void
  readonly setUserPromptTemplates: (templates: Record<string, string>) => void
  readonly setUserTextTemplates: (templates: GenerateTextTemplate[]) => void
  readonly setFlowPromptTemplates: (templates: Record<string, string>) => void
  readonly savedViewport: { x: number; y: number; zoom: number } | null
  readonly setSavedViewport: (vp: { x: number; y: number; zoom: number } | null) => void
  readonly isWorkflowLoading: boolean
  readonly setIsWorkflowLoading: (loading: boolean) => void
  readonly loadWorkflow: (id: string, name: string, nodes: WorkflowNode[], edges: WorkflowEdge[], characterDefinitions?: CharacterDefinition[], flowPromptTemplates?: Record<string, string>, presentationSettings?: PresentationSettings, viewport?: { x: number; y: number; zoom: number } | null) => void
  readonly clearWorkflow: () => void
  readonly markClean: () => void
  readonly setSaveStatus: (status: SaveStatus, error?: string | null) => void
  readonly setLoadedUpdatedAt: (updatedAt: string | null) => void
  readonly setRemoteUpdatedAt: (updatedAt: string | null) => void
  /**
   * Atomically apply post-save state changes in a single Zustand `set()`.
   * Replaces the previous sequence of `setLoadedUpdatedAt → setRemoteUpdatedAt
   * → markClean → setSaveStatus`, which the realtime subscription could
   * observe mid-sequence — e.g., seeing `isDirty=false` plus a still-stale
   * `loadedUpdatedAt` and triggering a redundant full reconcile on our own
   * save echo. Batching closes that window.
   */
  readonly applySaveSuccess: (updatedAt: string) => void
  /**
   * Multi-tab/multi-device sync: snap local state to a remote broadcast.
   * Replaces nodes/edges (and persisted settings fields:
   * characterDefinitions, flowPromptTemplates, presentationSettings)
   * with the payload, marks the workflow clean, and advances
   * `loadedUpdatedAt` to the broadcast version. Used by the realtime
   * sync when local state had no unsaved edits.
   *
   * Tab-local UI state (configPanelFullscreen, savedViewport, etc.)
   * is preserved — those aren't workflow content. `selectedNodeId` is
   * cleared if the selected node was removed in the remote snapshot,
   * to avoid leaving a phantom selection pointing at a deleted id.
   */
  readonly reconcileFromRemote: (args: {
    nodes: WorkflowNode[]
    edges: WorkflowEdge[]
    updatedAt: string
    settings?: Record<string, unknown> | null
  }) => void
  readonly setVideoAutoplay: (autoplay: boolean) => void
  readonly clearNewNode: (id: string) => void
  readonly runSingleNode: ((nodeId: string) => void) | null
  readonly setRunSingleNode: (fn: ((nodeId: string) => void) | null) => void
  readonly runFromHere: ((nodeId: string) => void) | null
  readonly setRunFromHere: (fn: ((nodeId: string) => void) | null) => void
  readonly runSelected: (() => void) | null
  readonly setRunSelected: (fn: (() => void) | null) => void
  /** Opens the canvas add-node popup anchored to a specific handle. Wired
   *  by `workflow-canvas.tsx` at mount; consumed by HandleWithPopover's
   *  "Add new" affordance. Null when the canvas isn't mounted. */
  readonly openAddNodePopupForHandle:
    | ((args: { nodeId: string; handleId: string; direction: "source" | "target"; nodeType: string }) => void)
    | null
  readonly setOpenAddNodePopupForHandle: (
    fn: ((args: { nodeId: string; handleId: string; direction: "source" | "target"; nodeType: string }) => void) | null,
  ) => void
  /** Edge id currently being hovered in a HandlePopover row — drives the
   *  edge highlight visual via `AnimatedFlowEdge`. Null when no row is
   *  hovered. */
  readonly hoveredEdgeId: string | null
  readonly setHoveredEdgeId: (id: string | null) => void
  /** Reorders edges connected to a specific (node, handle, direction).
   *  Used by HandlePopover for handles where order is semantically
   *  meaningful (e.g., Generate Image References). */
  readonly reorderHandleEdges: (
    nodeId: string,
    handleId: string,
    direction: "source" | "target",
    fromIndex: number,
    toIndex: number,
  ) => void
  /** Disconnects ALL edges from a specific (node, handle, direction).
   *  Used by HandlePopover's disconnect-all affordance. */
  readonly disconnectAllHandleEdges: (
    nodeId: string,
    handleId: string,
    direction: "source" | "target",
  ) => void
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
  /**
   * Phase 1B.4 — id of the freshest pipeline-owned canvas node that just
   * transitioned into `pipeline_owned_running`. Written by the pipeline SSE
   * handler in `usePipelineEvents`; read by the canvas auto-pan hook so the
   * viewport can follow the build live. Cleared when the panel unmounts
   * or a new pipeline is opened.
   */
  readonly lastAddedPipelineNodeId: string | null
  readonly setLastAddedPipelineNodeId: (id: string | null) => void
  /**
   * Phase 1B.4 — pipeline status snapshot mirrored from the SSE stream. Used
   * by the canvas to decide whether the live-build hooks (ELK auto-layout,
   * auto-pan) are active. Distinct from the per-node `data.status` on the
   * generative-pipeline node so a closed pipeline panel doesn't lose this.
   * `null` when no pipeline is active.
   */
  readonly activePipelineStatus: PipelineStatus | null
  readonly setActivePipelineStatus: (status: PipelineStatus | null) => void
  /** Node ID whose Character Studio modal is open (null = closed). UI-only. */
  readonly characterStudioNodeId: string | null
  readonly setCharacterStudioNodeId: (id: string | null) => void
  /** Node ID whose Location Studio modal is open (null = closed). UI-only. */
  readonly locationStudioNodeId: string | null
  readonly setLocationStudioNodeId: (id: string | null) => void
  /** Node ID whose Object Studio modal is open (null = closed). UI-only. */
  readonly objectStudioNodeId: string | null
  readonly setObjectStudioNodeId: (id: string | null) => void
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

function getNextChannel(nodes: WorkflowNode[], forType?: "teleport-send" | "teleport-receive"): { channel: string; channelColor: string } {
  if (forType === "teleport-receive") {
    const recvChannels = new Set(
      nodes.filter((n) => n.type === "teleport-receive").map((n) => (n.data as TeleportSendData).channel)
    )
    const unmatchedSend = nodes.find(
      (n) => n.type === "teleport-send" && !recvChannels.has((n.data as TeleportSendData).channel)
    )
    if (unmatchedSend) {
      const d = unmatchedSend.data as TeleportSendData
      return { channel: d.channel, channelColor: d.channelColor }
    }
  }
  const usedChannels = new Set(
    nodes
      .filter((n) => n.type === "teleport-send")
      .map((n) => (n.data as TeleportSendData).channel)
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

/**
 * Per-(nodeType, handleId) parallel-order field name. Several consumers
 * keep a separate `data.<field>Order: string[]` populated by their
 * config-panel's ConnectedMediaList drag UI; the runtime preferentially
 * reads from this array ahead of edge-array order (see execute-node.ts
 * applyMediaOrder call sites + payload-builder.ts for generate-image's
 * `references`). When the typed popover reorders edges, we must clear
 * the parallel field or the user's reorder is silently no-op.
 *
 * Returns the data field name to clear, or undefined when no parallel
 * field exists for this (type, handle, direction) tuple.
 */
function getParallelOrderField(
  nodeType: string | undefined,
  handleId: string,
  direction: "source" | "target",
): string | undefined {
  if (direction !== "target") return undefined
  if (!nodeType) return undefined
  if (handleId !== "references" && handleId !== "in") return undefined
  switch (`${nodeType}:${handleId}`) {
    case "generate-image:references":   return "referenceImageOrder"
    case "combine-videos:in":           return "clipOrder"
    case "mix-audio:in":                return "trackOrder"
    case "combine-audio:in":            return "segmentOrder"
    // merge-video-audio is INTENTIONALLY OMITTED. Its `data.trackSettings`
    // is keyed by sourceNodeId (object), not order — the backend
    // (payload-builder.ts) and frontend runtime (execute-node.ts:4401)
    // iterate `audioSources` (edge-array order) and read trackSettings
    // per-sourceNodeId. There is no parallel order array to clear.
    default:                            return undefined
  }
}

/**
 * Build the cloned `data` for a duplicated node: strips live execution state
 * and regenerates per-type fresh UUIDs (sub-workflow ports/routeId, router
 * route ids, loop/list column ids + handleIds). When `handleMap` is supplied,
 * loop/list column handle remappings (old handleId → new) are recorded into it
 * so a multi-node duplicate can re-point cloned edges that reference those
 * regenerated handles. When `idMap` is supplied (multi-node duplicate), a
 * loop/list column's `connectedSourceId` is re-pointed to the cloned source if
 * that source is also in the duplicated set, otherwise cleared — mirroring the
 * paste path so the column's "connected" UI stays in sync with the recreated
 * edge. With no `idMap` (single duplicate) connections are always cleared.
 * Shared by `duplicateNode` (single), `duplicateNodes`, and the Ctrl+V paste
 * handler so all three clone node data identically.
 */
export function buildDuplicatedNodeData(
  source: WorkflowNode,
  handleMap?: Record<string, string>,
  idMap?: Record<string, string>,
): SceneNodeData {
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
  // Clear "owns DB row X" pointers so the clone creates its own entity row on
  // first save. Otherwise editing/deleting the clone mutates the original's
  // row (object-page-modal passes the id to UPDATE-instead-of-INSERT) and the
  // asset→node reverse lookup (unified-asset-library) becomes ambiguous.
  for (const dbIdField of ["characterDbId", "objectDbId", "locationDbId", "faceDbId"]) {
    if (dbIdField in d) d[dbIdField] = ""
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

  // Generate fresh UUIDs for list column IDs and handleIds; re-point or clear
  // the column's connected-source reference (see idMap note above).
  if (source.type === "list") {
    const cols = d.columns as LoopColumn[] | undefined
    if (cols) {
      d.columns = cols.map((c) => {
        const newId = crypto.randomUUID()
        const newHandleId = `col_${newId}`
        if (handleMap) {
          handleMap[c.handleId] = newHandleId
          handleMap[`${c.handleId}_in`] = `${newHandleId}_in`
        }
        const mappedSource = c.connectedSourceId ? idMap?.[c.connectedSourceId] : undefined
        return {
          ...c,
          id: newId,
          handleId: newHandleId,
          connectedSourceId: mappedSource ?? undefined,
          connectedSourceHandle: mappedSource ? c.connectedSourceHandle : undefined,
        }
      })
    }
  }

  return clonedData
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflowId: null,
  projectId: null,
  workflowName: "Untitled Workflow",
  nodes: [],
  edges: [],
  selectedNodeId: null,
  configPanelFullscreen: false,
  setConfigPanelFullscreen: (open) => set({ configPanelFullscreen: open }),
  skipNextViewportAnimation: false,
  _sidebarWasOpenBeforeFullscreen: false,
  isDirty: false,
  loadGeneration: 0,
  saveStatus: "idle" as SaveStatus,
  saveError: null,
  loadedUpdatedAt: null,
  remoteUpdatedAt: null,
  videoAutoplay: typeof window !== "undefined" && typeof localStorage !== "undefined" && typeof localStorage.getItem === "function" && localStorage.getItem("videoAutoplay") !== null
    ? localStorage.getItem("videoAutoplay") === "true"
    : true,
  savedViewport: null,
  setSavedViewport: (vp) => set({ savedViewport: vp }),
  freecutEdit: null,
  imageEdit: null,
  variableDisplayMode: "raw" as const,
  newNodeIds: new Set<string>(),
  characterDefinitions: [],
  userPromptTemplates: {},
  userTextTemplates: [],
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
      const resizedNodeIds: string[] = []
      for (const c of changes) {
        if (c.type === "select") {
          hasSelectionChange = true
          if (c.selected) lastSelectedId = c.id
        } else if (c.type === "dimensions") {
          // User-initiated resize (NodeResizer) sets resizing flag — treat as content change
          // so the resized dimensions get auto-saved. Auto-measurement events don't have resizing.
          if ("resizing" in c && c.resizing) {
            hasContentChange = true
            resizedNodeIds.push(c.id)
          }
        } else {
          hasContentChange = true
        }
      }

      // Mark resized nodes with className so CSS can override hardcoded maxWidth/width
      // constraints in node wrapper divs, allowing content to fill the resized area on reload.
      if (resizedNodeIds.length > 0) {
        newNodes = newNodes.map((n) =>
          resizedNodeIds.includes(n.id) && !n.className?.includes("rf-resized")
            ? { ...n, className: ((n.className ?? "") + " rf-resized").trim() }
            : n,
        )
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

  onConnect: (connection) => {
    set((state) => {
      let newEdges = addEdge(
        { ...connection, id: `edge_${Date.now()}` },
        state.edges,
      )

      // --- List node: quick-add handle or per-column-target handle ---
      let newNodes = state.nodes
      const targetNode = state.nodes.find((n) => n.id === connection.target)
      if (targetNode?.type === "list") {
        const loopData = targetNode.data as LoopNodeData
        const sourceNode = state.nodes.find((n) => n.id === connection.source)

        if (connection.targetHandle === LOOP_COL_ADD_HANDLE && sourceNode) {
          const colType = detectLoopColumnType(sourceNode, connection.sourceHandle, state.nodes as WorkflowNode[], newEdges as WorkflowEdge[])

          // Reuse sole empty column if it exists (e.g. default "Items" column on a new List node)
          const soleEmptyCol = (loopData.columns ?? []).length === 1 && !(loopData.columns![0].connectedSourceId)
            ? loopData.columns![0]
            : undefined

          if (soleEmptyCol) {
            const sourceLabel = (sourceNode.data as Record<string, unknown>).label as string || sourceNode.type || "Column"
            const colType = detectLoopColumnType(sourceNode, connection.sourceHandle, state.nodes as WorkflowNode[], newEdges as WorkflowEdge[])
            const updatedColumns = (loopData.columns ?? []).map((col) =>
              col.id === soleEmptyCol.id
                ? { ...col, type: colType, connectedSourceId: connection.source!, name: sourceLabel }
                : col
            )
            newNodes = newNodes.map((n) =>
              n.id === connection.target
                ? { ...n, data: { ...n.data, columns: updatedColumns } }
                : n
            )
            newEdges = newEdges.map((e) =>
              e.source === connection.source &&
              e.target === connection.target &&
              e.targetHandle === LOOP_COL_ADD_HANDLE
                ? { ...e, targetHandle: loopColInputHandle(soleEmptyCol.handleId) }
                : e
            )
            return { nodes: newNodes, edges: newEdges, isDirty: true }
          }

          // If a column of the same type already exists (with a connected source),
          // route the new edge to that column instead of creating a new one.
          // This makes multiple same-type sources appear as rows, not columns.
          const existingCol = (loopData.columns ?? []).find(
            (c) => c.type === colType && c.connectedSourceId,
          )
          if (existingCol) {
            newEdges = newEdges.map((e) =>
              e.source === connection.source &&
              e.target === connection.target &&
              e.targetHandle === LOOP_COL_ADD_HANDLE
                ? { ...e, targetHandle: loopColInputHandle(existingCol.handleId) }
                : e,
            )
            return { nodes: newNodes, edges: newEdges, isDirty: true }
          }

          // Quick-add: create a new column from the upstream node
          const colId = crypto.randomUUID()
          const handleId = `col_${colId}`
          const sourceLabel = (sourceNode.data as Record<string, unknown>).label as string || sourceNode.type || "Column"
          const newCol: LoopColumn = {
            id: colId,
            name: sourceLabel,
            handleId,
            type: colType,
            connectedSourceId: connection.source!,
            connectedSourceHandle: connection.sourceHandle ?? undefined,
          }
          const updatedColumns = [...(loopData.columns ?? []), newCol]
          let updatedRows = (loopData.rows ?? []).map((row) => [...row, ""])
          if (updatedRows.length === 0) updatedRows = [updatedColumns.map(() => "")]

          newNodes = newNodes.map((n) =>
            n.id === connection.target
              ? { ...n, data: { ...n.data, columns: updatedColumns, rows: updatedRows } }
              : n,
          )

          // Rewire: the edge was just added targeting "col_add" — update to target the new column
          newEdges = newEdges.map((e) =>
            e.source === connection.source &&
            e.target === connection.target &&
            e.targetHandle === LOOP_COL_ADD_HANDLE
              ? { ...e, targetHandle: loopColInputHandle(handleId) }
              : e,
          )

          return { nodes: newNodes, edges: newEdges, isDirty: true }
        }

        // Per-column target: set connectedSourceId on the matching column
        const targetHandle = connection.targetHandle ?? ""
        if (targetHandle.endsWith("_in") && sourceNode) {
          const baseHandleId = loopColBaseHandle(targetHandle)
          const updatedColumns = (loopData.columns ?? []).map((col) =>
            col.handleId === baseHandleId
              ? {
                  ...col,
                  connectedSourceId: connection.source!,
                  connectedSourceHandle: connection.sourceHandle ?? undefined,
                  name: (sourceNode.data as Record<string, unknown>).label as string || col.name,
                  type: detectLoopColumnType(sourceNode, connection.sourceHandle, state.nodes as WorkflowNode[], newEdges as WorkflowEdge[]),
                }
              : col,
          )
          newNodes = newNodes.map((n) =>
            n.id === connection.target
              ? { ...n, data: { ...n.data, columns: updatedColumns } }
              : n,
          )
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
          const output = getNodeOutputForPreview(src, edge.sourceHandle ?? undefined)
          if (!output) continue
          const itemKey = buildPreviewItemKey(src.id, edge.sourceHandle)
          items.push({
            type: output.type,
            value: output.value,
            itemKey,
            sourceNodeId: src.id,
            sourceHandle: edge.sourceHandle ?? undefined,
            sourceNodeLabel: (src.data as Record<string, unknown>).label as string || src.type || "",
            visible: true,
          })
        }
        if (items.length > 0) {
          const prevData = previewTarget.data as PreviewNodeData
          const prevItems = prevData.previewItems ?? []
          const prevVisibility = new Map(prevItems.map((item) => [getPreviewItemKey(item), item.visible]))
          const normalizedItems = items.map((item) => ({
            ...item,
            visible: prevVisibility.get(getPreviewItemKey(item)) ?? item.visible,
          }))
          // Merge: keep existing items, add/update from fresh data
          const merged = new Map(prevItems.map((it) => [getPreviewItemKey(it), it]))
          for (const item of normalizedItems) merged.set(getPreviewItemKey(item), item)
          const mergedItems = [...merged.values()]
          newNodes = newNodes.map((n) =>
            n.id === previewTarget.id
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    previewItems: mergedItems,
                    itemOrder: mergedItems.map((item) => getPreviewItemKey(item)),
                    executionStatus: "completed",
                  },
                }
              : n,
          )
        }
      }

      // Auto-fill {SourceLabel} on the target's main text field when it's
      // empty at connect time. Makes `{Label}` injection discoverable —
      // one drag, and the user sees the placeholder they can edit/wrap.
      // Skipped when the field already has text (no overwrite, ever), the
      // field is already mapped via the dropdown (don't bury an active
      // mapping behind a literal `{Label}` the user can't see), or the
      // source doesn't produce text (no `{Upload Image}` leaks).
      const targetMain = newNodes.find((n) => n.id === connection.target)
      const sourceMain = newNodes.find((n) => n.id === connection.source)
      if (targetMain && sourceMain) {
        const mappings = MAIN_TEXT_HANDLE[targetMain.type ?? ""]
        const srcType = sourceMain.type ?? ""
        const matched = mappings?.find((m) => m.handle === connection.targetHandle)
        if (matched && TEXT_PRODUCING_SOURCE_TYPES.has(srcType)) {
          const targetData = targetMain.data as Record<string, unknown>
          const current = targetData[matched.field]
          const hasText = typeof current === "string" && current.trim().length > 0
          const fm = targetData.fieldMappings as Record<string, { sourceNodeId: string }> | undefined
          const alreadyMapped = !!fm?.[matched.field]?.sourceNodeId
          if (!hasText && !alreadyMapped) {
            const srcData = sourceMain.data as Record<string, unknown>
            const srcLabel =
              (typeof srcData.label === "string" && srcData.label.trim()) ||
              srcType ||
              "Source"
            newNodes = newNodes.map((n) =>
              n.id === targetMain.id
                ? { ...n, data: { ...n.data, [matched.field]: `{${srcLabel}}` } }
                : n,
            )
          }
        }
      }

      // Collect node (spec §5.2.1): when a new edge connects to a Collect's
      // "in" handle, append the source node id to data.order so the Collect's
      // output preserves connection order (and the config panel reflects it).
      const collectTarget = newNodes.find((n) => n.id === connection.target && n.type === "collect")
      if (collectTarget && isCollectInEdge(connection) && connection.source) {
        const collectData = collectTarget.data as { order?: string[] }
        const currentOrder = collectData.order ?? []
        if (!currentOrder.includes(connection.source)) {
          const nextOrder = [...currentOrder, connection.source]
          newNodes = newNodes.map((n) =>
            n.id === collectTarget.id
              ? { ...n, data: { ...n.data, order: nextOrder } }
              : n,
          )
        }
      }

      return { nodes: newNodes, edges: newEdges, isDirty: true }
    })

    // Trigger auto-execute on the newly-connected target (combine-text, filter-list,
    // router, etc.). The function no-ops for non-auto-execute types and for targets
    // whose upstream has no output yet, so this is safe for every connection.
    autoExecuteNode(connection.target)
  },

  addNode: (type, position, initialData) => {
    const definition = NODE_DEFINITIONS.find((d) => d.type === type)
    if (!definition) return undefined

    const id = generateNodeId()

    // Three-layer default resolution: factory ← admin DB ← user localStorage.
    // No-op for node types not in NODE_DEFAULT_TYPES.
    const adminDefaults = queryClient.getQueryData<AdminDefault[]>(queryKeys.nodeDefaults.all) ?? []
    const resolvedDefaults = resolveNodeDefaults({
      nodeType: type,
      factory: definition.defaultData as Record<string, unknown>,
      adminDefaults,
      userId: getCachedUserId(),
    })
    const nodeData = { ...resolvedDefaults, ...initialData }

    // Parameter nodes: seed displayMode from the user's per-device preference
    // so a new node opens in whatever mode (picks/prompt/both) they last used.
    // Only applied when the caller hasn't passed an explicit displayMode; this
    // keeps the store-level seeding decoupled from the picker UI's render-time
    // resolution (which always trusts the saved data on existing nodes).
    if (definition.category === "parameter" && nodeData.displayMode === undefined) {
      nodeData.displayMode = getStickyParameterDisplayMode()
    }

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
      data: nodeData as SceneNodeData,
      ...(definition.width ? { width: definition.width } : {}),
      ...(definition.height ? { height: definition.height } : {}),
      // Sticky notes should appear behind other nodes
      ...(type === "sticky-note" ? { zIndex: -1 } : {}),
    }

    if (type === "teleport-send" || type === "teleport-receive") {
      const { channel, channelColor } = getNextChannel(get().nodes, type)
      const matchedSend = type === "teleport-receive"
        ? get().nodes.find((n) => n.type === "teleport-send" && (n.data as TeleportSendData).channel === channel)
        : null
      const label = matchedSend ? (matchedSend.data as TeleportSendData).label : channel
      newNode.data = { ...newNode.data, channel, channelColor, label }
    }

    set((state) => ({
      nodes: [...state.nodes, newNode],
      newNodeIds: new Set([...state.newNodeIds, id]),
      isDirty: true,
    }))

    if (type === "teleport-send" || type === "teleport-receive") {
      get().syncTeleporterEdges((newNode.data as TeleportSendData).channel)
    }

    return id
  },

  openPickerForNode: (nodeId, type) => {
    if (!isTileGridPickerType(type)) return
    // Reuse the canonical selectNode so React Flow's `node.selected` flags
    // and `selectedNodeId` stay in lockstep (selectNode is the only place
    // that handles already-selected fast-path + clears other selections).
    // Subsequent set() for the fullscreen flag is intentionally a separate
    // transition — Zustand subscribers in this codebase already tolerate
    // selectNode emitting its own update, and inlining the logic would
    // duplicate the very contract we're trying to reuse.
    get().selectNode(nodeId)
    set({ configPanelFullscreen: true })
  },

  addNodeAndOpenPicker: (type, position, initialData) => {
    const id = get().addNode(type, position, initialData)
    if (id) get().openPickerForNode(id, type)
    return id
  },

  openFullscreenSettings: (nodeId) => {
    const prev = get()
    // Record whether the sidebar was already open so closeFullscreenSettings
    // can restore it when the user dismisses the fullscreen modal.
    const sidebarWasOpen = prev.selectedNodeId !== null && !prev.configPanelFullscreen
    set({
      skipNextViewportAnimation: true,
      _sidebarWasOpenBeforeFullscreen: sidebarWasOpen,
    })
    set((state) => ({
      selectedNodeId: nodeId,
      configPanelFullscreen: true,
      nodes: state.nodes.map((n) => ({ ...n, selected: n.id === nodeId })),
    }))
  },

  closeFullscreenSettings: () => {
    const state = get()
    // If the sidebar was open before we entered fullscreen, keep selectedNodeId
    // so the sidebar re-appears; otherwise clear it entirely.
    set({
      configPanelFullscreen: false,
      selectedNodeId: state._sidebarWasOpenBeforeFullscreen ? state.selectedNodeId : null,
      _sidebarWasOpenBeforeFullscreen: false,
    })
  },

  updateNode: (nodeId, updates) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...updates } : node,
      ),
    })),

  // Batched optimistic execution-status flip — see interface JSDoc. One
  // nodes.map(); only matched ids get a fresh data reference (object identity
  // preserved for the rest). executionStatus is execution-only, so undo
  // capture is suppressed (mirrors syncNodeStatesToStore).
  markNodesStatus: (ids, status) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    // Build the patch as Record<string, unknown> so the literal status
    // (which includes the runtime-only "pending" value, not present in the
    // narrower SceneNodeData type) erases to unknown — same erasure
    // updateNodeData/syncNodeStatesToStore rely on for "pending".
    const patch: Record<string, unknown> = { executionStatus: status }
    setSkipUndoCapture(true)
    try {
      set((state) => ({
        nodes: state.nodes.map((node) =>
          idSet.has(node.id)
            ? { ...node, data: { ...node.data, ...patch } as SceneNodeData }
            : node,
        ),
        isDirty: true,
      }))
    } finally {
      setSkipUndoCapture(false)
    }
  },

  // Phase 1B.4 — see interface JSDoc. Skips undo capture (lifecycle is
  // backend-driven, not a user action) and skips label-rename / ref-sync.
  // Shallow-equal skip: SSE handlers re-fire on reconnect; suppress no-op
  // patches so React Flow doesn't re-render every entity card on every event.
  updateNodeDataByEntityId: (entityId, data) => {
    setSkipUndoCapture(true)
    try {
      set((state) => {
        let touched = false
        const patchKeys = Object.keys(data)
        const nodes = state.nodes.map((node) => {
          const d = node.data as Record<string, unknown>
          if (d.pipeline_entity_id !== entityId) return node
          const dataRec = data as Record<string, unknown>
          const noChange = patchKeys.every((k) => d[k] === dataRec[k])
          if (noChange) return node
          touched = true
          return { ...node, data: { ...d, ...data } as SceneNodeData }
        })
        if (!touched) return state
        return { nodes }
      })
    } finally {
      setSkipUndoCapture(false)
    }
  },

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

    // Capture user memory snapshot for AI nodes (factory ← admin ← memory).
    // Skip exec-only updates (polling/results) and unchanged snapshots so a held
    // slider doesn't thrash localStorage.
    if (!isExecOnly) {
      const userId = getCachedUserId()
      if (userId) {
        const node = get().nodes.find((n) => n.id === nodeId)
        if (node && isNodeDefaultType(node.type)) {
          const snapshot = pickRelevantFields(node.type, node.data as Record<string, unknown>)
          if (Object.keys(snapshot).length > 0) {
            const existing = readMemory(userId)[node.type]
            if (!existing || JSON.stringify(existing) !== JSON.stringify(snapshot)) {
              rememberSelection(userId, node.type, snapshot)
            }
          }
        }
      }
    }
  },

  updateNodeWithData: (nodeId, nodeUpdates, dataUpdates) => {
    if (!get().nodes.some((n) => n.id === nodeId)) return

    const dataKeys = Object.keys(dataUpdates)
    const isExecOnly =
      dataKeys.length > 0 && dataKeys.every((k) => EXECUTION_DATA_KEYS.has(k))
    // Stricter than updateNodeData's `every()` (vacuously true on empty) —
    // empty dataUpdates must NOT suppress undo capture.

    if (isExecOnly) setSkipUndoCapture(true)
    try {
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                ...nodeUpdates,
                data:
                  dataKeys.length > 0
                    ? ({ ...n.data, ...dataUpdates } as SceneNodeData)
                    : n.data,
              }
            : n,
        ),
        isDirty: true,
      }))
    } finally {
      if (isExecOnly) setSkipUndoCapture(false)
    }
  },

  duplicateNode: (nodeId, position) =>
    set((state) => {
      const source = state.nodes.find((n) => n.id === nodeId)
      if (!source) return state

      // Spread the full source node (preserves measured, style, width, height,
      // className — same as copy+paste) then override id, position, data.
      const newId = generateNodeId()

      // If the source node is a child of a group (has parentId) and the parent
      // is NOT also being duplicated, drop parentId and convert local→world
      // coords so the duplicate lands beside the original on the canvas. See
      // spec §4.4 (copy/paste paragraph).
      let parentId = source.parentId
      let sourcePosition = source.position
      if (parentId) {
        const parentNode = state.nodes.find((n) => n.id === parentId)
        if (parentNode) {
          sourcePosition = {
            x: source.position.x + parentNode.position.x,
            y: source.position.y + parentNode.position.y,
          }
        }
        parentId = undefined
      }

      const newNode: WorkflowNode = {
        ...source,
        id: newId,
        parentId,
        position: position ?? {
          x: sourcePosition.x + 50,
          y: sourcePosition.y + 50,
        },
        data: buildDuplicatedNodeData(source),
        selected: false,
      }

      return {
        nodes: [...state.nodes, newNode],
        newNodeIds: new Set([...state.newNodeIds, newId]),
        isDirty: true,
      }
    }),

  duplicateNodes: (ids) =>
    set((state) => {
      const idSet = new Set(ids)
      const sources = state.nodes.filter((n) => idSet.has(n.id))
      if (sources.length === 0) return state

      // Map old id → new id (and loop/list column handle remappings) so edges
      // BETWEEN the duplicated nodes can be recreated pointing at the clones.
      // Build the full id map FIRST (before cloning) so a loop/list column's
      // connectedSourceId can be re-pointed even when its source appears later
      // in the selection than the loop node.
      const idMap: Record<string, string> = {}
      for (const source of sources) idMap[source.id] = generateNodeId()
      const handleMap: Record<string, string> = {}
      const clones: WorkflowNode[] = sources.map((source) => ({
        ...source,
        id: idMap[source.id],
        position: { x: source.position.x + 50, y: source.position.y + 50 },
        data: buildDuplicatedNodeData(source, handleMap, idMap),
        selected: true,
      }))

      // Only recreate edges whose BOTH endpoints are in the duplicated set.
      // Node ids remap via idMap; loop/list column handles via handleMap (other
      // handle ids like "out"/"image"/"characterRef" are stable and pass through).
      //
      // Picker source-handle migration: a legacy null/undefined sourceHandle
      // on an edge originating from a picker node would otherwise carry
      // through to the clone as-is — the load-time migration only runs in
      // `loadWorkflow`, not on duplicate/Ctrl+V, so an in-memory legacy
      // edge stays uncleanable after duplication. Run the same
      // backfill here using the source node's type (read from the
      // ORIGINAL source, which is what idMap was keyed off — the clone has
      // the same type). `migratePickerSourceHandle` is a no-op when
      // sourceHandle is already set, so it's safe to call unconditionally.
      const sourceTypeById = new Map(sources.map((s) => [s.id, s.type ?? ""]))
      const lookupSourceType = (cloneId: string): string | undefined => {
        // Reverse-lookup: cloneId → original id → type.
        for (const [origId, mappedId] of Object.entries(idMap)) {
          if (mappedId === cloneId) return sourceTypeById.get(origId)
        }
        return undefined
      }
      const newEdges: WorkflowEdge[] = state.edges
        .filter((e) => idSet.has(e.source) && idSet.has(e.target))
        .map((e) => {
          const cloned: WorkflowEdge = {
            ...e,
            id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            source: idMap[e.source],
            target: idMap[e.target],
            sourceHandle: e.sourceHandle && handleMap[e.sourceHandle] ? handleMap[e.sourceHandle] : e.sourceHandle,
            targetHandle: e.targetHandle && handleMap[e.targetHandle] ? handleMap[e.targetHandle] : e.targetHandle,
          }
          return migratePickerSourceHandle(cloned, lookupSourceType)
        })

      return {
        // Deselect the originals and select the clones, so the new copies become
        // the active selection — a repeated Ctrl+D then cascades (next copies at
        // +50 from the clones, not stacked on the originals) and the user can
        // drag the copies immediately. selectedNodeId is cleared since a
        // multi-selection has no single config-panel target.
        nodes: [
          ...state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
          ...clones,
        ],
        edges: [...state.edges, ...newEdges],
        newNodeIds: new Set([...state.newNodeIds, ...clones.map((c) => c.id)]),
        selectedNodeId: null,
        isDirty: true,
      }
    }),

  deleteNode: (nodeId) =>
    set((state) => {
      const deletedNode = state.nodes.find((n) => n.id === nodeId)
      let remainingNodes = state.nodes.filter((n) => n.id !== nodeId)

      // Deleting a group must detach its children (clear parentId + restore
      // world coords) — otherwise they keep a dangling parentId and React Flow
      // logs "parent not found" + teleports them to origin. The RF-native
      // onNodesDelete path (handleNodesDelete) already does this, but the
      // context-menu / config-panel / programmatic delete routes call
      // deleteNode directly and bypass it.
      if (deletedNode?.type === "group") {
        remainingNodes = remainingNodes.map((n) =>
          n.parentId === nodeId
            ? { ...n, parentId: undefined, position: localToWorld(n.position, deletedNode.position) }
            : n,
        )
      }

      // Clear connectedSourceId on list columns that referenced the deleted node
      remainingNodes = remainingNodes.map((n) => {
        if (n.type !== "list") return n
        const loopData = n.data as LoopNodeData
        const hasConnected = (loopData.columns ?? []).some((c) => c.connectedSourceId === nodeId)
        if (!hasConnected) return n
        const updatedColumns = (loopData.columns ?? []).map((col) =>
          col.connectedSourceId === nodeId
            ? { ...col, connectedSourceId: undefined, connectedSourceHandle: undefined }
            : col,
        )
        return { ...n, data: { ...n.data, columns: updatedColumns } }
      })

      const remainingNodeIds = new Set(remainingNodes.map((n) => n.id))
      const ps = state.presentationSettings
      const updatedPs = {
        ...ps,
        ...(ps.inputItems ? { inputItems: cleanOrphanedItems(ps.inputItems, remainingNodeIds) } : {}),
        ...(ps.outputItems ? { outputItems: cleanOrphanedItems(ps.outputItems, remainingNodeIds) } : {}),
      }
      return {
        nodes: remainingNodes,
        edges: state.edges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId,
        ),
        selectedNodeId:
          state.selectedNodeId === nodeId ? null : state.selectedNodeId,
        presentationSettings: updatedPs,
        isDirty: true,
      }
    }),

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

      // BOTH cleanups can apply in the same delete and they MUST compose:
      //  1. Loop-column cleanup (clears `connectedSourceId` on the column
      //     whose `_in` edge we just removed). Handle-specific — runs
      //     regardless of any parallel edges between the same node pair on
      //     OTHER handles.
      //  2. fieldMappings cleanup (strips entries whose `sourceNodeId`
      //     equals the now-disconnected source). Node-pair scoped — only
      //     runs when the (source, target) pair has no other surviving
      //     wires, since fieldMappings are keyed by sourceNodeId.
      //
      // A previous version early-returned after loop cleanup, which dropped
      // fieldMappings cleanup when both arms applied to the same node
      // (e.g. a single edge that's both the last wire AND a `_in` handle).
      // The unified body below applies both edits to a single `mutated`
      // node-data object so we touch the node at most once.
      const isLoopColumnEdge =
        removedEdge.targetHandle?.endsWith("_in") ?? false

      const stillConnected = newEdges.some(
        (e) => e.target === removedEdge.target && e.source === removedEdge.source,
      )

      // (3) Parallel-order field cleanup. combine-videos / combine-audio /
      // mix-audio / merge-video-audio / generate-image carry a parallel
      // `data.<field>Order` of source nodeIds that the runtime honors at
      // execution. When we delete an edge AND no other edge between the
      // same (source, target) survives on the same handle, the deleted
      // source's nodeId becomes a stale entry — handled gracefully at
      // runtime (skipped), but if enough entries become stale the
      // resulting ordered list may drop below the 2-entry minimum and
      // fall back to default order. Filter the nodeId out proactively.
      const targetNode = state.nodes.find((n) => n.id === removedEdge.target)
      const parallelOrderField = removedEdge.targetHandle
        ? getParallelOrderField(targetNode?.type, removedEdge.targetHandle, "target")
        : undefined
      const shouldStripParallelOrderEntry =
        parallelOrderField !== undefined && !stillConnected

      // Fast path: neither arm applies — no node mutation needed.
      if (!isLoopColumnEdge && stillConnected && !shouldStripParallelOrderEntry) {
        return { edges: newEdges, isDirty: true }
      }

      const nodes = state.nodes.map((node) => {
        if (node.id !== removedEdge.target) return node

        let mutated: typeof node.data | null = null

        // (1) List column cleanup — unconditional when this is an `_in` edge.
        if (node.type === "list" && isLoopColumnEdge && removedEdge.targetHandle) {
          const loopData = node.data as LoopNodeData
          const baseHandleId = loopColBaseHandle(removedEdge.targetHandle)
          const updatedColumns = (loopData.columns ?? []).map((col) =>
            col.handleId === baseHandleId
              ? { ...col, connectedSourceId: undefined, connectedSourceHandle: undefined }
              : col,
          )
          mutated = { ...node.data, columns: updatedColumns } as SceneNodeData
        }

        // (2) fieldMappings cleanup — only when the node pair is fully
        // disconnected (no parallel wires remain). Reads from `mutated`
        // if loop cleanup already ran so the two edits compose.
        if (!stillConnected) {
          const nodeData = (mutated ?? node.data) as Record<string, unknown>
          const fieldMappings = (nodeData.fieldMappings ?? {}) as Record<string, { sourceNodeId: string }>
          if (Object.keys(fieldMappings).length > 0) {
            const cleanedMappings = Object.fromEntries(
              Object.entries(fieldMappings).filter(([, v]) => v.sourceNodeId !== removedEdge.source)
            )
            mutated = { ...nodeData, fieldMappings: cleanedMappings } as SceneNodeData
          }
        }

        // (3) Parallel-order entry strip — array is sourceNodeId[]; drop
        // the deleted edge's source from it. Preserves the relative order
        // of surviving entries (unlike reorderHandleEdges which clears
        // the whole field because edge-array order becomes authoritative).
        if (shouldStripParallelOrderEntry && parallelOrderField) {
          const nodeData = (mutated ?? node.data) as Record<string, unknown>
          const existingOrder = nodeData[parallelOrderField]
          if (Array.isArray(existingOrder)) {
            const filtered = (existingOrder as string[]).filter((id) => id !== removedEdge.source)
            if (filtered.length !== existingOrder.length) {
              mutated = { ...nodeData, [parallelOrderField]: filtered } as SceneNodeData
            }
          }
        }

        return mutated ? { ...node, data: mutated } : node
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
        // Target already selected. When called from React Flow's
        // onNodesChange handler, the batch already deselected siblings, so
        // a scalar-id sync is enough (fast path). But for programmatic
        // callers (openPickerForNode, scripts, future entry points) that
        // bypass React Flow's selection batching, sibling nodes may still
        // carry `selected: true` from a prior shift-multi-select.
        // selectNode's contract is "select THIS node, deselect all others"
        // — so when other nodes are still selected, we have to clear them
        // even on the already-selected branch.
        const othersSelected = state.nodes.some((n) => n.id !== nodeId && n.selected)
        if (!othersSelected) return { selectedNodeId: nodeId }
        return {
          selectedNodeId: nodeId,
          nodes: state.nodes.map((n) => (n.id === nodeId ? n : n.selected ? { ...n, selected: false } : n)),
        }
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

  setUserTextTemplates: (templates) => set({ userTextTemplates: templates }),

  setFlowPromptTemplates: (templates) => set({ flowPromptTemplates: templates, isDirty: true }),

  loadWorkflow: (id, name, nodes, edges, characterDefinitions, flowPromptTemplates, presentationSettings, viewport) => {
    nextNodeId =
      nodes.reduce((max, n) => {
        const num = parseInt(n.id.replace("node_", ""), 10)
        return isNaN(num) ? max : Math.max(max, num)
      }, 0) + 1

    // Migrate legacy image node types (edit-image, image-to-image → new split types)
    const migratedImageNodes = migrateImageNodes(nodes)

    // Clean up stale loop expansion artifacts.
    const cleaned = filterCloneNodes(migratedImageNodes, edges)
    const cleanedNodes = cleaned.nodes
    // Also drop edges referencing nodes that no longer exist
    const cleanedNodeIds = new Set(cleanedNodes.map((n) => n.id))
    const cleanedEdges = cleaned.edges.filter((e) => cleanedNodeIds.has(e.source) && cleanedNodeIds.has(e.target))

    // Migrate legacy "in" target handles on list nodes (incl. loop-origin
    // migrated nodes) to per-column handles
    // pre-migration block: runs BEFORE migrateListLoopNodes, so must still recognize the legacy "loop" type
    const loopNodeMap = new Map(
      cleanedNodes.filter((n) => n.type === "loop" || n.type === "list").map((n) => [n.id, n])
    )
    let migratedNodes = cleanedNodes
    let migratedEdges = cleanedEdges

    for (const [loopId, loopNode] of loopNodeMap) {
      const inEdges = migratedEdges.filter((e) => e.target === loopId && e.targetHandle === "in")
      if (inEdges.length === 0) continue

      const loopData = loopNode.data as LoopNodeData
      const cols = loopData.columns ?? []

      if (cols.length > 0) {
        // Rewire to first column's target handle
        const firstCol = cols[0]
        migratedEdges = migratedEdges.map((e) =>
          e.target === loopId && e.targetHandle === "in"
            ? { ...e, targetHandle: loopColInputHandle(firstCol.handleId) }
            : e,
        )
        // Set connectedSourceId on first column
        const sourceId = inEdges[0].source
        const sourceHandle = inEdges[0].sourceHandle
        const updatedCols = cols.map((c, i) =>
          i === 0 ? { ...c, connectedSourceId: sourceId, connectedSourceHandle: sourceHandle ?? undefined } : c,
        )
        migratedNodes = migratedNodes.map((n) =>
          n.id === loopId ? { ...n, data: { ...n.data, columns: updatedCols } } : n,
        )
      } else {
        // No columns — just drop the "in" edges
        migratedEdges = migratedEdges.filter((e) => !(e.target === loopId && e.targetHandle === "in"))
      }
    }

    // Validate: drop edges with stale loop column handles
    migratedEdges = migratedEdges.filter((e) => {
      const targetLoop = loopNodeMap.get(e.target)
      if (targetLoop && e.targetHandle?.startsWith("col_") && e.targetHandle !== LOOP_COL_ADD_HANDLE) {
        const baseHandle = loopColBaseHandle(e.targetHandle)
        const cols = ((targetLoop.data as LoopNodeData).columns ?? [])
        return cols.some((c) => c.handleId === baseHandle)
      }
      const sourceLoop = loopNodeMap.get(e.source)
      if (sourceLoop && e.sourceHandle?.startsWith("col_")) {
        const cols = ((sourceLoop.data as LoopNodeData).columns ?? [])
        return cols.some((c) => c.handleId === e.sourceHandle)
      }
      return true
    })

    // Migrate legacy trim-video silent-video sidecar handle: rewrite edges
    // sourcing from "silent-video" to the main "video-out" handle and flip
    // outputSilentVideo on the source node so the main output is silent.
    const trimVideoIdsWithSilentEdge = new Set<string>()
    migratedEdges = migratedEdges.map((e) => {
      if (e.sourceHandle !== "silent-video") return e
      const src = migratedNodes.find((n) => n.id === e.source)
      if (src?.type !== "trim-video") return e
      trimVideoIdsWithSilentEdge.add(e.source)
      return { ...e, sourceHandle: "video-out" }
    })
    if (trimVideoIdsWithSilentEdge.size > 0) {
      migratedNodes = migratedNodes.map((n) =>
        trimVideoIdsWithSilentEdge.has(n.id)
          ? { ...n, data: { ...n.data, outputSilentVideo: true } }
          : n,
      )
    }

    // Migrate legacy ImageToVideoData.autoLoopTrim → loopTrim shape.
    // autoLoopTrim was a VEO-3.1-only boolean; loopTrim is a generic config
    // shape. Default-on for legacy nodes maps to framesToTest=8 (matches the
    // old fixed 8-frame behavior). New users get the new default of 16.
    migratedNodes = migratedNodes.map((n) => {
      if (n.type !== "image-to-video") return n
      const data = n.data as Record<string, unknown>
      if (!("autoLoopTrim" in data)) return n
      // From here: autoLoopTrim present. If loopTrim ALSO present, prefer
      // loopTrim and just drop the orphan autoLoopTrim field. Otherwise
      // synthesize a loopTrim from the boolean.
      const wasOn = data.autoLoopTrim !== false
      const existingLoopTrim = data.loopTrim as
        | { enabled: boolean; framesToTest?: number; quality?: "lossless" | "precise" }
        | undefined
      const newData = { ...n.data } as Record<string, unknown>
      delete newData.autoLoopTrim
      newData.loopTrim = existingLoopTrim ?? (wasOn
        ? { enabled: true, framesToTest: 8, quality: "precise" as const }
        : { enabled: false })
      return { ...n, data: newData as typeof n.data }
    })

    // Migrate legacy ai-writer ("AI Agent") → llm-chat ("Generate Text").
    // One-way, non-destructive. ai-writer defaulted to claude-sonnet-4.6 while
    // llm-chat defaults to gemini-flash, so the effective model is preserved
    // (fallback to claude-sonnet-4.6 when no explicit llmModel was saved) — a
    // migrated node must NOT silently switch to a cheaper/different model. The
    // deprecated `provider`/`model` fields are dropped. ai-writer's text input
    // handle was "in"; llm-chat's is "prompt", so edges targeting a migrated
    // node's "in" handle are remapped. The output handle is "text" on both, so
    // no source-handle remap is needed. templateId/generatedItems/
    // createdNodeIds/generatedResults carry over via the data spread.
    const aiWriterIds = new Set(migratedNodes.filter((n) => (n.type as string) === "ai-writer").map((n) => n.id))
    if (aiWriterIds.size > 0) {
      migratedNodes = migratedNodes.map((n) => {
        if ((n.type as string) !== "ai-writer") return n
        const data = n.data as Record<string, unknown>
        const newData = { ...data } as Record<string, unknown>
        newData.llmModel = (data.llmModel as string | undefined) ?? "claude-sonnet-4.6"
        delete newData.provider
        delete newData.model
        return { ...n, type: "llm-chat" as SceneNodeType, data: newData as typeof n.data }
      })
      migratedEdges = migratedEdges.map((e) =>
        aiWriterIds.has(e.target) && e.targetHandle === "in" ? { ...e, targetHandle: "prompt" } : e,
      )
    }

    // ============================================================
    // Migration ordering invariant: type renames MUST run before any
    // migration that reads `node.type`. The picker null-sourceHandle
    // backfill below reads node.type to dispatch to
    // `getPickerDefaultSourceHandle`, so it MUST run AFTER:
    //   1. ai-writer → llm-chat (type rename, ~L1631 above)
    //   2. Image-to-video field renames (data-only, no type read)
    //   3. Generate Image handles v2 (edge-only, but reads node.type for
    //      source classification — runs AFTER the picker backfill below
    //      because its picker classification relies on the backfilled
    //      sourceHandle).
    // Do not reorder this block without auditing the chain. Keep these
    // comments here next to the migration that depends on the ordering.
    // ============================================================
    //
    // Migrate legacy null/undefined sourceHandle on picker outputs.
    // Before typed source pips landed, picker nodes (tone, mood, lens,
    // text-prompt, etc.) rendered an unidentified <Handle> — outgoing
    // edges saved with `sourceHandle = null`. After the typed-pip
    // migration the source is identified by an explicit handleId
    // (`"prompt"` for text-prompt, `"tone"` for tone, `"out"` for most
    // other pickers — see `getPickerDefaultSourceHandle`).
    //
    // The shared `useHandleConnections` hook does a strict handleId
    // match, so a legacy null-sourceHandle edge would render on the
    // canvas but be INVISIBLE to the popover's connected-rows list
    // (uncleanable via the row's Disconnect button). Backfill the
    // handle id here so every downstream consumer sees a uniform shape.
    //
    // The popover dedup (handle-popover.tsx) keeps a wildcard match for
    // null as a safety net in case any path reaches it before the
    // migration runs.
    //
    // Uses the shared `migratePickerSourceHandle` util — same backfill
    // logic runs in `duplicateNodes` so Ctrl+D doesn't silently
    // re-introduce null-sourceHandle edges that the load-time pass
    // would have cleaned up.
    {
      const nodeTypeById = new Map(migratedNodes.map((n) => [n.id, n.type ?? ""]))
      const lookup = (id: string): string | undefined => nodeTypeById.get(id)
      migratedEdges = migratedEdges.map((e) => migratePickerSourceHandle(e, lookup))
    }

    // Migrate Generate Image handles v2: re-route legacy `in` / `cinematography`
    // / null edges to the new typed handles (`prompt`, `references`, `subjects`,
    // `style`). Zero runtime behavior change — backend resolver classifies by
    // source type regardless of handle ID.
    {
      const result = migrateGenerateImageHandles(migratedNodes, migratedEdges)
      migratedEdges = result.edges
      if (result.pickerEdgesMigrated > 0) {
        try {
          const shown = typeof window !== "undefined" && window.localStorage.getItem("genimg-handles-v2-picker-toast")
          if (!shown) {
            void import("sonner").then(({ toast }) => {
              toast.info("Generate Image picker handles split", {
                description: "Pickers now route by family: aesthetic ones (lens, lighting, style…) on the new Look handle, subject/mood/props (person, animal, mood…) on the new Elements handle. Both tail-append to your prompt at runtime — drag a picker to either handle to use it.",
                duration: 12000,
              })
            }).catch(() => {})
            window.localStorage.setItem("genimg-handles-v2-picker-toast", "1")
          }
        } catch { /* SSR or localStorage unavailable — silently skip */ }
      }
    }

    // Migrate image-to-video + text-to-video → generate-video (Task 4.2).
    // One-way, idempotent: renames node.type, normalizes legacy data fields
    // (connectedRefImageOrder, seedance2InputMode, kling3Mode/Sound), and
    // renames target handle ids (references / in / etc → imageReferences /
    // prompt / etc). Runs AFTER migrateGenerateImageHandles so its edge
    // updates compose on top of the image-handle migration result.
    {
      const result = migrateGenerateVideoNodes(migratedNodes, migratedEdges)
      migratedNodes = result.nodes
      migratedEdges = result.edges
    }

    // Unify legacy `loop` ("Table") nodes into the canonical `list` type and
    // normalize legacy `items` strings. Idempotent; edges unchanged.
    {
      const result = migrateListLoopNodes(migratedNodes, migratedEdges)
      migratedNodes = result.nodes
      migratedEdges = result.edges
    }

    // Migrate legacy audio/text output handle ids to the normalized
    // single-word form, AND rewrite target ids for audio nodes whose
    // primary input was the overloaded `in`. Idempotent. Runs after the
    // generate-video pass so its edge updates compose on top.
    //
    // Source rewrites are gated on the SOURCE node's type so we don't
    // rewrite ids for nodes whose execution-graph reader still expects the
    // legacy id. Target rewrites are gated on the TARGET node's type so
    // renaming an unrelated future node's `in` handle never collides with
    // this pass.
    //
    // NOTE: The 5 ffmpeg-overlapping nodes (merge-video-audio, trim-audio,
    // mix-audio, combine-audio, adjust-volume) are NOT migrated here —
    // their ids were shipped via the #2809 ffmpeg migration with a
    // different design (single `in` retained) and dev's loadWorkflow
    // already handles them via the ffmpeg migration block (if any). Do
    // NOT add entries for them — would silently double-rewrite.
    {
      const SOURCE_REWRITES_BY_TYPE: Record<string, Record<string, string>> = {
        // Batch 1
        "generate-music": { "audio-out": "audio" },
        // Batch 2 — Suno output id normalization
        "suno-add-instrumental": { "audio-out": "audio" },
        "suno-add-vocals":       { "audio-out": "audio" },
        "suno-convert-wav":      { "audio-out": "audio" },
        "suno-mashup":           { "audio-out": "audio" },
        "suno-replace-section":  { "audio-out": "audio" },
        "suno-upload-extend":    { "audio-out": "audio" },
        "suno-music-video":      { "video-out": "video" },
        "suno-style-boost":      { "text-out":  "text"  },
        "suno-separate":         { "vocal-out": "vocals", "instrumental-out": "instrumental" },
        // Batch 4 — Processing output id normalization (non-ffmpeg ones only)
        "split-text":            { "out": "text" },
        // split-media produces dual-typed outputs; map each leg of the
        // legacy `*-out` pair to the new single-word form.
        "split-media":           { "audio-out": "audio", "video-out": "video" },
        // Phase 20 — Image-producer output id normalization. Pre-migration
        // these nodes shipped a single generic `out` source handle; after
        // the typed-handle migration their source pip is the canonical
        // type name (matching IMAGE_PRODUCER_TYPES / VIDEO_PRODUCER_TYPES
        // identity). generate-mask already used `image` + `mask`; image-to-
        // text already used `text` — no entries needed for those.
        "edit-image":        { "out": "image" },
        "modify-image":      { "out": "image" },
        "image-to-image":    { "out": "image" },
        "upscale-image":     { "out": "image" },
        "remove-background": { "out": "image" },
        "face-swap":         { "out": "video" },
        // Phase 21 — Video-producer output id normalization. Only
        // motion-transfer used legacy `out`; the others (video-to-video,
        // video-upscale, extend-video, lip-sync, speech-to-video) already
        // shipped with `video` as the source handle id.
        "motion-transfer":   { "out": "video" },
        // Phase 22 — Upload/source-node output id normalization.
        // upload-image/upload-video/upload-audio already shipped with the
        // canonical type ids (image/video/audio); only reference-audio
        // needs the `audio-out` → `audio` rewrite. youtube-video already
        // uses `video`.
        "reference-audio":   { "audio-out": "audio" },
        // Phase 24c — Compositing-stragglers output id normalization. The
        // 4 ffmpeg-overlapping nodes (speed-ramp, fade-video, transcode-
        // video, manual-edit) shipped with `video-out` source ids; rewrite
        // to `video`. social-media-format had `media-out` + `text-out` —
        // map each to the canonical single-word ids.
        "speed-ramp":          { "video-out": "video" },
        "fade-video":          { "video-out": "video" },
        "transcode-video":     { "video-out": "video" },
        "manual-edit":         { "video-out": "video" },
        "social-media-format": { "media-out": "media", "text-out": "text" },
      }
      const TARGET_REWRITES: Record<string, Record<string, string>> = {
        // Batch 1
        "text-to-speech":   { "in": "prompt" },
        "text-to-audio":    { "in": "prompt" },
        "generate-music":   { "in": "prompt" },
        "audio-isolation":  { "in": "audio" },
        "text-to-dialogue": { "in": "prompt" },
        "voice-changer":    { "in": "audio" },
        "dubbing":          { "in": "audio" },
        // voice-remix / voice-design keep the legacy `audio-style` target id
        // intact — that name is hard-coded in the runtime hint composers
        // (`audio-style-hints.ts`, `sound-aggregator.ts`,
        // `connected-audio-sources.tsx`). Only the legacy `in` migrates.
        "voice-remix":      { "in": "audio" },
        "voice-design":     { "in": "prompt" },
        "forced-alignment": { "in": "audio" },
        // Batch 2 — Suno target id normalization
        "suno-generate":    { "in": "prompt" },
        "suno-lyrics":      { "in": "prompt" },
        "suno-style-boost": { "text": "prompt" },
        // Batch 3 — Script & Text target id normalization
        "generate-script":  { "in": "prompt" },
        "transcribe":       { "in": "audio" },
        // Batch 4 — Processing target id normalization (non-ffmpeg only)
        "combine-text":     { "in": "text" },
        "split-text":       { "in": "text" },
        // split-media: rename legacy `video-in`/`audio-in` → `video`/`audio`.
        "split-media":      { "video-in": "video", "audio-in": "audio" },
        // Phase 20 — Image-producer target id normalization. Only face-swap
        // had a legacy `in` target id needing migration (its video input
        // pip). The others (edit-image, modify-image, image-to-image,
        // generate-mask, upscale-image, remove-background, image-to-text)
        // already used `image` / `mask` / `cinematography` / `face` from
        // pre-migration.
        "face-swap":        { "in": "video" },
        // Phase 21 — Video-producer target id normalization. video-to-
        // video / video-upscale / extend-video / motion-transfer all shipped
        // with a single generic `in` target id. lip-sync used `videoIn`
        // for its video-input slot (image + audio were already the canonical
        // names). speech-to-video shipped with all four typed ids already
        // (cinematography / image / audio / prompt) so no entry needed.
        "video-to-video":   { "in": "video" },
        "video-upscale":    { "in": "video" },
        "extend-video":     { "in": "video" },
        "motion-transfer":  { "in": "video" },
        "lip-sync":         { "videoIn": "video" },
        // Phase 24c — Compositing-stragglers target id normalization.
        // after-effects / motion-graphics / lottie-overlay / video-composer
        // all shipped with a generic `in` target; rewrite to `video` (these
        // nodes apply effects/overlays onto a video source). render-video's
        // `in` target receives the composition plan from the four CompositePlan
        // emitters, so its rename is `in` → `composition`. speed-ramp / fade-
        // video / transcode-video / manual-edit also use `in` → `video`.
        // social-media-format used `media-in` + `text-in`; rename to canonical
        // single-word ids (`media` / `text`).
        "after-effects":       { "in": "video" },
        "motion-graphics":     { "in": "video" },
        "lottie-overlay":      { "in": "video" },
        "video-composer":      { "in": "video" },
        "render-video":        { "in": "composition" },
        "speed-ramp":          { "in": "video" },
        "fade-video":          { "in": "video" },
        "transcode-video":     { "in": "video" },
        // (manual-edit keeps `in` as a multi-asset target — see node file.)
        "social-media-format": { "media-in": "media", "text-in": "text" },
      }
      // Source-type-driven classifier for legacy `in` handles on Suno nodes
      // whose new typed shape splits `in` into `audio` + `prompt`.
      const SUNO_IN_CLASSIFIER_TARGETS: ReadonlySet<string> = new Set([
        "suno-cover", "suno-extend", "suno-replace-section", "suno-upload-extend",
      ])
      // motion-transfer's legacy `in` accepted multi-type connections
      // (image character, video source, optional text prompt). The Phase-21
      // blanket rewrite to `video` loses image+prompt edges, so re-classify
      // by source type here.
      const IMAGE_SOURCE_TYPES_FOR_CLASSIFIER: ReadonlySet<string> = new Set([
        "generate-image", "upload-image", "edit-image", "image-to-image",
        "modify-image", "upscale-image", "remove-background", "generate-mask",
        "face-swap", "scene",
      ])
      // Identity entities route to the `assets` typed handle (mirrors
      // generate-video's assets handle for character/face/object/location).
      const IDENTITY_TYPES_FOR_CLASSIFIER: ReadonlySet<string> = new Set([
        "character", "face", "object", "location",
      ])
      const VIDEO_SOURCE_TYPES_FOR_CLASSIFIER: ReadonlySet<string> = new Set([
        "image-to-video", "text-to-video", "generate-video", "video-to-video",
        "upload-video", "lip-sync", "speech-to-video", "motion-transfer",
        "video-upscale", "extend-video", "video-retake", "suno-music-video",
        "combine-videos", "merge-video-audio", "add-captions", "resize-video",
        "social-media-format", "trim-video", "render-video", "speed-ramp",
        "loop-video", "fade-video", "transcode-video", "manual-edit", "video-sfx",
      ])
      // Suno nodes that have a typed `voice` target — used to route legacy
      // suno-voice → suno-* edges to the right slot. Matches the set of
      // resolvers that wire personaId in input-resolver.ts (excludes
      // suno-upload-extend whose payload-builder doesn't accept personaId).
      const SUNO_VOICE_CAPABLE_TARGETS: ReadonlySet<string> = new Set([
        "suno-generate", "suno-cover", "suno-extend",
      ])
      const AUDIO_SOURCE_TYPES_FOR_CLASSIFIER: ReadonlySet<string> = new Set([
        // Mirrors AUDIO_PRODUCER_TYPES — kept local to avoid circular import
        // from `@nodaro/shared` into the store (which is loaded very early).
        "text-to-speech", "text-to-audio", "generate-music", "upload-audio",
        "suno-generate", "suno-cover", "suno-extend", "suno-separate", "suno-mashup",
        "suno-replace-section", "suno-add-instrumental", "suno-add-vocals",
        "suno-convert-wav", "suno-upload-extend", "trim-audio", "mix-audio",
        "combine-audio", "adjust-volume", "reference-audio", "audio-isolation",
        "text-to-dialogue", "voice-changer", "dubbing", "voice-remix", "voice-design",
        "youtube-video", // backend treats as audio-extractable per input-resolver
      ])
      const nodeTypeById = new Map(migratedNodes.map((n) => [n.id, n.type ?? ""]))
      migratedEdges = migratedEdges.map((e) => {
        let next = e
        const sourceType = nodeTypeById.get(e.source) ?? ""
        const sourceRewrites = SOURCE_REWRITES_BY_TYPE[sourceType]
        if (sourceRewrites) {
          const sh = next.sourceHandle ?? ""
          const newSh = sourceRewrites[sh]
          if (newSh) next = { ...next, sourceHandle: newSh }
        }
        const targetType = nodeTypeById.get(e.target) ?? ""
        const targetRewrites = TARGET_REWRITES[targetType]
        if (targetRewrites) {
          const th = next.targetHandle ?? ""
          const newTh = targetRewrites[th]
          if (newTh) next = { ...next, targetHandle: newTh }
        }
        // Classifier: when the source is suno-voice and the target has a
        // typed `voice` handle (suno-generate / suno-cover / suno-extend),
        // route the persona ref to that handle. Runs after TARGET_REWRITES
        // so even if `in` was already rewritten to `prompt`, we re-route to
        // `voice` for the suno-voice case.
        if (
          sourceType === "suno-voice" &&
          SUNO_VOICE_CAPABLE_TARGETS.has(targetType) &&
          (next.targetHandle === "in" || next.targetHandle === "prompt" || next.targetHandle == null)
        ) {
          next = { ...next, targetHandle: "voice" }
        } else if (SUNO_IN_CLASSIFIER_TARGETS.has(targetType) && (next.targetHandle === "in" || next.targetHandle == null)) {
          // Legacy `in` on suno-cover / suno-extend / suno-replace /
          // suno-upload-extend → `audio` (if source emits audio) else
          // `prompt`. Doesn't fire for suno-voice (handled above).
          const newTh = AUDIO_SOURCE_TYPES_FOR_CLASSIFIER.has(sourceType) ? "audio" : "prompt"
          next = { ...next, targetHandle: newTh }
        } else if (targetType === "motion-transfer" && next.targetHandle === "video") {
          // Phase 21's blanket `in` → `video` rewrite for motion-transfer
          // dropped its multi-type input shape. Re-classify by source so
          // image / assets / prompt edges land on their correct typed handles.
          if (IDENTITY_TYPES_FOR_CLASSIFIER.has(sourceType)) {
            next = { ...next, targetHandle: "assets" }
          } else if (IMAGE_SOURCE_TYPES_FOR_CLASSIFIER.has(sourceType)) {
            next = { ...next, targetHandle: "image" }
          } else if (!VIDEO_SOURCE_TYPES_FOR_CLASSIFIER.has(sourceType)) {
            next = { ...next, targetHandle: "prompt" }
          }
        } else if (
          (targetType === "video-to-video" || targetType === "extend-video") &&
          next.targetHandle === "video" &&
          !VIDEO_SOURCE_TYPES_FOR_CLASSIFIER.has(sourceType)
        ) {
          // Phase 21's `in` → `video` rewrite for video-to-video / extend-video
          // dropped legacy text-source edges (the pre-migration `in` handle
          // accepted prompt input). Re-route non-video sources to `prompt`.
          next = { ...next, targetHandle: "prompt" }
        }
        return next
      })
    }

    // Migrate legacy CharacterNodeData:
    //  - Backfill the Phase-1 Character Studio fields (motions / motionStatus /
    //    voice / personality) on character nodes saved before they existed.
    //  - One-way, non-destructive migration of the deprecated `customVariations`
    //    array into `expressions`: each `{ prompt, url }` whose url is not
    //    already an expression becomes `{ name: prompt.substring(0,50), url }`,
    //    then `customVariations` is emptied. The field itself stays for compat.
    migratedNodes = migratedNodes.map((n) => {
      if (n.type !== "character") return n
      const data = n.data as Record<string, unknown>
      const newData = { ...data } as Record<string, unknown>
      newData.motions = (data.motions as unknown[] | undefined) ?? []
      newData.motionStatus = (data.motionStatus as string | undefined) ?? "idle"
      newData.voice = (data.voice as unknown) ?? null
      newData.personality = (data.personality as unknown) ?? null
      const cv = (data.customVariations ?? []) as Array<{ prompt: string; url: string }>
      if (cv.length > 0) {
        const existing = (data.expressions ?? []) as Array<{ name: string; url: string }>
        const existingUrls = new Set(existing.map((e) => e.url))
        const migrated = cv
          .filter((item) => !existingUrls.has(item.url))
          .map((item) => ({ name: item.prompt.substring(0, 50), url: item.url }))
        newData.expressions = [...existing, ...migrated]
        newData.customVariations = []
      }
      return { ...n, data: newData as typeof n.data }
    })

    // Migrate legacy LocationNodeData:
    //  - Backfill the Phase-2 Location Studio fields (lighting / lightingStatus
    //    / seasons / seasonsStatus / atmosphereMotions / atmosphereStatus /
    //    referencePhotos / canonicalDescription / styleLock) on location nodes
    //    saved before they existed.
    //  - One-way, non-destructive migration of the deprecated `customVariations`
    //    array into `angles`: each `{ prompt, url }` whose url is not already
    //    an angle becomes `{ name: prompt.substring(0,50), url }`, then
    //    `customVariations` is emptied. The field itself stays for compat.
    //  - In-store only — never written back to the DB (the locations table
    //    already has its own canonical columns).
    migratedNodes = migratedNodes.map((n) => {
      if (n.type !== "location") return n
      const data = n.data as Record<string, unknown>
      const newData = { ...data } as Record<string, unknown>
      newData.lighting = (data.lighting as unknown[] | undefined) ?? []
      newData.lightingStatus = (data.lightingStatus as string | undefined) ?? "idle"
      newData.seasons = (data.seasons as unknown[] | undefined) ?? []
      newData.seasonsStatus = (data.seasonsStatus as string | undefined) ?? "idle"
      newData.atmosphereMotions = (data.atmosphereMotions as unknown[] | undefined) ?? []
      newData.atmosphereStatus = (data.atmosphereStatus as string | undefined) ?? "idle"
      newData.referencePhotos = (data.referencePhotos as unknown[] | undefined) ?? []
      newData.canonicalDescription = (data.canonicalDescription as string | undefined) ?? ""
      newData.styleLock = (data.styleLock as boolean | undefined) ?? true
      const cv = (data.customVariations ?? []) as Array<{ prompt: string; url: string }>
      if (cv.length > 0) {
        const existing = (data.angles ?? []) as Array<{ name: string; url: string }>
        const existingUrls = new Set(existing.map((e) => e.url))
        const migrated = cv
          .filter((item) => !existingUrls.has(item.url))
          .map((item) => ({ name: item.prompt.substring(0, 50), url: item.url }))
        newData.angles = [...existing, ...migrated]
        newData.customVariations = []
      }
      return { ...n, data: newData as typeof n.data }
    })

    // Migrate legacy ObjectNodeData (spec Pass 12 F-97 + Pass 6 F-74):
    //  - Backfill the Phase-A Object Studio fields (motionClips / motionStatus
    //    / referencePhotos / canonicalDescription / styleLock) on object
    //    nodes saved before they existed.
    //  - One-way breadcrumb of the deprecated *Id picker fields (animalId /
    //    vehicleId / furnitureId / weaponId) into legacyPickerSelection.
    //    Original *Id fields cleared from data once migrated. Studio
    //    Appearance tab shows a banner until the user wires a picker node OR
    //    dismisses (sets legacyPickerSelection to null).
    //  - Re-migration prevention: the breadcrumb check uses
    //    `legacyPickerSelection === undefined` (NOT `!legacyPickerSelection`)
    //    so an explicit null (user dismissed the banner) is preserved across
    //    loads. A `null` value means "user opted out"; re-migrating would
    //    resurrect a dismissed banner.
    //  - In-store only — workflow JSON carries legacyPickerSelection forward;
    //    the objects DB table has its own canonical columns (DB schema
    //    unaffected by this migration).
    migratedNodes = migratedNodes.map((n) => {
      if (n.type !== "object") return n
      const data = n.data as Record<string, unknown>
      const newData = { ...data } as Record<string, unknown>
      // Field backfill — mirror location's 9-field pattern, scoped to the
      // 5 fields Phase A added to ObjectNodeData.
      newData.motionClips = (data.motionClips as unknown[] | undefined) ?? []
      newData.motionStatus = (data.motionStatus as string | undefined) ?? "idle"
      newData.referencePhotos = (data.referencePhotos as unknown[] | undefined) ?? []
      newData.canonicalDescription = (data.canonicalDescription as string | undefined) ?? ""
      newData.styleLock = (data.styleLock as boolean | undefined) ?? true
      // legacyPickerSelection breadcrumb — first-pass-only, gated on:
      //   1. Field not already set (undefined). `null` is "user dismissed".
      //   2. *Id field non-empty AND matching category.
      if (newData.legacyPickerSelection === undefined) {
        if (data.animalId && data.category === "animal") {
          newData.legacyPickerSelection = { kind: "animal", id: data.animalId as string }
        } else if (data.vehicleId && data.category === "vehicle") {
          newData.legacyPickerSelection = { kind: "vehicle", id: data.vehicleId as string }
        } else if (data.furnitureId && data.category === "furniture") {
          newData.legacyPickerSelection = { kind: "furniture", id: data.furnitureId as string }
        } else if (data.weaponId && data.category === "weapon") {
          newData.legacyPickerSelection = { kind: "weapon", id: data.weaponId as string }
        }
        // Clear *Id fields once migrated so they don't get re-detected later.
        if (newData.legacyPickerSelection !== undefined) {
          newData.animalId = undefined
          newData.vehicleId = undefined
          newData.furnitureId = undefined
          newData.weaponId = undefined
        }
      }
      return { ...n, data: newData as typeof n.data }
    })

    // Strip fixed width from teleport nodes so they auto-size
    migratedNodes = migratedNodes.map((n) =>
      (n.type === "teleport-send" || n.type === "teleport-receive") && n.width
        ? { ...n, width: undefined }
        : n
    )

    // Heal persisted ordering: a group node saved AFTER its children (the order
    // produced when a group is drawn around existing nodes) makes React Flow
    // render the children at ~origin. Reorder parent-first so the store's
    // source of truth — and the next save — is correct.
    migratedNodes = orderNodesParentFirst(migratedNodes)

    set((state) => ({
      workflowId: id,
      workflowName: name,
      nodes: migratedNodes,
      edges: migratedEdges,
      selectedNodeId: null,
      isDirty: false,
      loadGeneration: state.loadGeneration + 1,
      saveStatus: "idle" as SaveStatus,
      saveError: null,
      loadedUpdatedAt: null,
      remoteUpdatedAt: null,
      characterDefinitions: characterDefinitions ?? [],
      flowPromptTemplates: flowPromptTemplates ?? {},
      presentationSettings: presentationSettings ?? DEFAULT_PRESENTATION_SETTINGS,
      savedViewport: viewport ?? null,
    }))
  },

  isWorkflowLoading: false,
  setIsWorkflowLoading: (loading) => set({ isWorkflowLoading: loading }),

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
      loadedUpdatedAt: null,
      remoteUpdatedAt: null,
      characterDefinitions: [],
      flowPromptTemplates: {},
      presentationSettings: DEFAULT_PRESENTATION_SETTINGS,
    }))
  },

  markClean: () => set({ isDirty: false }),

  setSaveStatus: (status, error = null) => set({ saveStatus: status, saveError: error }),

  setLoadedUpdatedAt: (updatedAt) => set({ loadedUpdatedAt: updatedAt }),

  setRemoteUpdatedAt: (updatedAt) => set({ remoteUpdatedAt: updatedAt }),

  applySaveSuccess: (updatedAt) =>
    set({
      loadedUpdatedAt: updatedAt,
      remoteUpdatedAt: null,
      isDirty: false,
      saveStatus: "saved" as SaveStatus,
      saveError: null,
    }),

  reconcileFromRemote: ({ nodes, edges, updatedAt, settings }) => {
    // Unify legacy `loop` ("Table") nodes into the canonical `list` type and
    // normalize legacy `items` strings, exactly as `loadWorkflow` does — a raw
    // `loop` node arriving via realtime would otherwise be mishandled by the
    // now-`list`-only type-sets until a full reload. Idempotent; null/empty-safe.
    const migrated = migrateListLoopNodes(nodes, edges)
    const orderedNodes = orderNodesParentFirst(migrated.nodes)
    const migratedEdges = migrated.edges
    set((state) => {
      // `WorkflowState`'s fields are `readonly` for consumers, but
      // Zustand's `set` accepts a partial-state object — collect the
      // patch in a plain record and cast on return.
      const next: Record<string, unknown> = {
        nodes: orderedNodes,
        edges: migratedEdges,
        isDirty: false,
        loadedUpdatedAt: updatedAt,
        remoteUpdatedAt: null,
        loadGeneration: state.loadGeneration + 1,
      }

      // Clear the selection if the selected node id no longer exists
      // in the remote snapshot — otherwise the config panel renders
      // for a node that was deleted on another device.
      if (state.selectedNodeId) {
        const stillExists = orderedNodes.some((n) => n.id === state.selectedNodeId)
        if (!stillExists) next.selectedNodeId = null
      }

      // Apply persisted settings fields. Tab-local fields (viewport)
      // are intentionally NOT reconciled — each tab keeps its own
      // pan/zoom. Missing fields are left unchanged on this tab.
      // `typeof === "object"` matches arrays too, so each non-array
      // field also rejects arrays explicitly — without that, a payload
      // shaped `{ flowPromptTemplates: [] }` would be cast to
      // `Record<string, string>` and silently overwrite the store.
      if (settings && typeof settings === "object" && !Array.isArray(settings)) {
        const cd = (settings as Record<string, unknown>).characterDefinitions
        if (Array.isArray(cd)) next.characterDefinitions = cd as CharacterDefinition[]
        const ft = (settings as Record<string, unknown>).flowPromptTemplates
        if (ft && typeof ft === "object" && !Array.isArray(ft)) {
          next.flowPromptTemplates = ft as Record<string, string>
        }
        const ps = (settings as Record<string, unknown>).presentationSettings
        if (ps && typeof ps === "object" && !Array.isArray(ps)) {
          next.presentationSettings = ps as PresentationSettings
        }
      }

      return next as Partial<WorkflowState>
    })
  },

  setVideoAutoplay: (autoplay) => {
    if (typeof window !== "undefined") localStorage.setItem("videoAutoplay", String(autoplay))
    set({ videoAutoplay: autoplay })
  },

  openFreeCut: (nodeId, videoUrl, freecutProjectUrl) => set({ freecutEdit: { nodeId, videoUrl, freecutProjectUrl } }),
  closeFreeCut: () => set({ freecutEdit: null }),

  openImageEdit: (nodeId, imageUrl, designStateUrl) => set({ imageEdit: { nodeId, imageUrl, designStateUrl } }),
  closeImageEdit: () => set({ imageEdit: null }),

  setVariableDisplayMode: (mode) => set({ variableDisplayMode: mode }),

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
  openAddNodePopupForHandle: null,
  setOpenAddNodePopupForHandle: (fn) => set({ openAddNodePopupForHandle: fn }),
  hoveredEdgeId: null,
  setHoveredEdgeId: (id) => set({ hoveredEdgeId: id }),
  reorderHandleEdges: (nodeId, handleId, direction, fromIndex, toIndex) =>
    set((state) => {
      // Collect indices of edges connected to this handle in original
      // store order. Reorder them according to from/to; leave all other
      // edges in place.
      const matchingIndices: number[] = []
      state.edges.forEach((e, i) => {
        if (direction === "target" && e.target === nodeId && e.targetHandle === handleId) matchingIndices.push(i)
        else if (direction === "source" && e.source === nodeId && e.sourceHandle === handleId) matchingIndices.push(i)
      })
      if (fromIndex < 0 || fromIndex >= matchingIndices.length) return state
      if (toIndex < 0 || toIndex >= matchingIndices.length) return state
      if (fromIndex === toIndex) return state
      const reorderedMatching = matchingIndices.slice()
      const [moved] = reorderedMatching.splice(fromIndex, 1)
      reorderedMatching.splice(toIndex, 0, moved)
      const newEdges = state.edges.slice()
      matchingIndices.forEach((originalIdx, slot) => {
        newEdges[originalIdx] = state.edges[reorderedMatching[slot]]
      })

      // Side-effect: several consumers carry parallel "order" arrays
      // (populated by their per-node config panel's ConnectedMediaList UI)
      // that the runtime honors FIRST, ahead of edge-array order. If we
      // reorder edges without clearing the parallel array, the popover-
      // reordered sequence is silently ignored at execution. Clear the
      // relevant array so edge-array order (which we just updated)
      // becomes authoritative again.
      let newNodes = state.nodes
      const target = state.nodes.find((n) => n.id === nodeId)
      const parallelOrderField = getParallelOrderField(target?.type, handleId, direction)
      if (parallelOrderField && target) {
        const data = target.data as Record<string, unknown> | undefined
        if (data && parallelOrderField in data) {
          const next = { ...data }
          delete next[parallelOrderField]
          newNodes = state.nodes.map((n) =>
            n.id === nodeId ? { ...n, data: next as typeof n.data } : n,
          )
        }
      }

      return { edges: newEdges, nodes: newNodes, isDirty: true }
    }),
  disconnectAllHandleEdges: (nodeId, handleId, direction) =>
    // Batched mirror of `deleteEdge`'s per-edge cleanup. Previously this
    // called `get().deleteEdge(e.id)` in a loop — N sequential `set()`s
    // re-running React Flow's subscriptions N times per click. We replicate
    // deleteEdge's three responsibilities in ONE set:
    //   1. Filter the matching edges out of `state.edges`.
    //   2. For each removed edge, populate the target's cleanup bucket.
    //      Loop-column refs (cleared when `targetHandle.endsWith("_in")`)
    //      are ALWAYS scheduled — the column is no longer wired through
    //      that handle even if a parallel non-column wire from the same
    //      source survives. fieldMappings entries (keyed by sourceNodeId)
    //      are scheduled ONLY when the (source, target) pair is fully
    //      disconnected by the batch — otherwise a still-valid mapping
    //      would get dropped when one of several parallel wires is removed.
    //   3. Mark dirty.
    // The `stillConnected` check is computed against the FINAL newEdges
    // (not the original edges or any intermediate state), so it stays
    // consistent regardless of which edges we drop in this batch.
    set((state) => {
      const isMatch = (e: WorkflowEdge): boolean =>
        direction === "target"
          ? e.target === nodeId && e.targetHandle === handleId
          : e.source === nodeId && e.sourceHandle === handleId
      const removedEdges = state.edges.filter(isMatch)
      if (removedEdges.length === 0) return state
      const removedIds = new Set(removedEdges.map((e) => e.id))
      const newEdges = state.edges.filter((e) => !removedIds.has(e.id))

      // For each removed edge: collect loop-column cleanups unconditionally
      // (handle-specific), and source-ids for fieldMappings cleanup only
      // when the (source, target) pair is now fully disconnected.
      // Group by target so we touch each node at most once.
      //
      // Cache node-type-by-id lookup so the loop-column heuristic below
      // can gate its `_in` suffix check on the actual loop/list type
      // instead of trusting that any "_in" suffix is a loop column.
      // Without this gate, a future non-loop node that happens to expose
      // a handle id ending in "_in" (e.g., a debug "data_in" handle)
      // would have its handleId passed to loopColBaseHandle and added
      // to the wrong-type cleanup set — silent no-op today but a sharp
      // edge for the next person who defines such a handle.
      const nodeTypeById = new Map(state.nodes.map((n) => [n.id, n.type]))
      const targetCleanups = new Map<string, { sources: Set<string>; loopHandles: Set<string> }>()
      // Helper: get-or-create-and-store the cleanup bucket for `target`.
      // Only invoked from the two branches that actually have cleanup
      // work to add — keeping the create+store paired with the
      // first-write path eliminates the previous orphan-bucket pattern
      // (allocate, maybe-store) that wasted GC on benign-disconnect
      // batches where neither cleanup applied.
      const bucketFor = (target: string) => {
        let b = targetCleanups.get(target)
        if (!b) {
          b = { sources: new Set<string>(), loopHandles: new Set<string>() }
          targetCleanups.set(target, b)
        }
        return b
      }
      for (const removed of removedEdges) {
        // List column cleanup is handle-specific — schedule even if the
        // node pair survives via another (non-column) wire. Gated on the
        // target being an actual list node so the `_in` suffix
        // can't false-positive on other node types.
        if (removed.targetHandle?.endsWith("_in")) {
          const targetType = nodeTypeById.get(removed.target)
          if (targetType === "list") {
            bucketFor(removed.target).loopHandles.add(loopColBaseHandle(removed.targetHandle))
          }
        }
        // fieldMappings cleanup is node-pair scoped — only when nothing
        // else remains between this (source, target).
        const stillConnected = newEdges.some(
          (e) => e.target === removed.target && e.source === removed.source,
        )
        if (!stillConnected) {
          bucketFor(removed.target).sources.add(removed.source)
        }
      }

      // Parallel-order field cleanup — when the disconnected handle has a
      // clipOrder / trackOrder / segmentOrder / referenceImageOrder field
      // on its consumer, force the target into the cleanups map so the
      // post-loop node walk applies the field-clear branch below. Without
      // this, the early-return at targetCleanups.size === 0 would skip
      // disconnects that ONLY need parallel-order cleanup.
      if (direction === "target") {
        const targetType = nodeTypeById.get(nodeId)
        const parallelOrderField = getParallelOrderField(targetType, handleId, direction)
        if (parallelOrderField) {
          bucketFor(nodeId) // ensure cleanup pass visits this node
        }
      }

      if (targetCleanups.size === 0) {
        return { edges: newEdges, isDirty: true }
      }

      const newNodes = state.nodes.map((node) => {
        const cleanup = targetCleanups.get(node.id)
        if (!cleanup) return node

        // BOTH cleanups can apply to the same node in a mixed-batch case:
        // disconnecting a target's "in" handles strips loop column refs
        // AND fieldMappings (the latter for the non-loop handles in the
        // same batch). Track changes to a single `mutated` object so we
        // touch each field at most once and return the same node identity
        // when no cleanup applies.
        let mutated: typeof node.data | null = null

        // List column refs — clear `connectedSourceId` /
        // `connectedSourceHandle` for any column whose handle was in this
        // batch's removed _in edges.
        if (node.type === "list" && cleanup.loopHandles.size > 0) {
          const loopData = node.data as LoopNodeData
          const updatedColumns = (loopData.columns ?? []).map((col) =>
            cleanup.loopHandles.has(col.handleId)
              ? { ...col, connectedSourceId: undefined, connectedSourceHandle: undefined }
              : col,
          )
          mutated = { ...node.data, columns: updatedColumns } as SceneNodeData
        }

        // fieldMappings cleanup — strip every mapping whose sourceNodeId
        // matches one of the removed-and-now-fully-disconnected sources.
        // Reads from `mutated` if loop cleanup already ran so the two
        // edits compose without overwriting each other. Empty `sources`
        // (e.g. when only loop-column cleanup applies for this target)
        // skips this branch entirely.
        if (cleanup.sources.size > 0) {
          const nodeData = (mutated ?? node.data) as Record<string, unknown>
          const fieldMappings = (nodeData.fieldMappings ?? {}) as Record<string, { sourceNodeId: string }>
          if (Object.keys(fieldMappings).length > 0) {
            const cleanedMappings = Object.fromEntries(
              Object.entries(fieldMappings).filter(([, v]) => !cleanup.sources.has(v.sourceNodeId)),
            )
            mutated = { ...nodeData, fieldMappings: cleanedMappings } as SceneNodeData
          }
        }

        // Parallel-order field cleanup — when this disconnect targeted a
        // handle whose consumer carries a clipOrder / trackOrder /
        // segmentOrder / referenceImageOrder array, the array is now
        // entirely stale (no edges left on the handle). Clear the field
        // so the next time edges land, fresh edge-array order is
        // authoritative.
        if (direction === "target") {
          const parallelOrderField = getParallelOrderField(node.type, handleId, direction)
          if (parallelOrderField) {
            const nodeData = (mutated ?? node.data) as Record<string, unknown>
            if (parallelOrderField in nodeData) {
              const next = { ...nodeData }
              delete next[parallelOrderField]
              mutated = next as SceneNodeData
            }
          }
        }

        return mutated ? { ...node, data: mutated } : node
      })

      return { nodes: newNodes, edges: newEdges, isDirty: true }
    }),
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
  // Phase 1B.4 — live-build pipeline lifecycle (see interface JSDoc).
  lastAddedPipelineNodeId: null,
  setLastAddedPipelineNodeId: (id) => set({ lastAddedPipelineNodeId: id }),
  activePipelineStatus: null,
  setActivePipelineStatus: (status) => set({ activePipelineStatus: status }),
  characterStudioNodeId: null,
  setCharacterStudioNodeId: (id) => set({ characterStudioNodeId: id }),
  locationStudioNodeId: null,
  setLocationStudioNodeId: (id) => set({ locationStudioNodeId: id }),
  objectStudioNodeId: null,
  setObjectStudioNodeId: (id) => set({ objectStudioNodeId: id }),
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
    set((state) => {
      const current = state.presentationSettings
      const merged = { ...current, ...settings }
      // Auto-migrate legacy string[] order to PresentationItem[] on first edit
      if (!merged.inputItems && merged.inputOrder) {
        merged.inputItems = migrateToItems(merged.inputOrder)
      }
      if (!merged.outputItems && merged.outputOrder) {
        merged.outputItems = migrateToItems(merged.outputOrder)
      }
      // Validate no nested groups (only when the incoming update touches items)
      if (settings.inputItems && merged.inputItems) {
        merged.inputItems = validateNoNestedGroups(merged.inputItems)
      }
      if (settings.outputItems && merged.outputItems) {
        merged.outputItems = validateNoNestedGroups(merged.outputItems)
      }
      return { presentationSettings: merged, isDirty: true }
    }),

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
        data: { label: channel, channel, channelColor } as TeleportSendData,
      }

      const recvNode: WorkflowNode = {
        id: recvId,
        type: "teleport-receive",
        position: {
          x: (targetNode.position?.x ?? 0) - 180,
          y: targetNode.position?.y ?? 0,
        },
        data: { label: channel, channel, channelColor } as TeleportReceiveData,
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
