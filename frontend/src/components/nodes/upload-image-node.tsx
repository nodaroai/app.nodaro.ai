"use client"

import { memo, useEffect, useRef, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ImageIcon, Expand, Upload, Link, Download, Loader2, AlertCircle, X, Pencil, LayoutGrid, Plus } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useUpstreamUrl } from "@/hooks/use-upstream-url"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useMediaEditor, MediaEditorModal } from "@/components/editor/media-editor"
import { StorageExceededModal } from "@/ee/components/credits/StorageExceededModal"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { copyToClipboard, computeDeleteResultUpdates } from "@/lib/utils"
import type { UploadImageData, GeneratedResult } from "@/types/nodes"

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
  { id: "image", type: "source" as const, position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
] as const

interface PickerProps {
  readonly isDragOver: boolean
  readonly setIsDragOver: (v: boolean) => void
  readonly onFileClick: () => void
  readonly onDrop: (e: React.DragEvent) => void
  readonly urlValue: string
  readonly onUrlChange: (v: string) => void
  readonly onUrlSubmit: () => void
  readonly compact?: boolean
}

function UploadPicker({ isDragOver, setIsDragOver, onFileClick, onDrop, urlValue, onUrlChange, onUrlSubmit, compact }: PickerProps) {
  return (
    <div className={`flex flex-col gap-2 ${compact ? "" : "p-3"}`}>
      <button
        type="button"
        className={`w-full flex items-center justify-center gap-2 ${compact ? "h-12" : "h-16"} rounded-md border-2 border-dashed transition-colors cursor-pointer ${
          isDragOver
            ? "border-[#38BDF8] bg-[#38BDF8]/10 text-[#38BDF8]"
            : "border-muted-foreground/20 hover:border-[#38BDF8]/50 hover:bg-[#38BDF8]/5 text-muted-foreground/60 hover:text-[#38BDF8]"
        }`}
        onClick={(e) => { e.stopPropagation(); onFileClick() }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
      >
        <Upload className="w-4 h-4" />
        <span className="text-xs">{isDragOver ? "Drop Image" : "Choose Image"}</span>
      </button>
      <div className="flex items-center gap-1.5">
        <Link className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
        <input
          type="text"
          value={urlValue}
          onChange={(e) => { e.stopPropagation(); onUrlChange(e.target.value) }}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Enter") { e.preventDefault(); onUrlSubmit() }
          }}
          onBlur={() => { if (urlValue.trim()) onUrlSubmit() }}
          placeholder="or paste image URL..."
          className="w-full bg-transparent border-b border-muted-foreground/20 text-xs py-1 outline-none focus:border-[#38BDF8] transition-colors placeholder:text-muted-foreground/30"
        />
      </div>
    </div>
  )
}

function UploadImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as UploadImageData
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [showAddOverlay, setShowAddOverlay] = useState(false)
  const [pendingUrl, setPendingUrl] = useState("")
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const openImageEdit = useWorkflowStore((s) => s.openImageEdit)
  const { isUploading, uploadError, clearError, storageExceeded, clearStorageExceeded } = useFileUpload()
  const mediaEditor = useMediaEditor({
    onComplete: async (results) => {
      const result = results[0]
      if (!result) return
      const url = result.processedUrl ?? result.uploadResult.url
      const meta = result.uploadResult.metadata
      const newResult: GeneratedResult = {
        url,
        jobId: `upload-${Date.now()}`,
        timestamp: new Date().toISOString(),
        ...(result.uploadResult.thumbnailUrl ? { thumbnailUrl: result.uploadResult.thumbnailUrl } : {}),
        ...(meta?.width && meta?.height ? { width: meta.width, height: meta.height } : {}),
      }
      const prevResults = nodeData.generatedResults ?? []
      const newIndex = prevResults.length
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
        generatedResults: [...prevResults, newResult],
        activeResultIndex: newIndex,
      })
      setShowAddOverlay(false)
    },
  })
  const useFull = useFullResolution(id)

  useUpstreamUrl(id, nodeData.externalUrl, updateNodeData)

  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const imageUrl = activeResult?.url ?? nodeData.thumbnailUrl ?? nodeData.r2Url ?? nodeData.url
  const hasImage = Boolean(imageUrl)
  const { aspectRatio: imgAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)

  // Legacy + upstream migration: when externalUrl/url is set but no result
  // exists yet (legacy workflow state, or upstream connected post-mount via
  // useUpstreamUrl), hoist it into results[0] so the unified codepath drives
  // aspect ratio, hover affordances, and versioning. Guard on results.length
  // prevents the loop after the push.
  useEffect(() => {
    if ((nodeData.generatedResults?.length ?? 0) > 0) return
    const legacyUrl = nodeData.externalUrl || nodeData.r2Url || nodeData.url
    if (!legacyUrl) return
    updateNodeData(id, {
      generatedResults: [{
        url: legacyUrl,
        jobId: `legacy-${Date.now()}`,
        timestamp: new Date().toISOString(),
        ...(nodeData.thumbnailUrl ? { thumbnailUrl: nodeData.thumbnailUrl } : {}),
        ...(nodeData.metadata?.width && nodeData.metadata?.height
          ? { width: nodeData.metadata.width, height: nodeData.metadata.height }
          : {}),
      }],
      activeResultIndex: 0,
    })
  }, [id, nodeData.externalUrl, nodeData.r2Url, nodeData.url, nodeData.thumbnailUrl, nodeData.generatedResults, nodeData.metadata, updateNodeData])

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

  const handleAddUrl = () => {
    const url = pendingUrl.trim()
    if (!url) return
    const newResult: GeneratedResult = {
      url,
      jobId: `upload-url-${Date.now()}`,
      timestamp: new Date().toISOString(),
    }
    const newResults = [...results, newResult]
    updateNodeData(id, {
      generatedResults: newResults,
      activeResultIndex: newResults.length - 1,
      url,
      externalUrl: url,
      r2Url: "",
      thumbnailUrl: "",
      assetId: "",
      filename: "",
      fileSize: 0,
      mimeType: "",
      metadata: {},
      uploadError: "",
    })
    setPendingUrl("")
    setShowAddOverlay(false)
  }

  const handleSwitchActive = (i: number) => {
    const target = results[i]
    if (!target) return
    updateNodeData(id, {
      activeResultIndex: i,
      url: target.url,
      thumbnailUrl: target.thumbnailUrl ?? "",
    })
  }

  const handleDeleteResult = (indexToDelete: number) => {
    const updates = computeDeleteResultUpdates(results, activeIndex, indexToDelete, "url")
    // If we just emptied the stack, clear externalUrl/r2Url too so the empty
    // state renders the picker rather than a phantom legacy URL.
    if (((updates.generatedResults as GeneratedResult[]) ?? []).length === 0) {
      updates.externalUrl = ""
      updates.r2Url = ""
      updates.assetId = ""
      updates.thumbnailUrl = ""
    }
    updateNodeData(id, updates)
  }

  return (
    <>
      <div className="relative" style={{ width: "100%", height: "100%" }}>
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
          minWidth={200}
          minHeight={imgAspectRatio ? Math.round(200 / imgAspectRatio) : 150}
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
                    onClick={(e) => { e.stopPropagation(); handleSwitchActive(i) }}
                  />
                ))}
              </div>
            ) : undefined
          }
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/heic,image/heif"
            onChange={handleFileSelect}
            className="hidden"
            ref={fileInputRef}
          />

          <div className="relative w-full h-full group">
            {/* Uploading */}
            {(isUploading || nodeData.isUploading) && (
              <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[80px]">
                <Loader2 className="w-8 h-8 animate-spin text-[#38BDF8]" />
                <p className="text-xs text-muted-foreground">Uploading...</p>
              </div>
            )}

            {/* Has image */}
            {!isUploading && !nodeData.isUploading && hasImage && (
              <>
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
                  onLoadDimensions={handleLoadDimensions}
                />
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" aria-label="Add another image"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => { e.stopPropagation(); setShowAddOverlay(true) }}
                    title="Add another">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" aria-label="Remove this result"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-red-600/80 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}
                    title="Remove">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" aria-label="Edit image" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => { e.stopPropagation(); openImageEdit(id, imageUrl!, activeResult?.filerobotDesignStateUrl) }} title="Edit image">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" aria-label="Fullscreen" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }} title="Fullscreen">
                    <Expand className="w-3.5 h-3.5" />
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
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(imageUrl ?? '', "URL copied") }} title="Copy URL">
                    <Link className="w-3.5 h-3.5" />
                  </button>
                  <SaveToLibraryButton url={imageUrl} type="image" />
                </div>
              </>
            )}

            {/* Empty - first time picker */}
            {!isUploading && !nodeData.isUploading && !hasImage && (
              <UploadPicker
                isDragOver={isDragOver}
                setIsDragOver={setIsDragOver}
                onFileClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                urlValue={pendingUrl}
                onUrlChange={setPendingUrl}
                onUrlSubmit={handleAddUrl}
              />
            )}

            {/* Error chip */}
            {!isUploading && !nodeData.isUploading && (uploadError || nodeData.uploadError) && !hasImage && (
              <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 px-2 py-1.5 rounded bg-red-500/10 text-red-400 text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{uploadError || nodeData.uploadError}</span>
              </div>
            )}

            {/* Add-new overlay (shows the picker on top of the current image) */}
            {showAddOverlay && (
              <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm rounded-xl flex flex-col gap-2 p-3 z-30"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === "Escape") setShowAddOverlay(false) }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-white/80 font-medium">Add another image</span>
                  <button type="button" aria-label="Cancel"
                    className="w-6 h-6 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-full"
                    onClick={(e) => { e.stopPropagation(); setShowAddOverlay(false); setPendingUrl("") }}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <UploadPicker
                  isDragOver={isDragOver}
                  setIsDragOver={setIsDragOver}
                  onFileClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  urlValue={pendingUrl}
                  onUrlChange={setPendingUrl}
                  onUrlSubmit={handleAddUrl}
                  compact
                />
              </div>
            )}
          </div>
        </BaseNode>
        <HandleIcon icon={<ImageIcon />} color="cyan" side="left" top="calc(100% - 20px)" />
        <HandleIcon icon={<ImageIcon />} top="20px" />
      </div>

      {imageUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="image"
          url={imageUrl}
          results={results}
          initialIndex={activeIndex}
        />
      )}

      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
        }}
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
