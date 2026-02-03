"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { MapPin, Loader2, AlertCircle, X, Play, ImageIcon, Maximize2, ChevronDown, ChevronRight } from "lucide-react"
import { BaseNode } from "./base-node"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import type { LocationNodeData } from "@/types/nodes"

const STYLE_LABELS: Record<string, string> = {
  realistic: "Realistic",
  anime: "Anime",
  "3d-pixar": "3D Pixar",
  illustration: "Illustration",
}

const CATEGORY_LABELS: Record<string, string> = {
  indoor: "Indoor",
  outdoor: "Outdoor",
  urban: "Urban",
  nature: "Nature",
  fantasy: "Fantasy",
  "sci-fi": "Sci-Fi",
  historical: "Historical",
  futuristic: "Futuristic",
  other: "Other",
}

function LocationNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LocationNodeData
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

  const timeOfDayCount = (nodeData.timeOfDay ?? []).length
  const weatherCount = (nodeData.weather ?? []).length
  const anglesCount = (nodeData.angles ?? []).length
  const totalAssets = timeOfDayCount + weatherCount + anglesCount
  const anyAssetRunning = nodeData.timeOfDayStatus === "running" || nodeData.weatherStatus === "running" || nodeData.anglesStatus === "running"

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
      icon={<MapPin className="h-4 w-4" />}
      category="location"
      credits={5}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "locationRef", type: "source", position: Position.Right, label: "Location" },
      ]}
    >
      <div className="flex flex-col gap-1.5">
        {/* Location name */}
        {nodeData.locationName && (
          <div className="text-xs font-medium truncate">
            {nodeData.locationName}
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
                alt={nodeData.locationName || "Location"}
                className="w-full h-full object-cover cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  setLightboxSrc(activeUrl)
                }}
              />
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
          <div className="flex items-center justify-center gap-1.5 h-16 rounded-md bg-red-500/5 text-red-500">
            <AlertCircle className="w-4 h-4" />
            <span className="text-xs">Failed</span>
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
              <div key={r.jobId} className="relative group/thumb shrink-0">
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
            <AssetBadge label="Time of Day" count={timeOfDayCount} status={nodeData.timeOfDayStatus ?? "idle"} />
            <AssetBadge label="Weather" count={weatherCount} status={nodeData.weatherStatus ?? "idle"} />
            <AssetBadge label="Angles" count={anglesCount} status={nodeData.anglesStatus ?? "idle"} />
          </div>
        )}

        {/* Metadata */}
        <div className="flex justify-between text-muted-foreground text-[10px]">
          <span>{STYLE_LABELS[nodeData.style] ?? nodeData.style}</span>
          <span>{CATEGORY_LABELS[nodeData.category] ?? nodeData.category}</span>
        </div>
      </div>
    </BaseNode>

    {/* Run button - Delete is only available via Location Page modal */}
    {status !== "running" && (
      <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 z-10 opacity-0 group-hover/run:opacity-100 transition-opacity">
        <button
          type="button"
          className="flex items-center gap-1 h-6 px-3 text-[11px] font-medium bg-cyan-500 hover:bg-cyan-600 text-white rounded-b-md shadow-md transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            runSingleNode?.(id)
          }}
          title="Generate location image"
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
      alt={nodeData.locationName || "Location"}
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
    <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-600">
      {label} {count}
    </span>
  )
}

export const LocationNode = memo(LocationNodeComponent)
