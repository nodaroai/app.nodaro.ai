import { useState, useRef, useCallback } from "react"
import { Upload, Link } from "lucide-react"
import { useFileUpload } from "@/hooks/use-file-upload"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

/** Deterministic waveform bar heights for decorative display */
export const WAVEFORM_HEIGHTS = [18, 14, 22, 16, 20]

/** Precomputed styles for waveform bars to avoid per-render allocation */
const WAVEFORM_BAR_STYLES = WAVEFORM_HEIGHTS.map((h, i) => ({
  height: `${h}px`,
  animation: `waveform-bar ${0.6 + i * 0.15}s ease-in-out infinite`,
  animationDelay: `${i * 0.1}s`,
}))

/** Animated decorative waveform bars */
export function WaveformBars({ color = "bg-[#ff0073]/60" }: { color?: string }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {WAVEFORM_BAR_STYLES.map((style, i) => (
        <div key={i} className={`w-1 ${color} rounded-full`} style={style} />
      ))}
    </div>
  )
}

interface UseMediaUploadOptions {
  mimePrefix: "image/" | "video/" | "audio/"
  nodeId: string
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  url?: string
}

/** Shared upload logic for image, video, and audio input cards */
export function useMediaUpload({ mimePrefix, nodeId, isFullscreen, inputValues, onUpdateInput, url }: UseMediaUploadOptions) {
  const { upload, isUploading } = useFileUpload()
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlValue, setUrlValue] = useState("")
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const effectiveUrl = isFullscreen
    ? (inputValues[nodeId]?.url as string ?? url)
    : url

  const updateUrl = useCallback((newUrl: string) => {
    if (isFullscreen) {
      onUpdateInput(nodeId, "url", newUrl)
    } else {
      useWorkflowStore.getState().updateNodeData(nodeId, { url: newUrl })
    }
  }, [nodeId, isFullscreen, onUpdateInput])

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith(mimePrefix)) return
    try {
      const result = await upload(file)
      updateUrl(result.url)
    } catch {
      // Error handled by useFileUpload hook
    }
  }, [mimePrefix, upload, updateUrl])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleUrlSubmit = useCallback(() => {
    if (urlValue.trim()) {
      updateUrl(urlValue.trim())
      setUrlValue("")
      setShowUrlInput(false)
    }
  }, [urlValue, updateUrl])

  const handleRemove = useCallback(() => {
    updateUrl("")
  }, [updateUrl])

  return {
    effectiveUrl,
    isUploading,
    isDragOver,
    setIsDragOver,
    showUrlInput,
    setShowUrlInput,
    urlValue,
    setUrlValue,
    fileInputRef,
    handleFile,
    handleDrop,
    handleUrlSubmit,
    handleRemove,
  }
}

/** Inline URL input row shared across upload cards */
export function UrlInputRow({
  urlValue,
  onChange,
  onSubmit,
}: {
  urlValue: string
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="mt-2 flex gap-2">
      <input
        type="text"
        value={urlValue}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder="https://..."
        className="flex-1 bg-white/[0.03] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/80 placeholder:text-white/20 focus:outline-none focus:border-[#ff0073]/50"
        autoFocus
      />
      <button
        type="button"
        onClick={onSubmit}
        className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/15 text-white/70 rounded-lg transition-colors"
      >
        Set
      </button>
    </div>
  )
}

/** Upload spinner shown during file upload */
export function UploadSpinner({ size = "md" }: { size?: "sm" | "md" }) {
  const dim = size === "sm" ? "w-6 h-6" : "w-8 h-8"
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`${dim} border-2 border-[#ff0073]/40 border-t-[#ff0073] rounded-full animate-spin`} />
      <span className="text-xs text-white/40">Uploading...</span>
    </div>
  )
}

/** Drop zone for drag-and-drop file upload */
export function FileDropZone({
  isDragOver,
  setIsDragOver,
  onDrop,
  onClick,
  isUploading,
  accept,
  fileInputRef,
  onFileChange,
  label,
  height = "h-40",
  onShowUrl,
}: {
  isDragOver: boolean
  setIsDragOver: (v: boolean) => void
  onDrop: (e: React.DragEvent) => void
  onClick: () => void
  isUploading: boolean
  accept: string
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileChange: (file: File) => void
  label: string
  height?: string
  onShowUrl: () => void
}) {
  return (
    <div
      className={`relative flex flex-col items-center justify-center ${height} border-2 border-dashed rounded-lg transition-all duration-200 cursor-pointer ${
        isDragOver
          ? "border-[#ff0073]/60 bg-[#ff0073]/5"
          : "border-white/10 hover:border-white/20 bg-white/[0.02]"
      }`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={onDrop}
      onClick={onClick}
    >
      {isUploading ? (
        <UploadSpinner size={height === "h-24" ? "sm" : "md"} />
      ) : (
        <>
          <Upload className={height === "h-24" ? "w-6 h-6 text-white/20 mb-1" : "w-8 h-8 text-white/20 mb-2"} />
          <span className="text-xs text-white/30">{label}</span>
          <button
            type="button"
            className="mt-2 text-[10px] text-white/40 hover:text-white/60 flex items-center gap-1 transition-colors"
            onClick={(e) => { e.stopPropagation(); onShowUrl() }}
          >
            <Link className="w-3 h-3" /> or paste URL
          </button>
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFileChange(file)
          e.target.value = ""
        }}
      />
    </div>
  )
}
