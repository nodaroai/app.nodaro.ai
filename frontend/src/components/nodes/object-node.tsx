"use client"

import { memo, useEffect, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Package, Loader2, AlertCircle, X, ImageIcon, Maximize2, Type, Download, Link, Pencil } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { isValidObjectConnection } from "@/lib/identity-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useConnectionCount } from "@/hooks/use-connection-count"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { NodeJobProgress } from "./node-job-progress"
import { PipelineStateOverlay } from "./pipeline-state-overlay"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import type { ObjectNodeData } from "@/types/nodes"

const isPickerType = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_PROMPT = (t: string) => isValidObjectConnection("in",   t, isPickerType)
const ACCEPTS_TYPE   = (t: string) => isValidObjectConnection("type", t, isPickerType)

const STYLE_LABELS: Record<string, string> = {
  realistic: "Realistic",
  anime: "Anime",
  "3d-pixar": "3D Pixar",
  illustration: "Illustration",
}

const CATEGORY_LABELS: Record<string, string> = {
  furniture: "Furniture",
  vehicle: "Vehicle",
  weapon: "Weapon",
  food: "Food",
  clothing: "Clothing",
  electronics: "Electronics",
  nature: "Nature",
  tool: "Tool",
  animal: "Animal",
  other: "Other",
}

function ObjectNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ObjectNodeData
  const credits = useModelCredits((nodeData.provider as string | undefined) ?? "nano-banana", 2)
  const useFull = useFullResolution(id)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const openImageEdit = useWorkflowStore((s) => s.openImageEdit)
  const setObjectStudioNodeId = useWorkflowStore((s) => s.setObjectStudioNodeId)
  // Count of edges wired to the `type` input handle. When this transitions
  // from 0 → ≥1, an upstream picker has just been wired and we auto-clear the
  // legacyPickerSelection breadcrumb per spec Pass 6 F-74 + Pass 12 F-98.
  const typeConnectionCount = useConnectionCount(id, "type")
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  // Per-canvas-node thumbnail override (mirrors character-node.tsx). A
  // Studio-selected default asset or a generated reference sheet wins over the
  // active result, falling back to `sourceImageUrl`.
  const activeUrl = nodeData.defaultAssetUrl || activeResult?.url || nodeData.sourceImageUrl
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const counts = {
    angles: (nodeData.angles ?? []).length,
    materials: (nodeData.materials ?? []).length,
    variations: (nodeData.variations ?? []).length,
    motionClips: (nodeData.motionClips ?? []).length,
    referencePhotos: (nodeData.referencePhotos ?? []).length,
  }
  const anyAssetRunning =
    nodeData.anglesStatus === "running" ||
    nodeData.materialsStatus === "running" ||
    nodeData.variationsStatus === "running" ||
    nodeData.motionStatus === "running"

  // Spec Pass 6 F-74 + Pass 12 F-98 — auto-clear `legacyPickerSelection` on
  // first wire to the `type` input handle. Re-migration is prevented by E1's
  // `=== undefined` guard in `loadWorkflow`, so an explicit `null` here
  // survives next load. Only fires when the breadcrumb is set (non-null +
  // non-undefined) so we don't churn updateNodeData on every render.
  useEffect(() => {
    if (typeConnectionCount > 0 && nodeData.legacyPickerSelection != null) {
      updateNodeData(id, { legacyPickerSelection: null })
    }
  }, [typeConnectionCount, nodeData.legacyPickerSelection, id, updateNodeData])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete))
  }

  return (
    <div className="relative animate-fade-in-scale" style={{ maxWidth: '220px' }}>
    <PipelineStateOverlay
      state={nodeData.pipeline_state}
      isStale={nodeData.is_stale}
    />
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Package className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Package className="h-4 w-4" />}
      category="object"
      credits={credits}
      selected={selected}
      isRunning={status === "running" || anyAssetRunning}
      hideHeader
      topToolbarContent={
                  <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
      }
      handles={[
        { id: "in",        type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
        { id: "type",      type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 56px)', left: '-29px' }, external: true },
        { id: "objectRef", type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
      ]}
    >
      <div className="flex flex-col gap-1.5">
        {/* Object name */}
        {nodeData.objectName && (
          <div className="text-xs font-medium truncate">
            {nodeData.objectName}
          </div>
        )}

        {/* Image preview / status */}
        {status === "running" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-2 h-24 rounded-md bg-muted/30">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          </div>
        )}

        {activeUrl && (
          <div className="relative group">
            <div className="w-full aspect-square rounded-md overflow-hidden bg-muted/30">
              {status === "running" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-md z-10">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
              <CachedImage
                src={activeUrl}
                alt={nodeData.objectName || "Object/Props"}
                className="w-full h-full object-cover cursor-pointer"
                thumbnail={!useFull}
                thumbnailWidth={320}
                onClick={(e) => {
                  e.stopPropagation()
                  setLightboxSrc(activeUrl)
                }}
              />
            </div>
            {/* Save to library button */}
            <div className="absolute bottom-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <SaveToLibraryButton url={activeUrl} type="image" />
            </div>
            {/* Edit image button */}
            <button
              type="button"
              aria-label="Edit image"
              className="absolute bottom-1 right-[73px] w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                openImageEdit(id, activeUrl!, activeResult?.filerobotDesignStateUrl)
              }}
              title="Edit image"
            >
              <Pencil className="w-3 h-3" />
            </button>
            {/* Download button */}
            <button
              type="button"
              aria-label="Download image"
              className="absolute bottom-1 right-[49px] w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                const a = document.createElement('a')
                a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl ?? '')}&download=1`
                a.download = `${nodeData.label || 'image'}.png`
                a.click()
              }}
              title="Download"
            >
              <Download className="w-3 h-3" />
            </button>
            {/* Copy URL button */}
            <button
              type="button"
              aria-label="Copy URL"
              className="absolute bottom-1 right-[25px] w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                copyToClipboard(activeUrl ?? '', "URL copied")
              }}
              title="Copy URL"
            >
              <Link className="w-3 h-3" />
            </button>
            {/* Enlarge button */}
            <button
              type="button"
              className="absolute bottom-1 right-1 w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                setLightboxSrc(activeUrl)
              }}
              title="Enlarge"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
            {results.length > 0 && (
              <button
                type="button"
                aria-label="Remove" className="absolute -top-1 -right-1 w-6 h-6 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteConfirm(activeIndex)
                }}
                title="Delete this result"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {status === "failed" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-1 h-16 rounded-md bg-red-500/5 text-red-500 p-2">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span className="text-xs font-medium">Failed</span>
            </div>
            {nodeData.errorMessage && (
              <p className="text-[9px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                {nodeData.errorMessage}
              </p>
            )}
          </div>
        )}

        {status !== "running" && !activeUrl && status !== "failed" && (
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <ImageIcon className="w-5 h-5" />
          </div>
        )}

        {/* Version history thumbnails */}
        {results.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {results.slice(0, 5).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                <button
                  type="button"
                  className={`w-8 h-8 rounded overflow-hidden cursor-pointer transition-opacity ${
                    i === activeIndex
                      ? "opacity-100 ring-2 ring-primary"
                      : "opacity-50 hover:opacity-80"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    updateNodeData(id, { activeResultIndex: i })
                  }}
                >
                  <CachedImage src={r.url} alt={`v${i + 1}`} className="w-full h-full object-cover" thumbnail thumbnailWidth={80} />
                </button>
                <button
                  type="button"
                  aria-label="Remove" className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(i)
                  }}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Compact 5-bucket asset grid (4 image buckets + 1 video bucket for
            motion clips). referencePhotos has no async status (manual upload
            only) so renders with the same neutral idle state as a 0-count
            badge. */}
        <div className="grid grid-cols-5 gap-1 text-[9px]">
          <AssetBadge icon="📐" label="Angles" count={counts.angles} status={nodeData.anglesStatus ?? "idle"} />
          <AssetBadge icon="🧱" label="Materials" count={counts.materials} status={nodeData.materialsStatus ?? "idle"} />
          <AssetBadge icon="✨" label="Variations" count={counts.variations} status={nodeData.variationsStatus ?? "idle"} />
          <AssetBadge icon="🎬" label="Motion" count={counts.motionClips} status={nodeData.motionStatus ?? "idle"} variant="video" />
          <AssetBadge icon="📷" label="Refs" count={counts.referencePhotos} status="idle" />
        </div>

        {/* Open Studio button */}
        <button
          type="button"
          aria-label="Open Object/Props Studio"
          className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium bg-[#0e3a2e] border border-[#34D39944] text-[#6ee7b7] rounded hover:bg-[#114b3b] transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            setObjectStudioNodeId(id)
          }}
        >
          <span>⬡</span>
          <span>Open Studio</span>
        </button>

        {/* Metadata */}
        <div className="flex justify-between text-muted-foreground text-[10px]">
          <span>{STYLE_LABELS[nodeData.style] ?? nodeData.style}</span>
          <span>{CATEGORY_LABELS[nodeData.category] ?? nodeData.category}</span>
        </div>
      </div>
    </BaseNode>

    <HandleWithPopover nodeId={id} nodeType="object" handleId="in"        type="target" position={Position.Left}  label="Prompt"      color={HANDLE_COLORS.text} icon={<Type />}    side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_PROMPT} />
    <HandleWithPopover nodeId={id} nodeType="object" handleId="type"      type="target" position={Position.Left}  label="Object type" color={HANDLE_COLORS.imageRef} icon={<Package />} side="left"  top="calc(100% - 56px)" accepts={ACCEPTS_TYPE} />
    <HandleWithPopover nodeId={id} nodeType="object" handleId="objectRef" type="source" position={Position.Right} label="Object/Props" color={HANDLE_COLORS.imageRef} icon={<Package />} side="right" top="24px" />

    <DeleteConfirmationDialog
      isOpen={deleteConfirm !== null}
      onClose={() => setDeleteConfirm(null)}
      onConfirm={() => {
        if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
      }}
    />

    <ImageLightbox
      src={lightboxSrc}
      alt={nodeData.objectName || "Object/Props"}
      onClose={() => setLightboxSrc(null)}
    />
    </div>
  )
}

function AssetBadge({
  icon,
  label,
  count,
  status,
  variant = "image",
}: {
  readonly icon: string
  readonly label: string
  readonly count: number
  readonly status: string
  readonly variant?: "image" | "video"
}) {
  if (status === "running") {
    return (
      <span
        title={`${label} — generating`}
        className="flex flex-col items-center gap-0 px-0.5 py-0.5 rounded bg-muted/40"
      >
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        <span className="text-[8px] text-muted-foreground">{label}</span>
      </span>
    )
  }
  const hasItems = count > 0
  // Cap counts > 99 at "99+" so a single rogue source doesn't blow out the
  // 5-col grid. Spec §Canvas asset badges.
  const display = count > 99 ? "99+" : `${count}`
  // Image buckets use emerald (matching the object node accent); video buckets
  // use amber to visually distinguish motion clips from still images.
  const filledClass = variant === "video" ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600"
  return (
    <span
      title={`${label}${hasItems ? ` — ${count}` : ""}`}
      className={`flex flex-col items-center gap-0 px-0.5 py-0.5 rounded ${
        hasItems ? filledClass : "bg-muted/30 text-muted-foreground/40"
      }`}
    >
      <span className="leading-none">{icon}</span>
      <span className="text-[8px] leading-tight">{hasItems ? `${label} ${display}` : label}</span>
    </span>
  )
}

export const ObjectNode = memo(ObjectNodeComponent)
