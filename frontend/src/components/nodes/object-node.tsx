"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Package, Loader2, AlertCircle, X, ImageIcon, Maximize2, ChevronDown, ChevronRight, Type, Download, Link, Pencil } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useConnectionCount } from "@/hooks/use-connection-count"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { useModelCredits } from "@/hooks/use-model-credits"
import { NodeJobProgress } from "./node-job-progress"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import type { ObjectNodeData } from "@/types/nodes"

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
  const inConnectionCount = useConnectionCount(id)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.sourceImageUrl
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [assetsExpanded, setAssetsExpanded] = useState(false)

  const anglesCount = (nodeData.angles ?? []).length
  const materialsCount = (nodeData.materials ?? []).length
  const variationsCount = (nodeData.variations ?? []).length
  const totalAssets = anglesCount + materialsCount + variationsCount
  const anyAssetRunning = nodeData.anglesStatus === "running" || nodeData.materialsStatus === "running" || nodeData.variationsStatus === "running"

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete))
  }

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
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
        { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
        { id: "objectRef", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
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
                alt={nodeData.objectName || "Object"}
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

        {/* Collapsible asset summary */}
        {(totalAssets > 0 || anyAssetRunning) && (
          <button
            type="button"
            className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              setAssetsExpanded((v) => !v)
            }}
          >
            {assetsExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
            <span>Assets ({totalAssets})</span>
          </button>
        )}

        {assetsExpanded && (
          <div className="flex flex-col gap-1 text-[9px] text-muted-foreground">
            <AssetBadge label="Angles" count={anglesCount} status={nodeData.anglesStatus ?? "idle"} />
            <AssetBadge label="Materials" count={materialsCount} status={nodeData.materialsStatus ?? "idle"} />
            <AssetBadge label="Variations" count={variationsCount} status={nodeData.variationsStatus ?? "idle"} />
          </div>
        )}

        {/* Metadata */}
        <div className="flex justify-between text-muted-foreground text-[10px]">
          <span>{STYLE_LABELS[nodeData.style] ?? nodeData.style}</span>
          <span>{CATEGORY_LABELS[nodeData.category] ?? nodeData.category}</span>
        </div>
      </div>
    </BaseNode>

    {/* Input handle icon */}
    <HandleIcon icon={<Type />} color="pink" side="left" top="calc(100% - 20px)">
      <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#ff0073] text-[#ff0073] text-[8px] font-black flex items-center justify-center">+</div>
      {inConnectionCount >= 2 && (
        <div className="absolute top-1/2 -translate-y-1/2 -right-[9px] w-[13px] h-[13px] rounded-full bg-white text-[#ff0073] text-[8px] font-black flex items-center justify-center">
          {inConnectionCount}
        </div>
      )}
    </HandleIcon>
    {/* Output handle icon */}
    <HandleIcon icon={<Package />} color="pink" side="right" top="20px" />

    <DeleteConfirmationDialog
      isOpen={deleteConfirm !== null}
      onClose={() => setDeleteConfirm(null)}
      onConfirm={() => {
        if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
      }}
    />

    <ImageLightbox
      src={lightboxSrc}
      alt={nodeData.objectName || "Object"}
      onClose={() => setLightboxSrc(null)}
    />
    </div>
  )
}

function AssetBadge({ label, count, status }: { readonly label: string; readonly count: number; readonly status: string }) {
  if (status === "running") {
    return (
      <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-muted/50">
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        {label}
      </span>
    )
  }
  if (count === 0) return null
  return (
    <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-600">
      {label} {count}
    </span>
  )
}

export const ObjectNode = memo(ObjectNodeComponent)
