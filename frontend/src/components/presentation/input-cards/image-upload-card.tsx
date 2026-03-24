import { X, Maximize2 } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { GlassCard, GlassButton } from "../output-cards/shared"
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
    <GlassCard>
      <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
        {label}
      </label>

      {media.effectiveUrl ? (
        <div className="relative group rounded-lg overflow-hidden cursor-pointer" onClick={handleOpen}>
          <CachedImage
            src={media.effectiveUrl}
            alt={label}
            className="w-full max-h-[70vh] object-contain rounded-lg bg-black/20"
          />
          {/* Toolbar — top-right, visible on hover/touch */}
          <div className="media-overlay-controls absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <GlassButton onClick={handleOpen} title="Enlarge">
              <Maximize2 className="w-3.5 h-3.5" />
            </GlassButton>
            {!readOnly && (
              <GlassButton onClick={media.handleRemove} title="Remove">
                <X className="w-3.5 h-3.5" />
              </GlassButton>
            )}
          </div>
        </div>
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
  )
}
