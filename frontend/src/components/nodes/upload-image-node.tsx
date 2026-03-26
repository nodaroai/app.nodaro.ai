"use client"

import { memo, useRef, useState, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ImageIcon, Maximize2, Upload, Link, Download, Loader2, AlertCircle, X, Pencil, LayoutGrid } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useMediaEditor, MediaEditorModal } from "@/components/editor/media-editor"
import { StorageExceededModal } from "@/components/credits/StorageExceededModal"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { copyToClipboard } from "@/lib/utils"
import type { UploadImageData, GeneratedResult } from "@/types/nodes"

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
  { id: "image", type: "source" as const, position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
] as const

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function UploadImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as UploadImageData
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [mode, setMode] = useState<"upload" | "url">(nodeData.externalUrl ? "url" : "upload")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const openImageEdit = useWorkflowStore((s) => s.openImageEdit)
  const { upload, isUploading, uploadError, clearError, storageExceeded, clearStorageExceeded } = useFileUpload()
  const mediaEditor = useMediaEditor({
    onComplete: async (results) => {
      const result = results[0]
      if (!result) return
      const url = result.processedUrl ?? result.uploadResult.url
      const newResult: GeneratedResult = {
        url,
        jobId: `upload-${Date.now()}`,
        timestamp: new Date().toISOString(),
      }
      updateNodeData(id, {
        assetId: result.uploadResult.assetId ?? "",
        url,
        r2Url: url,
        thumbnailUrl: result.uploadResult.thumbnailUrl ?? "",
        filename: result.uploadResult.filename,
        fileSize: result.uploadResult.sizeBytes,
        mimeType: result.uploadResult.mimeType,
        metadata: result.uploadResult.metadata ?? {},
        isUploading: false,
        uploadError: "",
        externalUrl: "",
        generatedResults: [...(nodeData.generatedResults ?? []), newResult],
        activeResultIndex: (nodeData.generatedResults ?? []).length,
      })
    },
  })
  const useFull = useFullResolution(id)

  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const imageUrl = activeResult?.url ?? nodeData.thumbnailUrl ?? nodeData.r2Url ?? nodeData.url
  const hasFile = Boolean(nodeData.r2Url || nodeData.url) && !nodeData.externalUrl
  const [isDragOver, setIsDragOver] = useState(false)
  const [imgAspectRatio, setImgAspectRatio] = useState<number | undefined>()
  useEffect(() => {
    if (!imageUrl || !hasFile) { setImgAspectRatio(undefined); return }
    let cancelled = false
    const img = new window.Image()
    const setRatio = () => {
      if (!cancelled && img.naturalWidth > 0) {
        setImgAspectRatio(img.naturalWidth / img.naturalHeight)
      }
    }
    img.onload = setRatio
    img.src = imageUrl
    if (img.complete) setRatio()
    return () => { cancelled = true }
  }, [imageUrl, hasFile])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    clearError()
    mediaEditor.openEditor([file])
    e.target.value = ""
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith("image/")) {
      clearError()
      mediaEditor.openEditor([file])
    }
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
          imageAspectRatio={imgAspectRatio}
          bottomToolbarContent={
            showThumbnails && results.length > 1 ? (
              <div className="flex gap-1.5 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
                {results.slice(0, 8).map((r, i) => (
                  <CachedImage
                    key={`${r.jobId}-${i}`}
                    src={r.url}
                    alt={`Result ${i + 1}`}
                    className={`w-12 h-12 object-cover rounded-lg cursor-pointer transition-all ${
                      i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                    }`}
                    thumbnail
                    thumbnailWidth={96}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateNodeData(id, { activeResultIndex: i, generatedImageUrl: r.url })
                    }}
                  />
                ))}
              </div>
            ) : undefined
          }
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleFileSelect}
            className="hidden"
            ref={fileInputRef}
          />
          {/* Flush: image result display (when hasFile=true and not uploading) */}
          {!isUploading && !nodeData.isUploading && hasFile && mode === "upload" && (
            <div className="relative w-full h-full group">
              {results.length > 1 && (
                <button
                  type="button"
                  className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-md z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}
                  title="Show versions"
                >
                  <LayoutGrid className="w-3 h-3" />
                  <span className="text-[11px] font-medium">{results.length}</span>
                </button>
              )}
              <CachedImage
                src={imageUrl}
                alt={nodeData.filename || "Uploaded image"}
                className="w-full h-full object-cover rounded-xl"
                thumbnail={!useFull}
                thumbnailWidth={320}
              />
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" aria-label="Remove image"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-red-600/80 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); handleClear() }}
                  title="Remove">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" aria-label="Upload another image" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }} title="Upload another">
                  <Upload className="w-3.5 h-3.5" />
                </button>
                <button type="button" aria-label="Edit image" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); openImageEdit(id, imageUrl!, activeResult?.filerobotDesignStateUrl) }} title="Edit image">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button type="button" aria-label="Expand preview" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); setLightboxSrc(imageUrl) }} title="Enlarge">
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button type="button" aria-label="Download" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    const a = document.createElement('a')
                    a.href = `/v1/image-proxy?url=${encodeURIComponent(imageUrl ?? '')}&download=1`
                    a.download = `${nodeData.label || 'image'}.png`
                    a.click()
                  }} title="Download">
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button type="button" aria-label="Copy URL" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    copyToClipboard(imageUrl ?? '', "URL copied")
                  }} title="Copy URL">
                  <Link className="w-3.5 h-3.5" />
                </button>
                <SaveToLibraryButton url={imageUrl} type="image" />
              </div>
            </div>
          )}

          {/* Padded: all other states (uploading, error, empty upload, URL mode) */}
          {(isUploading || nodeData.isUploading || !hasFile || mode !== "upload") && (
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

              {/* Upload mode - empty state */}
              {!isUploading && !nodeData.isUploading && mode === "upload" && !hasFile && (
                <>
                  <button
                    type="button"
                    className={`w-full flex items-center justify-center gap-2 h-16 rounded-md border-2 border-dashed transition-colors cursor-pointer ${
                      isDragOver
                        ? "border-[#38BDF8] bg-[#38BDF8]/10 text-[#38BDF8]"
                        : "border-muted-foreground/20 hover:border-[#38BDF8]/50 hover:bg-[#38BDF8]/5 text-muted-foreground/60 hover:text-[#38BDF8]"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      fileInputRef.current?.click()
                    }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true) }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                  >
                    <Upload className="w-4 h-4" />
                    <span className="text-xs">{isDragOver ? "Drop Image" : "Choose Image"}</span>
                  </button>
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
                        thumbnail={!useFull}
                        thumbnailWidth={320}
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
          )}
        </BaseNode>
        <HandleIcon icon={<ImageIcon />} color="cyan" side="left" top="calc(100% - 20px)" />
        <HandleIcon icon={<ImageIcon />} top="20px" />
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

      <MediaEditorModal editor={mediaEditor} />
    </>
  )
}

export const UploadImageNode = memo(UploadImageNodeComponent)
