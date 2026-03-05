"use client"

import { memo, useRef, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Music, Upload, Link, Loader2, AlertCircle, X } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useFileUpload } from "@/hooks/use-file-upload"
import { StorageExceededModal } from "@/components/credits/StorageExceededModal"
import type { UploadAudioData } from "@/types/nodes"

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: '50%', left: '-6px' }, hideHandle: true },
  { id: "audio", type: "source" as const, position: Position.Right, customStyle: { top: '50%', right: '-29px' }, hideHandle: true },
] as const

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

function UploadAudioNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as UploadAudioData
  const [mode, setMode] = useState<"upload" | "url">(nodeData.externalUrl ? "url" : "upload")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const { upload, isUploading, uploadError, clearError, storageExceeded, clearStorageExceeded } = useFileUpload()

  const audioUrl = nodeData.r2Url || nodeData.url
  const hasFile = Boolean(audioUrl) && !nodeData.externalUrl

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    clearError()
    updateNodeData(id, { isUploading: true, uploadError: "" })

    try {
      const result = await upload(file)
      updateNodeData(id, {
        assetId: result.assetId ?? "",
        url: result.url,
        r2Url: result.url,
        filename: result.filename,
        fileSize: result.sizeBytes,
        mimeType: result.mimeType,
        metadata: result.metadata ?? {},
        isUploading: false,
        uploadError: "",
        externalUrl: "",
      })
    } catch {
      updateNodeData(id, {
        isUploading: false,
        uploadError: uploadError ?? "Upload failed",
      })
    }

    e.target.value = ""
  }

  const handleUrlChange = (url: string) => {
    updateNodeData(id, {
      externalUrl: url,
      url: url,
      r2Url: "",
      assetId: "",
      filename: "",
      fileSize: 0,
      mimeType: "",
      metadata: {},
    })
  }

  const handleClear = () => {
    updateNodeData(id, {
      assetId: "",
      url: "",
      r2Url: "",
      filename: "",
      fileSize: 0,
      mimeType: "",
      externalUrl: "",
      metadata: {},
      uploadError: "",
    })
  }

  return (
    <>
    <div className="relative max-w-[220px]">
      {/* Floating label above node */}
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
        <div className="p-3">
          {/* Uploading state */}
          {(isUploading || nodeData.isUploading) && (
            <div className="flex flex-col items-center gap-2 py-3">
              <Loader2 className="w-5 h-5 animate-spin text-[#38BDF8]" />
              <p className="text-xs text-muted-foreground">Uploading...</p>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-[#38BDF8] rounded-full animate-pulse" style={{ width: "60%" }} />
              </div>
            </div>
          )}

          {/* Error state */}
          {!isUploading && !nodeData.isUploading && (uploadError || nodeData.uploadError) && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-red-500/10 text-red-400 text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{uploadError || nodeData.uploadError}</span>
            </div>
          )}

          {/* Upload mode */}
          {!isUploading && !nodeData.isUploading && mode === "upload" && (
            <>
              {hasFile ? (
                <div className="relative group">
                  <div className="w-full rounded-md bg-muted/30 p-3 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#38BDF8]/10 flex items-center justify-center shrink-0">
                      <Music className="w-5 h-5 text-[#38BDF8]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground truncate">{nodeData.filename || "Audio file"}</p>
                      <div className="flex gap-2 text-[10px] text-muted-foreground/60 mt-0.5">
                        {nodeData.fileSize > 0 && <span>{formatBytes(nodeData.fileSize)}</span>}
                        {nodeData.metadata?.durationSeconds && nodeData.metadata.durationSeconds > 0 && (
                          <span>{formatDuration(nodeData.metadata.durationSeconds)}</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Remove audio"
                      className="w-5 h-5 flex items-center justify-center hover:bg-red-600/20 text-muted-foreground/40 hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-all shrink-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleClear()
                      }}
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <input
                    type="file"
                    accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/webm"
                    onChange={handleFileSelect}
                    className="hidden"
                    ref={fileInputRef}
                  />
                  <button
                    type="button"
                    className="w-full flex items-center justify-center gap-2 h-16 rounded-md border-2 border-dashed border-muted-foreground/20 hover:border-[#38BDF8]/50 hover:bg-[#38BDF8]/5 text-muted-foreground/60 hover:text-[#38BDF8] transition-colors cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      fileInputRef.current?.click()
                    }}
                  >
                    <Upload className="w-4 h-4" />
                    <span className="text-xs">Choose Audio</span>
                  </button>
                </>
              )}
              <button
                type="button"
                className="w-full text-center text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors mt-1"
                onClick={(e) => {
                  e.stopPropagation()
                  setMode("url")
                }}
              >
                or use URL
              </button>
            </>
          )}

          {/* URL mode */}
          {!isUploading && !nodeData.isUploading && mode === "url" && (
            <>
              <div className="flex items-center gap-1.5">
                <Link className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                <input
                  type="text"
                  value={nodeData.externalUrl || nodeData.url || ""}
                  onChange={(e) => {
                    e.stopPropagation()
                    handleUrlChange(e.target.value)
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="https://..."
                  className="w-full bg-transparent border-b border-muted-foreground/20 text-xs py-1 outline-none focus:border-[#38BDF8] transition-colors placeholder:text-muted-foreground/30"
                />
              </div>
              <button
                type="button"
                className="w-full text-center text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors mt-1"
                onClick={(e) => {
                  e.stopPropagation()
                  setMode("upload")
                }}
              >
                or upload file
              </button>
            </>
          )}
        </div>
      </BaseNode>
      <HandleIcon icon={<Music />} />
    </div>

    <StorageExceededModal
      open={storageExceeded.exceeded}
      onClose={clearStorageExceeded}
      usedBytes={storageExceeded.usedBytes}
      quotaBytes={storageExceeded.quotaBytes}
      tier={storageExceeded.tier}
    />
    </>
  )
}

export const UploadAudioNode = memo(UploadAudioNodeComponent)
