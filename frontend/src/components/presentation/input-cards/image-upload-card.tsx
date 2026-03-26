import { X, Download, Copy } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { MediaEditorModal } from "@/components/editor/media-editor"
import { GlassCard, GlassButton, copyUrl, downloadFile } from "../output-cards/shared"
import { ActionMenu } from "../output-cards/action-menu"
import { ActionBar } from "../output-cards/action-bar"
import { shareMedia } from "../output-cards/share-utils"
import { useMediaUpload, FileDropZone, UrlInputRow } from "./shared"

interface ImageUploadCardProps {
  label: string
  url?: string
  nodeId: string
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
  onOpenMedia?: (nodeId: string) => void
}

export function ImageUploadCard({ label, url, nodeId, isFullscreen, inputValues, onUpdateInput, readOnly, onOpenMedia }: ImageUploadCardProps) {
  const media = useMediaUpload({ mimePrefix: "image/", nodeId, isFullscreen, inputValues, onUpdateInput, url })

  const handleOpen = () => onOpenMedia?.(nodeId)

  return (
    <>
      <GlassCard>
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {label}
        </label>

        {media.effectiveUrl ? (
          <>
            <div className="relative group rounded-lg overflow-hidden cursor-pointer" onClick={handleOpen}>
              <CachedImage
                src={media.effectiveUrl}
                alt={label}
                className="w-full max-h-[70vh] object-contain rounded-lg bg-black/20"
              />
              {/* Desktop toolbar — top-right, visible on hover */}
              {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions */}
              <div className="media-overlay-controls absolute top-2 right-2 hidden md:flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200" onClick={(e) => e.stopPropagation()}>
                <GlassButton onClick={() => downloadFile(media.effectiveUrl!, `${label.replace(/\s+/g, "-").toLowerCase()}.png`)} title="Download">
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
                  mediaType="image"
                  onShare={() => shareMedia({ url: media.effectiveUrl!, title: label, type: "image" })}
                />
              </div>
            </div>
            {/* Mobile action bar */}
            <ActionBar
              mediaType="image"
              url={media.effectiveUrl}
              label={label}
              onShare={() => shareMedia({ url: media.effectiveUrl!, title: label, type: "image" })}
            />
          </>
        ) : readOnly ? (
          <div className="flex items-center justify-center h-32 bg-muted/30 rounded-lg border border-border text-sm text-muted-foreground">
            No image
          </div>
        ) : (
          <FileDropZone
            isDragOver={media.isDragOver}
            setIsDragOver={media.setIsDragOver}
            onDrop={media.handleDrop}
            onClick={() => media.fileInputRef.current?.click()}
            isUploading={media.isUploading}
            accept="image/*"
            fileInputRef={media.fileInputRef}
            onFileChange={media.handleFile}
            label="Drop image or click to upload"
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
      </GlassCard>
      <MediaEditorModal editor={media.mediaEditor} />
    </>
  )
}
