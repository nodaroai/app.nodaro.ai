import { useState } from "react"
import { X, Play, Download, Copy } from "lucide-react"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { MediaEditorModal } from "@/components/editor/media-editor"
import { GlassCard, GlassButton, copyUrl, downloadFile } from "../output-cards/shared"
import { ActionMenu } from "../output-cards/action-menu"
import { ActionBar } from "../output-cards/action-bar"
import { shareMedia } from "../output-cards/share-utils"
import { useMediaUpload, FileDropZone, UrlInputRow } from "./shared"

interface VideoUploadCardProps {
  label: string
  url?: string
  nodeId: string
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
}

export function VideoUploadCard({ label, url, nodeId, isFullscreen, inputValues, onUpdateInput, readOnly }: VideoUploadCardProps) {
  const media = useMediaUpload({ mimePrefix: "video/", nodeId, isFullscreen, inputValues, onUpdateInput, url })
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <>
      <GlassCard>
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {label}
        </label>

        {media.effectiveUrl ? (
          <>
            <div className="relative group rounded-lg overflow-hidden cursor-pointer" onClick={() => setPreviewOpen(true)}>
              <video
                src={media.effectiveUrl}
                className="w-full rounded-lg bg-black/20 object-contain"
                muted
                playsInline
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center group-hover:bg-black/60 group-hover:scale-110 transition-all duration-200">
                  <Play className="w-7 h-7 text-white ml-1" fill="white" />
                </div>
              </div>
              {/* Desktop toolbar — top-right, visible on hover */}
              {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions */}
              <div className="media-overlay-controls absolute top-2 right-2 hidden md:flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200" onClick={(e) => e.stopPropagation()}>
                <GlassButton onClick={() => downloadFile(media.effectiveUrl!, `${label.replace(/\s+/g, "-").toLowerCase()}.mp4`)} title="Download">
                  <Download className="w-3.5 h-3.5" />
                </GlassButton>
                <GlassButton onClick={() => copyUrl(media.effectiveUrl!)} title="Copy URL">
                  <Copy className="w-3.5 h-3.5" />
                </GlassButton>
                {!readOnly && (
                  <GlassButton onClick={media.handleRemove} title="Remove">
                    <X className="w-3.5 h-3.5" />
                  </GlassButton>
                )}
                <ActionMenu
                  mediaType="video"
                  onShare={() => shareMedia({ url: media.effectiveUrl!, title: label, type: "video" })}
                />
              </div>
            </div>
            {/* Mobile action bar */}
            <ActionBar
              mediaType="video"
              url={media.effectiveUrl}
              label={label}
              onShare={() => shareMedia({ url: media.effectiveUrl!, title: label, type: "video" })}
            />
          </>
        ) : readOnly ? (
          <div className="flex items-center justify-center h-32 bg-muted/30 rounded-lg border border-border text-sm text-muted-foreground">
            No video
          </div>
        ) : (
          <FileDropZone
            isDragOver={media.isDragOver}
            setIsDragOver={media.setIsDragOver}
            onDrop={media.handleDrop}
            onClick={() => media.fileInputRef.current?.click()}
            isUploading={media.isUploading}
            accept="video/*"
            fileInputRef={media.fileInputRef}
            onFileChange={media.handleFile}
            label="Drop video or click to upload"
            onShowUrl={() => media.setShowUrlInput(true)}
          />
        )}

        {media.showUrlInput && !media.effectiveUrl && (
          <UrlInputRow
            urlValue={media.urlValue}
            onChange={media.setUrlValue}
            onSubmit={media.handleUrlSubmit}
          />
        )}

        {media.effectiveUrl && (
          <MediaPreviewModal
            isOpen={previewOpen}
            onClose={() => setPreviewOpen(false)}
            type="video"
            url={media.effectiveUrl}
          />
        )}
      </GlassCard>
      <MediaEditorModal editor={media.mediaEditor} />
    </>
  )
}
