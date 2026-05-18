"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { MapPin, Loader2, AlertCircle, X, ImageIcon, Maximize2, Type, Download, Link, Pencil, Aperture } from "lucide-react"
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
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { NodeJobProgress } from "./node-job-progress"
import { PipelineStateOverlay } from "./pipeline-state-overlay"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
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
  const credits = useModelCredits((nodeData.provider as string | undefined) ?? "nano-banana", 2)
  const useFull = useFullResolution(id)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const openImageEdit = useWorkflowStore((s) => s.openImageEdit)
  const setLocationStudioNodeId = useWorkflowStore((s) => s.setLocationStudioNodeId)
  const inConnectionCount = useConnectionCount(id)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.sourceImageUrl
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const counts = {
    timeOfDay: (nodeData.timeOfDay ?? []).length,
    weather: (nodeData.weather ?? []).length,
    seasons: (nodeData.seasons ?? []).length,
    angles: (nodeData.angles ?? []).length,
    lighting: (nodeData.lighting ?? []).length,
  }
  const anyAssetRunning =
    nodeData.timeOfDayStatus === "running" ||
    nodeData.weatherStatus === "running" ||
    nodeData.seasonsStatus === "running" ||
    nodeData.anglesStatus === "running" ||
    nodeData.lightingStatus === "running"

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
      icon={<MapPin className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<MapPin className="h-4 w-4" />}
      category="location"
      credits={credits}
      selected={selected}
      isRunning={status === "running" || anyAssetRunning}
      hideHeader
      topToolbarContent={
                  <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
      }
      handles={[
        { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
        { id: "cinematography", type: "target", position: Position.Left, customStyle: { top: '20px', left: '-29px' }, hideHandle: true },
        { id: "locationRef", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
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
                alt={nodeData.locationName || "Location"}
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

        {/* Compact 5-bucket asset grid (atmosphere badge defers to PR-2) */}
        <div className="grid grid-cols-5 gap-1 text-[9px]">
          <AssetBadge icon="🌅" label="TOD" count={counts.timeOfDay} status={nodeData.timeOfDayStatus ?? "idle"} />
          <AssetBadge icon="🌧" label="Weather" count={counts.weather} status={nodeData.weatherStatus ?? "idle"} />
          <AssetBadge icon="🍁" label="Seasons" count={counts.seasons} status={nodeData.seasonsStatus ?? "idle"} />
          <AssetBadge icon="📐" label="Angles" count={counts.angles} status={nodeData.anglesStatus ?? "idle"} />
          <AssetBadge icon="💡" label="Lighting" count={counts.lighting} status={nodeData.lightingStatus ?? "idle"} />
        </div>

        {/* Open Studio button */}
        <button
          type="button"
          aria-label="Open Location Studio"
          className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium bg-[#0e3a4a] border border-[#22D3EE44] text-[#67e8f9] rounded hover:bg-[#114b5f] transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            setLocationStudioNodeId(id)
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

    {/* Input handle icon */}
    <HandleIcon icon={<Type />} color="pink" side="left" top="calc(100% - 20px)">
      <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#ff0073] text-[#ff0073] text-[8px] font-black flex items-center justify-center">+</div>
      {inConnectionCount >= 2 && (
        <div className="absolute top-1/2 -translate-y-1/2 -right-[9px] w-[13px] h-[13px] rounded-full bg-white text-[#ff0073] text-[8px] font-black flex items-center justify-center">
          {inConnectionCount}
        </div>
      )}
    </HandleIcon>
    {/* Cinematography input handle icon */}
    <HandleIcon icon={<Aperture />} color="indigo" side="left" top="20px" label="Cinematography" />
    {/* Output handle icon */}
    <HandleIcon icon={<MapPin />} color="pink" side="right" top="20px" />

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

function AssetBadge({ icon, label, count, status }: { readonly icon: string; readonly label: string; readonly count: number; readonly status: string }) {
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
  return (
    <span
      title={`${label}${hasItems ? ` — ${count}` : ""}`}
      className={`flex flex-col items-center gap-0 px-0.5 py-0.5 rounded ${
        hasItems ? "bg-cyan-500/10 text-cyan-600" : "bg-muted/30 text-muted-foreground/40"
      }`}
    >
      <span className="leading-none">{icon}</span>
      <span className="text-[8px] leading-tight">{hasItems ? `${label} ${count}` : label}</span>
    </span>
  )
}

export const LocationNode = memo(LocationNodeComponent)
