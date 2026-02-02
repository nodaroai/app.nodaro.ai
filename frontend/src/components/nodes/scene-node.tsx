"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Clapperboard, Users, MapPin, Box, Loader2, AlertCircle, X, Play, Maximize2 } from "lucide-react"
import { BaseNode } from "./base-node"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { SceneEditorModal } from "@/components/editor/scene-editor-modal"
import type { SceneNodeDataType } from "@/types/nodes"

function SceneNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SceneNodeDataType
  const allCharDefs = useWorkflowStore((s) => s.characterDefinitions)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)

  const charCount = nodeData.characters.length
  const objCount = nodeData.objects.length
  const locCount = nodeData.locations?.length ?? 0
  const primaryLoc = nodeData.locations?.find((l) => l.isPrimary) ?? nodeData.locations?.[0]
  const locationAsset = primaryLoc
    ? allCharDefs.find((c) => c.id === primaryLoc.assetId)
    : undefined

  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedImageUrl

  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

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
      generatedImageUrl: newResults[newActiveIndex]?.url ?? "",
    })
  }

  return (
    <div className="relative group/run">
    <BaseNode
      id={id}
      label={nodeData.sceneName || nodeData.label}
      icon={<Clapperboard className="h-4 w-4" />}
      category="scene"
      credits={0}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "prompt", type: "source", position: Position.Right, label: "Prompt", top: "15%" },
        { id: "imageRefs", type: "source", position: Position.Right, label: "Refs", top: "30%" },
        { id: "narration", type: "source", position: Position.Right, label: "Narration", top: "55%" },
        { id: "dialogue", type: "source", position: Position.Right, label: "Dialogue", top: "70%" },
        { id: "duration", type: "source", position: Position.Right, label: "Duration", top: "85%" },
      ]}
    >
      <div className="flex flex-col gap-1.5">
        {/* Generated image or location thumbnail or placeholder */}
        {status === "running" && (
          <div className="flex items-center justify-center h-24 rounded-md bg-muted/30">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {status !== "running" && activeUrl && (
          <div className="relative group">
            <img
              src={activeUrl}
              alt="Scene"
              className="w-full h-24 object-cover rounded-md cursor-pointer hover:opacity-90 transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                setPreviewOpen(true)
              }}
            />
            <div className="absolute top-1 right-1 flex gap-1">
              {results.length > 0 && (
                <button
                  type="button"
                  className="w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full shadow-sm"
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
          </div>
        )}

        {status === "failed" && !activeUrl && (
          <div className="flex items-center justify-center gap-1.5 h-24 rounded-md bg-red-500/5 text-red-500">
            <AlertCircle className="w-5 h-5" />
            <span className="text-xs">Failed</span>
          </div>
        )}

        {status !== "running" && !activeUrl && status !== "failed" && (
          <>
            {locationAsset?.referenceImageUrl ? (
              <img
                src={locationAsset.referenceImageUrl}
                alt={locationAsset.name}
                className="w-full h-20 object-cover rounded-md"
              />
            ) : (
              <div className="flex items-center justify-center h-20 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                <Clapperboard className="w-5 h-5" />
              </div>
            )}
          </>
        )}

        {/* Version history thumbnails */}
        {results.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {results.slice(0, 5).map((r, i) => (
              <div key={r.jobId} className="relative group/thumb shrink-0">
                <img
                  src={r.url}
                  alt={`Result ${i + 1}`}
                  className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${
                    i === activeIndex
                      ? "opacity-100 ring-2 ring-primary"
                      : "opacity-50 hover:opacity-80"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    updateNodeData(id, { activeResultIndex: i, generatedImageUrl: r.url })
                  }}
                />
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

        {/* Summary */}
        {nodeData.summary && (
          <p className="text-[10px] text-muted-foreground line-clamp-2">{nodeData.summary}</p>
        )}

        {/* Metadata row */}
        <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500">
            {nodeData.shotType}
          </span>
          <span className="text-[9px]">{nodeData.duration}s</span>
          {charCount > 0 && (
            <span className="flex items-center gap-0.5 text-[9px]" title={`${charCount} character${charCount !== 1 ? "s" : ""}`}>
              <Users className="w-2.5 h-2.5" /> {charCount}
            </span>
          )}
          {locCount > 0 && (
            <span className="flex items-center gap-0.5 text-[9px]" title={locationAsset?.name ?? `${locCount} location${locCount !== 1 ? "s" : ""}`}>
              <MapPin className="w-2.5 h-2.5" /> {locCount > 1 ? locCount : ""}
            </span>
          )}
          {objCount > 0 && (
            <span className="flex items-center gap-0.5 text-[9px]" title={`${objCount} object${objCount !== 1 ? "s" : ""}`}>
              <Box className="w-2.5 h-2.5" /> {objCount}
            </span>
          )}
        </div>
      </div>
    </BaseNode>

    {/* Run + Expand buttons (hover tab) */}
    {status !== "running" && (
      <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 z-10 opacity-0 group-hover/run:opacity-100 transition-opacity flex gap-0.5">
        <button
          type="button"
          className="flex items-center gap-1 h-6 px-3 text-[11px] font-medium bg-violet-500 hover:bg-violet-600 text-white rounded-bl-md shadow-md transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            runSingleNode?.(id)
          }}
          title="Generate scene image"
        >
          <Play className="w-3 h-3" />
          Run
        </button>
        <button
          type="button"
          className="flex items-center gap-1 h-6 px-2.5 text-[11px] font-medium bg-violet-500/80 hover:bg-violet-600 text-white rounded-br-md shadow-md transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            setEditorOpen(true)
          }}
          title="Expand scene editor"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
      </div>
    )}

    {activeUrl && (
      <MediaPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        type="image"
        url={activeUrl}
      />
    )}
    <DeleteConfirmationDialog
      isOpen={deleteConfirm !== null}
      onClose={() => setDeleteConfirm(null)}
      onConfirm={() => {
        if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
      }}
    />
    <SceneEditorModal
      isOpen={editorOpen}
      onClose={() => setEditorOpen(false)}
      nodeId={id}
    />
    </div>
  )
}

export const SceneNode = memo(SceneNodeComponent)
