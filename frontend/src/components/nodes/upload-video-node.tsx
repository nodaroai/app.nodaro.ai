"use client"

import { memo, useRef, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Video, Upload, Link, Loader2, AlertCircle, X, Play } from "lucide-react"
import { BaseNode } from "./base-node"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useFileUpload } from "@/hooks/use-file-upload"
import { StorageExceededModal } from "@/components/credits/StorageExceededModal"
import { CachedImage } from "@/components/ui/cached-image"
import type { UploadVideoData } from "@/types/nodes"

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

function UploadVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as UploadVideoData
  const [mode, setMode] = useState<"upload" | "url">(nodeData.externalUrl ? "url" : "upload")
  const [previewOpen, setPreviewOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const { upload, isUploading, uploadError, clearError, storageExceeded, clearStorageExceeded } = useFileUpload()

  const videoUrl = nodeData.r2Url || nodeData.url
  const thumbnailUrl = nodeData.thumbnailUrl
  const hasFile = Boolean(videoUrl) && !nodeData.externalUrl

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
        thumbnailUrl: result.thumbnailUrl ?? "",
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
      thumbnailUrl: "",
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
      thumbnailUrl: "",
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
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Video className="h-4 w-4" />}
      category="input"
      credits={0}
      selected={selected}
      handles={[
        { id: "video", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      {/* Uploading state */}
      {(isUploading || nodeData.isUploading) && (
        <div className="flex flex-col items-center gap-2 py-3">
          <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
          <p className="text-xs text-muted-foreground">Uploading...</p>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: "60%" }} />
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
              {thumbnailUrl ? (
                <div
                  className="w-full aspect-video rounded-md overflow-hidden bg-muted/30 relative cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPreviewOpen(true)
                  }}
                >
                  <CachedImage
                    src={thumbnailUrl}
                    alt={nodeData.filename || "Video thumbnail"}
                    className="w-full h-full object-cover"
                    thumbnail
                    thumbnailWidth={480}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                      <Play className="w-4 h-4 text-white ml-0.5" />
                    </div>
                  </div>
                </div>
              ) : videoUrl ? (
                <div
                  className="w-full aspect-video rounded-md overflow-hidden bg-muted/30 relative cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPreviewOpen(true)
                  }}
                >
                  <video
                    src={videoUrl}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                      <Play className="w-4 h-4 text-white ml-0.5" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="w-full aspect-video rounded-md bg-muted/30 flex items-center justify-center">
                  <Video className="w-6 h-6 text-muted-foreground/40" />
                </div>
              )}
              <button
                type="button"
                className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-red-600/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  handleClear()
                }}
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
              {nodeData.filename && (
                <div className="mt-1.5 space-y-0.5">
                  <p className="text-[10px] text-muted-foreground truncate">{nodeData.filename}</p>
                  <div className="flex gap-2 text-[10px] text-muted-foreground/60">
                    {nodeData.fileSize > 0 && <span>{formatBytes(nodeData.fileSize)}</span>}
                    {nodeData.metadata?.durationSeconds && nodeData.metadata.durationSeconds > 0 && (
                      <span>{formatDuration(nodeData.metadata.durationSeconds)}</span>
                    )}
                    {nodeData.metadata?.width && nodeData.metadata?.height && (
                      <span>{nodeData.metadata.width} x {nodeData.metadata.height}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
                onChange={handleFileSelect}
                className="hidden"
                ref={fileInputRef}
              />
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 h-16 rounded-md border-2 border-dashed border-muted-foreground/20 hover:border-blue-400/50 hover:bg-blue-400/5 text-muted-foreground/60 hover:text-blue-400 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  fileInputRef.current?.click()
                }}
              >
                <Upload className="w-4 h-4" />
                <span className="text-xs">Choose Video</span>
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
              className="w-full bg-transparent border-b border-muted-foreground/20 text-xs py-1 outline-none focus:border-blue-400 transition-colors placeholder:text-muted-foreground/30"
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
    </BaseNode>
    {videoUrl && (
      <MediaPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        type="video"
        url={videoUrl}
      />
    )}

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

export const UploadVideoNode = memo(UploadVideoNodeComponent)
