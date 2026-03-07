"use client"

import { memo, useRef, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ImageIcon, Maximize2, Upload, Link, Loader2, AlertCircle, X } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useFileUpload } from "@/hooks/use-file-upload"
import { StorageExceededModal } from "@/components/credits/StorageExceededModal"
import { CachedImage } from "@/components/ui/cached-image"
import type { UploadImageData } from "@/types/nodes"

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: '50%', left: '-29px' }, hideHandle: true },
  { id: "image", type: "source" as const, position: Position.Right, customStyle: { top: '50%', right: '-29px' }, hideHandle: true },
] as const

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function UploadImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as UploadImageData
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [mode, setMode] = useState<"upload" | "url">(nodeData.externalUrl ? "url" : "upload")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const { upload, isUploading, uploadError, clearError, storageExceeded, clearStorageExceeded } = useFileUpload()

  const imageUrl = nodeData.thumbnailUrl || nodeData.r2Url || nodeData.url
  const hasFile = Boolean(nodeData.r2Url || nodeData.url) && !nodeData.externalUrl

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
      <div className="relative max-w-[220px]">
        {/* Floating label above node */}
        <EditableNodeLabel
          label={nodeData.label}
          icon={<ImageIcon className="w-3.5 h-3.5" />}
          onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
        />
        <BaseNode
          id={id}
          label={nodeData.label}
          icon={<ImageIcon className="h-4 w-4" />}
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
                    <div className="w-full aspect-square rounded-md overflow-hidden bg-muted/30">
                      <CachedImage
                        src={imageUrl}
                        alt={nodeData.filename || "Uploaded image"}
                        className="w-full h-full object-cover"
                        thumbnail
                        thumbnailWidth={480}
                      />
                    </div>
                    <button
                      type="button"
                      aria-label="Enlarge image"
                      className="absolute bottom-1 right-7 w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        setLightboxSrc(imageUrl)
                      }}
                      title="Enlarge"
                    >
                      <Maximize2 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove image"
                      className="absolute bottom-1 right-1 w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-red-600/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
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
                      accept="image/png,image/jpeg,image/webp,image/gif"
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
                      <span className="text-xs">Choose Image</span>
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
                {nodeData.externalUrl && (
                  <div className="relative mt-2 w-full aspect-video rounded-md overflow-hidden bg-muted/30">
                    <CachedImage
                      src={nodeData.externalUrl}
                      alt="External image"
                      className="w-full h-full object-cover"
                      thumbnail
                      thumbnailWidth={480}
                    />
                  </div>
                )}
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
        <HandleIcon icon={<ImageIcon />} color="cyan" side="left" />
        <HandleIcon icon={<ImageIcon />} />
      </div>

      <ImageLightbox
        src={lightboxSrc}
        alt={nodeData.filename || "Uploaded image"}
        onClose={() => setLightboxSrc(null)}
      />

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

export const UploadImageNode = memo(UploadImageNodeComponent)
