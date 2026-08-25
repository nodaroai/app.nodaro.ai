"use client"

import { memo, useEffect, useRef } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Music, Volume2, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { runYouTubeAudioExtraction } from "@/lib/youtube-audio-extraction"
import type { ReferenceAudioData } from "@/types/nodes"

const HANDLES = [
  { id: "in",    type: "target" as const, position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
  { id: "audio", type: "source" as const, position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
] as const

function ReferenceAudioNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ReferenceAudioData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const useFull = useFullResolution(id)
  const status = nodeData.extractionStatus ?? "idle"
  const hasAudio = Boolean(nodeData.extractedAudioUrl)
  const hasThumbnail = Boolean(nodeData.videoThumbnail)

  // Auto-extract a pristine YouTube source. The config panel's Extract button
  // only exists while the panel is mounted, so a node whose `youtubeUrl` was
  // written from OUTSIDE the panel — the copilot copying a user-pasted link,
  // an imported workflow, a template — would otherwise sit silent and resolve
  // to nothing at run time. This runs wherever the node is rendered. Fires
  // from "idle" only: a failed extraction keeps its manual retry (no loop),
  // and an edited URL keeps the panel's explicit re-extract behavior.
  const extractingRef = useRef(false)
  const youtubeUrl = nodeData.youtubeUrl?.trim()
  const directUrl = nodeData.directUrl?.trim()
  const sourceType = nodeData.sourceType || "youtube"
  useEffect(() => {
    if (hasAudio || status !== "idle") return
    // A direct file link needs no job — the panel's Set button just copies it.
    if (sourceType === "url" && directUrl) {
      updateNodeData(id, { extractedAudioUrl: directUrl, extractionStatus: "ready" })
      return
    }
    if (sourceType !== "youtube" || !youtubeUrl) return
    if (extractingRef.current) return
    extractingRef.current = true
    updateNodeData(id, { extractionStatus: "extracting" })
    void runYouTubeAudioExtraction(youtubeUrl)
      .then((audioUrl) => updateNodeData(id, { extractedAudioUrl: audioUrl, extractionStatus: "ready" }))
      .catch(() => updateNodeData(id, { extractionStatus: "failed" }))
      .finally(() => {
        extractingRef.current = false
      })
  }, [sourceType, youtubeUrl, directUrl, hasAudio, status, id, updateNodeData])

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Music className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Music className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        minWidth={220}
        hideHeader
        handles={HANDLES}
      >
        <div className="p-3 flex flex-col gap-1">
          {hasThumbnail ? (
            <div className="w-full rounded overflow-hidden border border-border">
              <CachedImage src={nodeData.videoThumbnail} alt="" className="w-full aspect-video object-cover" thumbnail={!useFull} thumbnailWidth={320} />
            </div>
          ) : (
            <div className="flex items-center justify-center w-full h-12 rounded border border-dashed border-muted-foreground/30 text-muted-foreground/40">
              <Music className="w-4 h-4" />
            </div>
          )}
          {nodeData.videoTitle && (
            <p className="text-[9px] text-muted-foreground truncate">{nodeData.videoTitle}</p>
          )}
          <div className="flex items-center gap-1">
            {status === "ready" && hasAudio && <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />}
            {status === "extracting" && <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-500" />}
            {status === "failed" && <AlertCircle className="w-2.5 h-2.5 text-red-500" />}
            <span className="text-[9px] text-muted-foreground">
              {nodeData.sourceType === "youtube" ? "YT" : "File"}
            </span>
          </div>
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="reference-audio" handleId="in"    type="target" position={Position.Left}  label="URL"   color={TEXT_HANDLE_COLOR} icon={<Music />}   side="left"  top="calc(100% - 24px)" />
      <HandleWithPopover nodeId={id} nodeType="reference-audio" handleId="audio" type="source" position={Position.Right} label="Audio" color={HANDLE_COLORS.audio} icon={<Volume2 />} side="right" top="24px" />
    </div>
  )
}

export const ReferenceAudioNode = memo(ReferenceAudioNodeComponent)
