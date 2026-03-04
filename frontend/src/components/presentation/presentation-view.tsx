/**
 * PresentationView — premium dark futuristic presentation mode.
 * Two-column layout with resizable split, drag-to-reorder cards,
 * frosted glass cards, and dark theme forced on.
 *
 * Works in both "tab" mode (inside editor) and "fullscreen" mode (shared link).
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { Play, Loader2, ExternalLink, Plus, X, Pencil, Eye, GripVertical } from "lucide-react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { CreditBalance } from "@/components/credits/CreditBalance"
import { hasCredits } from "@/lib/edition"
import { useAuth } from "@/hooks/use-auth"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import type { WorkflowNode } from "@/types/nodes"
import {
  getInputNodes,
  getOutputNodes,
  getOutputType,
  getNodeLabel,
  getNodeResult,
} from "@/lib/presentation-utils"
import { NODE_CREDIT_COSTS, EXECUTABLE_TYPES } from "@/components/editor/workflow-editor/types"
import { ShareDialog } from "./share-dialog"
import { NodePickerDialog } from "./node-picker-dialog"
import { RunTargetSelector } from "./run-target-selector"
import { TextInputCard } from "./input-cards/text-input-card"
import { ImageUploadCard } from "./input-cards/image-upload-card"
import { VideoUploadCard } from "./input-cards/video-upload-card"
import { AudioUploadCard } from "./input-cards/audio-upload-card"
import { ParameterCard } from "./input-cards/parameter-card"
import { ImageOutputCard } from "./output-cards/image-output-card"
import { VideoOutputCard } from "./output-cards/video-output-card"
import { AudioOutputCard } from "./output-cards/audio-output-card"
import { TextOutputCard } from "./output-cards/text-output-card"

// Hoisted static styles to avoid re-allocation on every render
const ROOT_BG_STYLE = {
  background: "radial-gradient(ellipse at 50% 0%, rgba(255,0,115,0.04) 0%, #0a0a0f 70%)",
} as const
const RUN_BUTTON_STYLE = {
  background: "linear-gradient(135deg, #ff0073, #ff3d9a)",
  boxShadow: "0 0 15px rgba(255,0,115,0.3)",
} as const
const RUNNING_BUTTON_STYLE = {
  background: "linear-gradient(135deg, #ff0073, #ff3d9a)",
  boxShadow: "0 0 20px rgba(255,0,115,0.4)",
} as const
const POINTER_ACTIVATION = { activationConstraint: { distance: 5 } } as const
const CONTAINER_MIN_HEIGHT = { minHeight: 400 } as const

/** Reorder nodes by an ID array, appending any new nodes at the end */
function orderNodesByIds(nodes: WorkflowNode[], order: string[] | undefined): WorkflowNode[] {
  if (!order || order.length === 0) return nodes
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const ordered: WorkflowNode[] = []
  for (const id of order) {
    const node = nodeMap.get(id)
    if (node) {
      ordered.push(node)
      nodeMap.delete(id)
    }
  }
  for (const node of nodeMap.values()) ordered.push(node)
  return ordered
}

interface PresentationViewProps {
  mode: "tab" | "fullscreen"
  isOwner: boolean
  onExitFullscreen?: () => void
}

export function PresentationView({ mode, isOwner, onExitFullscreen }: PresentationViewProps) {
  const { user } = useAuth()
  const [isEditMode, setIsEditMode] = useState(false)
  const [pickerSection, setPickerSection] = useState<"inputs" | "outputs" | null>(null)

  const isEditing = isEditMode && mode === "tab"

  // Tab mode: read from the editor store
  const editorNodes = useWorkflowStore((s) => s.nodes)
  const editorEdges = useWorkflowStore((s) => s.edges)
  const editorName = useWorkflowStore((s) => s.workflowName)
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const presentationSettings = useWorkflowStore((s) => s.presentationSettings)
  const updatePresentationSettings = useWorkflowStore((s) => s.updatePresentationSettings)

  // Fullscreen mode: read from presentation store
  const presNodes = usePresentationStore((s) => s.nodes)
  const presEdges = usePresentationStore((s) => s.edges)
  const presName = usePresentationStore((s) => s.workflowName)
  const presStatus = usePresentationStore((s) => s.executionStatus)
  const presNodeStates = usePresentationStore((s) => s.nodeStates)
  const presRun = usePresentationStore((s) => s.run)
  const presInputValues = usePresentationStore((s) => s.inputValues)
  const presUpdateInput = usePresentationStore((s) => s.updateInputValue)
  const presEstimatedCost = usePresentationStore((s) => s.estimatedCost)
  const presPresentationSettings = usePresentationStore((s) => s.presentationSettings)

  const isFullscreen = mode === "fullscreen"
  const nodes = isFullscreen ? presNodes : editorNodes
  const edges = isFullscreen ? presEdges : editorEdges
  const workflowName = isFullscreen ? presName : editorName
  const settings = isFullscreen ? presPresentationSettings : presentationSettings

  // Curated nodes, ordered by saved order
  const inputNodes = useMemo(() => getInputNodes(nodes, true), [nodes])
  const outputNodes = useMemo(() => getOutputNodes(nodes, edges, true), [nodes, edges])
  const orderedInputNodes = useMemo(() => orderNodesByIds(inputNodes, settings.inputOrder), [inputNodes, settings.inputOrder])
  const orderedOutputNodes = useMemo(() => orderNodesByIds(outputNodes, settings.outputOrder), [outputNodes, settings.outputOrder])

  // Estimate credit cost
  const tabEstimatedCost = useMemo(() => {
    if (isFullscreen) return 0
    let total = 0
    for (const node of nodes) {
      if (node.type && EXECUTABLE_TYPES.has(node.type)) {
        total += NODE_CREDIT_COSTS[node.type] ?? 0
      }
    }
    return total
  }, [isFullscreen, nodes])

  const estimatedCost = isFullscreen ? presEstimatedCost : tabEstimatedCost

  // Running state
  const isEditorRunning = useWorkflowStore((s) => {
    if (isFullscreen) return false
    return s.nodes.some((n) => {
      const data = n.data as Record<string, unknown>
      return data.executionStatus === "running" || data.executionStatus === "loading"
    })
  })
  const isRunning = isFullscreen ? presStatus === "running" : isEditorRunning

  const handleRunClick = useCallback(() => {
    if (isFullscreen) presRun()
  }, [isFullscreen, presRun])

  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      updateNodeData(nodeId, { presentationVisible: false })
    },
    [updateNodeData],
  )

  // Node execution status
  const getNodeStatus = useCallback(
    (nodeId: string): "idle" | "running" | "completed" | "failed" => {
      if (isFullscreen) {
        const state = presNodeStates[nodeId]
        if (!state) return "idle"
        if (state.status === "running") return "running"
        if (state.status === "completed") return "completed"
        if (state.status === "failed") return "failed"
        return "idle"
      }
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return "idle"
      const data = node.data as Record<string, unknown>
      const status = data.executionStatus as string | undefined
      if (status === "running" || status === "loading") return "running"
      if (status === "complete" || status === "completed") return "completed"
      if (status === "error") return "failed"
      return "idle"
    },
    [isFullscreen, presNodeStates, nodes],
  )

  const getFullscreenResult = useCallback(
    (nodeId: string) => {
      const state = presNodeStates[nodeId]
      if (!state?.output) return { url: undefined, text: undefined }
      const output = state.output as Record<string, unknown>
      const url = (output.imageUrl ?? output.videoUrl ?? output.audioUrl) as string | undefined
      const text = output.text as string | undefined
      return { url, text }
    },
    [presNodeStates],
  )

  // Resizable split — with cleanup on unmount
  const splitRatio = settings.splitRatio ?? 50
  const containerRef = useRef<HTMLDivElement>(null)
  const isDraggingDivider = useRef(false)
  const dividerCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => { dividerCleanupRef.current?.() }
  }, [])

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingDivider.current = true

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingDivider.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const ratio = Math.round(((ev.clientX - rect.left) / rect.width) * 100)
      const clamped = Math.max(20, Math.min(80, ratio))
      updatePresentationSettings({ splitRatio: clamped })
    }

    const handleMouseUp = () => {
      isDraggingDivider.current = false
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      dividerCleanupRef.current = null
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
    dividerCleanupRef.current = handleMouseUp
  }, [updatePresentationSettings])

  // Drag-to-reorder
  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_ACTIVATION),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const makeDragEndHandler = useCallback(
    (orderedNodes: WorkflowNode[], settingsKey: "inputOrder" | "outputOrder") =>
      (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const ids = orderedNodes.map((n) => n.id)
        const oldIndex = ids.indexOf(active.id as string)
        const newIndex = ids.indexOf(over.id as string)
        if (oldIndex === -1 || newIndex === -1) return
        updatePresentationSettings({ [settingsKey]: arrayMove(ids, oldIndex, newIndex) })
      },
    [updatePresentationSettings],
  )

  const handleInputDragEnd = useMemo(
    () => makeDragEndHandler(orderedInputNodes, "inputOrder"),
    [makeDragEndHandler, orderedInputNodes],
  )
  const handleOutputDragEnd = useMemo(
    () => makeDragEndHandler(orderedOutputNodes, "outputOrder"),
    [makeDragEndHandler, orderedOutputNodes],
  )

  // Card meta helpers
  const getCardTitle = useCallback((node: WorkflowNode) => {
    return settings.cardMeta?.[node.id]?.title || getNodeLabel(node)
  }, [settings.cardMeta])

  const updateCardMeta = useCallback((nodeId: string, field: "title" | "description", value: string) => {
    const current = settings.cardMeta ?? {}
    updatePresentationSettings({
      cardMeta: {
        ...current,
        [nodeId]: { ...current[nodeId], [field]: value },
      },
    })
  }, [settings.cardMeta, updatePresentationSettings])

  const costLabel = hasCredits() && estimatedCost > 0 ? ` (${estimatedCost} CR)` : ""

  const leftColumnStyle = useMemo(() => ({ width: `${splitRatio}%` }), [splitRatio])
  const rightColumnStyle = useMemo(() => ({ width: `${100 - splitRatio}%` }), [splitRatio])

  return (
    <div className="dark h-full flex flex-col bg-[#0a0a0f] text-white" style={ROOT_BG_STYLE}>
      {/* Header — glass morphism */}
      <div className="flex items-center justify-between px-4 sm:px-6 h-14 border-b border-white/10 bg-white/[0.03] backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold truncate bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            {workflowName || "Untitled"}
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {user && hasCredits() && <CreditBalance userId={user.id} />}

          {/* Edit/View toggle */}
          {isOwner && mode === "tab" && (
            <Button
              variant={isEditMode ? "default" : "outline"}
              size="sm"
              onClick={() => setIsEditMode(!isEditMode)}
              className={isEditMode ? "" : "border-white/10 text-white/70 hover:text-white hover:bg-white/10"}
              title={isEditMode ? "Switch to view mode" : "Edit presentation"}
            >
              {isEditMode ? (
                <><Eye className="h-4 w-4 mr-1" />View</>
              ) : (
                <><Pencil className="h-4 w-4 mr-1" />Edit</>
              )}
            </Button>
          )}

          {isEditing && <RunTargetSelector />}

          {isOwner && mode === "tab" && workflowId && (
            <ShareDialog workflowId={workflowId} />
          )}

          {mode === "tab" && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExitFullscreen}
              title="Open in new tab"
              className="border-white/10 text-white/70 hover:text-white hover:bg-white/10"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}

          {/* Run button with glow */}
          {isRunning ? (
            <button
              type="button"
              className="h-8 px-4 rounded-full text-sm font-medium text-white flex items-center gap-2 animate-pulse"
              style={RUNNING_BUTTON_STYLE}
              disabled
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Running...
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRunClick}
              className="h-8 px-4 rounded-full text-sm font-medium text-white flex items-center gap-2 hover:opacity-90 transition-all duration-200"
              style={RUN_BUTTON_STYLE}
              disabled={!isFullscreen && mode === "tab"}
            >
              <Play className="h-4 w-4" />
              Run{costLabel}
            </button>
          )}
        </div>
      </div>

      {/* Content: split layout */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div ref={containerRef} className="max-w-7xl mx-auto flex gap-0 h-full" style={CONTAINER_MIN_HEIGHT}>
          {/* Inputs column */}
          <div className="overflow-y-auto pr-3" style={leftColumnStyle}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] bg-gradient-to-r from-white to-white/50 bg-clip-text text-transparent">
                  In
                </h2>
                {isEditing && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-white/10 text-white/60 hover:text-white hover:bg-white/10"
                    onClick={() => setPickerSection("inputs")}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                )}
              </div>
              {orderedInputNodes.length === 0 ? (
                <div className="text-xs text-white/20 p-6 border border-dashed border-white/10 rounded-xl text-center">
                  {isEditing ? "Click \"Add\" to select input nodes" : "No inputs configured"}
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleInputDragEnd}>
                  <SortableContext items={orderedInputNodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
                    {orderedInputNodes.map((node) => (
                      <SortableCardWrapper
                        key={node.id}
                        id={node.id}
                        isEditMode={isEditing}
                        onRemove={() => handleRemoveNode(node.id)}
                        cardDescription={settings.cardMeta?.[node.id]?.description}
                        onDescriptionChange={(v) => updateCardMeta(node.id, "description", v)}
                      >
                        <InputCard
                          node={node}
                          isFullscreen={isFullscreen}
                          inputValues={presInputValues}
                          onUpdateInput={presUpdateInput}
                        />
                      </SortableCardWrapper>
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>

          {/* Resizable divider — visible in edit mode */}
          <div
            className={`relative shrink-0 flex items-center justify-center ${
              isEditing ? "w-4 cursor-col-resize group" : "w-4"
            }`}
            onMouseDown={isEditing ? handleDividerMouseDown : undefined}
          >
            {isEditing && (
              <>
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-[#ff0073]/30 group-hover:bg-[#ff0073]/60 transition-colors" />
                <div className="relative z-10 w-3 h-8 rounded-full bg-[#ff0073]/20 group-hover:bg-[#ff0073]/40 border border-[#ff0073]/30 flex items-center justify-center transition-colors">
                  <div className="w-0.5 h-3 bg-[#ff0073]/60 rounded-full" />
                </div>
              </>
            )}
          </div>

          {/* Outputs column */}
          <div className="overflow-y-auto pl-3" style={rightColumnStyle}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] bg-gradient-to-r from-white to-white/50 bg-clip-text text-transparent">
                  Out
                </h2>
                {isEditing && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-white/10 text-white/60 hover:text-white hover:bg-white/10"
                    onClick={() => setPickerSection("outputs")}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                )}
              </div>
              {orderedOutputNodes.length === 0 ? (
                <div className="text-xs text-white/20 p-6 border border-dashed border-white/10 rounded-xl text-center">
                  {isEditing ? "Click \"Add\" to select output nodes" : "No outputs configured"}
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleOutputDragEnd}>
                  <SortableContext items={orderedOutputNodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
                    {orderedOutputNodes.map((node) => {
                      const outputType = getOutputType(node.type)
                      const status = getNodeStatus(node.id)
                      const result = isFullscreen
                        ? getFullscreenResult(node.id)
                        : getNodeResult(node.data as Record<string, unknown>)

                      return (
                        <SortableCardWrapper
                          key={node.id}
                          id={node.id}
                          isEditMode={isEditing}
                          onRemove={() => handleRemoveNode(node.id)}
                          cardDescription={settings.cardMeta?.[node.id]?.description}
                          onDescriptionChange={(v) => updateCardMeta(node.id, "description", v)}
                        >
                          <OutputCard
                            label={getCardTitle(node)}
                            outputType={outputType}
                            status={status}
                            url={result.url}
                            text={result.text}
                          />
                        </SortableCardWrapper>
                      )
                    })}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Node picker dialog */}
      {pickerSection && (
        <NodePickerDialog
          open
          onOpenChange={(open) => { if (!open) setPickerSection(null) }}
          section={pickerSection}
        />
      )}
    </div>
  )
}

/** Sortable card wrapper with grip handle, remove button, and description editing */
function SortableCardWrapper({
  id,
  isEditMode,
  onRemove,
  cardDescription,
  onDescriptionChange,
  children,
}: {
  id: string
  isEditMode: boolean
  onRemove: () => void
  cardDescription?: string
  onDescriptionChange: (value: string) => void
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="relative group mb-4">
      {isEditMode && (
        <>
          {/* Drag handle */}
          <div
            {...attributes}
            {...listeners}
            className="absolute -left-6 top-4 w-5 h-5 flex items-center justify-center text-white/20 hover:text-white/50 cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="w-4 h-4" />
          </div>
          {/* Remove button */}
          <button
            onClick={onRemove}
            className="absolute -top-2 -right-2 z-10 hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full bg-red-500/80 text-white hover:bg-red-500 transition-colors"
            title="Remove from presentation"
          >
            <X className="h-3 w-3" />
          </button>
        </>
      )}

      {children}

      {/* Editable description below card — edit mode only */}
      {isEditMode && (
        <div className="mt-1 px-1">
          <input
            type="text"
            value={cardDescription ?? ""}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Add description..."
            className="w-full bg-transparent border-none text-[11px] text-white/25 placeholder:text-white/15 focus:text-white/50 focus:outline-none"
          />
        </div>
      )}

      {/* Show description in view mode if set */}
      {!isEditMode && cardDescription && (
        <p className="mt-1 px-1 text-[11px] text-white/30">{cardDescription}</p>
      )}
    </div>
  )
}

/** Renders the appropriate input card based on node type */
function InputCard({
  node,
  isFullscreen,
  inputValues,
  onUpdateInput,
}: {
  node: WorkflowNode
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
}) {
  const label = getNodeLabel(node)
  const data = node.data as Record<string, unknown>

  switch (node.type) {
    case "text-prompt":
      return (
        <TextInputCard
          label={label}
          value={isFullscreen ? (inputValues[node.id]?.text as string ?? data.text as string ?? "") : (data.text as string ?? "")}
          placeholder={(data.placeholder as string) ?? "Enter text..."}
          onChange={(val) => {
            if (isFullscreen) {
              onUpdateInput(node.id, "text", val)
            } else {
              useWorkflowStore.getState().updateNodeData(node.id, { text: val })
            }
          }}
        />
      )

    case "upload-image":
      return (
        <ImageUploadCard
          label={label}
          url={(data.url as string) ?? undefined}
          nodeId={node.id}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
        />
      )

    case "upload-video":
      return (
        <VideoUploadCard
          label={label}
          url={(data.url as string) ?? undefined}
          nodeId={node.id}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
        />
      )

    case "upload-audio":
      return (
        <AudioUploadCard
          label={label}
          url={(data.url as string) ?? undefined}
          nodeId={node.id}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
        />
      )

    default:
      return (
        <ParameterCard
          nodeId={node.id}
          label={label}
          nodeType={node.type!}
          data={data}
          isFullscreen={isFullscreen}
          inputValues={inputValues}
          onUpdateInput={onUpdateInput}
        />
      )
  }
}

/** Renders the appropriate output card based on output type */
function OutputCard({
  label,
  outputType,
  status,
  url,
  text,
}: {
  label: string
  outputType: string
  status: "idle" | "running" | "completed" | "failed"
  url?: string
  text?: string
}) {
  switch (outputType) {
    case "image":
      return <ImageOutputCard label={label} status={status} url={url} />
    case "video":
      return <VideoOutputCard label={label} status={status} url={url} />
    case "audio":
      return <AudioOutputCard label={label} status={status} url={url} />
    case "text":
      return <TextOutputCard label={label} status={status} text={text} />
    default:
      return <TextOutputCard label={label} status={status} text={text ?? url} />
  }
}
