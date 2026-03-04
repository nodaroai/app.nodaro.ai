import { useState } from "react"
import { X, Maximize2 } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { ImageLightbox } from "@/components/ui/image-lightbox"
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
}

export function ImageUploadCard({ label, url, nodeId, isFullscreen, inputValues, onUpdateInput, readOnly }: ImageUploadCardProps) {
  const media = useMediaUpload({ mimePrefix: "image/", nodeId, isFullscreen, inputValues, onUpdateInput, url })
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  return (
    <GlassCard>
      <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </label>

      {media.effectiveUrl ? (
        <div className="relative group rounded-lg overflow-hidden">
          <CachedImage
            src={media.effectiveUrl}
            alt={label}
            className="w-full max-h-64 object-contain rounded-lg bg-black/20 cursor-pointer"
            onClick={() => setLightboxSrc(media.effectiveUrl!)}
          />
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2">
            <GlassButton onClick={() => setLightboxSrc(media.effectiveUrl!)} title="Enlarge">
              <Maximize2 className="w-4 h-4" />
            </GlassButton>
            {!readOnly && (
              <GlassButton onClick={media.handleRemove} title="Remove">
                <X className="w-4 h-4" />
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

      <ImageLightbox
        src={lightboxSrc}
        alt={label}
        onClose={() => setLightboxSrc(null)}
      />
    </GlassCard>
  )
}
