"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Package, Loader2, AlertCircle, X, Play, ImageIcon, Maximize2, ChevronDown, ChevronRight } from "lucide-react"
import { BaseNode } from "./base-node"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
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
  other: "Other",
}

function ObjectNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ObjectNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
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
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) {
      newActiveIndex = 0
    } else if (indexToDelete < activeIndex) {
      newActiveIndex = activeIndex - 1
    }
    updateNodeData(id, {
      generatedResults: newResults,
      activeResultIndex: newActiveIndex,
    })
  }

  return (
    <div className="relative group/run" style={{ width: activeUrl ? 220 : 200 }}>
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Package className="h-4 w-4" />}
      category="object"
      credits={5}
      selected={selected}
      isRunning={status === "running" || anyAssetRunning}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "objectRef", type: "source", position: Position.Right, label: "Object" },
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
          <div className="flex items-center justify-center h-24 rounded-md bg-muted/30">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
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
              <img
                src={activeUrl}
                alt={nodeData.objectName || "Object"}
                className="w-full h-full object-cover cursor-pointer"
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
                className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
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
                  <img src={r.url} alt={`v${i + 1}`} className="w-full h-full object-cover" />
                </button>
                <button
                  type="button"
                  className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
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

    {/* Run button - Delete is only available via Object Page modal */}
    {status !== "running" && (
      <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 z-10 opacity-0 group-hover/run:opacity-100 transition-opacity">
        <button
          type="button"
          className="flex items-center gap-1 h-6 px-3 text-[11px] font-medium bg-emerald-500 hover:bg-emerald-600 text-white rounded-b-md shadow-md transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            runSingleNode?.(id)
          }}
          title="Generate object image"
        >
          <Play className="w-3 h-3" />
          Run
        </button>
      </div>
    )}

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
