"use client"

import { useState, useCallback } from "react"
import { Download, ChevronDown, ChevronRight, ImageIcon, Film, Music, FileText, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { cn } from "@/lib/utils"
import { CachedImage } from "@/components/ui/cached-image"

const VIDEO_TYPES = new Set(["image-to-video", "video-to-video", "text-to-video", "video-upscale", "motion-transfer", "lip-sync", "suno-music-video"])
const AUDIO_TYPES = new Set(["text-to-speech", "generate-music", "text-to-audio", "suno-generate", "suno-cover", "suno-extend", "suno-separate"])
const IMAGE_TYPES = new Set(["generate-image", "edit-image", "image-to-image"])

function getMediaType(nodeType: string): "image" | "video" | "audio" | "text" {
  if (VIDEO_TYPES.has(nodeType)) return "video"
  if (AUDIO_TYPES.has(nodeType)) return "audio"
  if (IMAGE_TYPES.has(nodeType)) return "image"
  return "text"
}

function isMediaUrl(url: string): boolean {
  return url.startsWith("http") || /\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|ogg)(\?|$)/i.test(url)
}

function getMediaIcon(mediaType: "image" | "video" | "audio" | "text") {
  switch (mediaType) {
    case "image": return <ImageIcon className="w-3.5 h-3.5" />
    case "video": return <Film className="w-3.5 h-3.5" />
    case "audio": return <Music className="w-3.5 h-3.5" />
    case "text": return <FileText className="w-3.5 h-3.5" />
  }
}

async function downloadFile(url: string, filename: string) {
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  } catch {
    // Fallback: open in new tab
    window.open(url, "_blank")
  }
}

function getFileExtension(url: string, mediaType: "image" | "video" | "audio" | "text"): string {
  const match = url.match(/\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|ogg)(\?|$)/i)
  if (match) return match[1].toLowerCase()
  switch (mediaType) {
    case "image": return "png"
    case "video": return "mp4"
    case "audio": return "mp3"
    default: return "txt"
  }
}

interface IterationResultsPanelProps {
  readonly nodeId: string
  readonly nodeType: string
  readonly listResults: readonly string[]
  readonly listInputs: readonly string[]
}

function IterationCard({
  index,
  input,
  result,
  mediaType,
  nodeType,
  nodeId,
}: {
  readonly index: number
  readonly input: string
  readonly result: string
  readonly mediaType: "image" | "video" | "audio" | "text"
  readonly nodeType: string
  readonly nodeId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const addNode = useWorkflowStore((s) => s.addNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const onConnect = useWorkflowStore((s) => s.onConnect)
  const nodes = useWorkflowStore((s) => s.nodes)

  const hasResult = result && result.trim().length > 0
  const resultIsUrl = hasResult && isMediaUrl(result)
  const inputIsUrl = input && isMediaUrl(input)

  // Truncate long inputs for collapsed view
  const inputPreview = input.length > 60 ? `${input.slice(0, 57)}...` : input

  const handleDownload = useCallback(() => {
    if (!resultIsUrl) return
    const ext = getFileExtension(result, mediaType)
    downloadFile(result, `iteration-${index + 1}.${ext}`)
  }, [result, resultIsUrl, index, mediaType])

  const handleContinue = useCallback(() => {
    if (!resultIsUrl) return
    // Find the source node to position the new node nearby
    const sourceNode = nodes.find((n) => n.id === nodeId)
    const x = (sourceNode?.position.x ?? 400) + 350
    const y = (sourceNode?.position.y ?? 200) + (index * 120)

    if (mediaType === "image") {
      const newId = addNode("upload-image", { x, y }, { url: result, label: `From iteration ${index + 1}` })
      if (newId) {
        updateNodeData(newId, { url: result })
      }
    } else if (mediaType === "video") {
      const newId = addNode("upload-video", { x, y }, { url: result, label: `From iteration ${index + 1}` })
      if (newId) {
        updateNodeData(newId, { url: result })
      }
    }
  }, [resultIsUrl, result, nodes, nodeId, index, mediaType, addNode, updateNodeData])

  return (
    <div className="rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1A1A1A] overflow-hidden">
      {/* Header - always visible */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-[#222] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        }
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-[#888] shrink-0">
          #{index + 1}
        </span>

        {/* Thumbnail in collapsed mode */}
        {resultIsUrl && mediaType === "image" && (
          <CachedImage
            src={result}
            alt={`Result ${index + 1}`}
            className="w-8 h-8 rounded object-cover shrink-0"
            thumbnail
            thumbnailWidth={80}
          />
        )}
        {resultIsUrl && mediaType === "video" && (
          <div className="w-8 h-8 rounded bg-gray-100 dark:bg-[#2D2D2D] flex items-center justify-center shrink-0">
            <Film className="w-4 h-4 text-gray-400" />
          </div>
        )}
        {resultIsUrl && mediaType === "audio" && (
          <div className="w-8 h-8 rounded bg-gray-100 dark:bg-[#2D2D2D] flex items-center justify-center shrink-0">
            <Music className="w-4 h-4 text-gray-400" />
          </div>
        )}

        {/* Input preview */}
        {!inputIsUrl && input && (
          <span className="text-[11px] text-gray-500 dark:text-[#999] truncate text-left flex-1">
            {inputPreview}
          </span>
        )}

        {/* Status indicator */}
        {hasResult ? (
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-100 dark:border-[#2D2D2D]">
          {/* Input */}
          {input && (
            <div className="pt-2">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#666]">
                Input
              </span>
              {inputIsUrl ? (
                <a href={input} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-blue-500 hover:underline truncate mt-0.5">
                  {input}
                </a>
              ) : (
                <p className="text-[11px] text-gray-600 dark:text-[#ccc] mt-0.5 whitespace-pre-wrap break-words line-clamp-4">
                  {input}
                </p>
              )}
            </div>
          )}

          {/* Result */}
          {hasResult && (
            <div>
              <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#666]">
                Result
              </span>
              {resultIsUrl && mediaType === "image" && (
                <div className="mt-1">
                  <CachedImage
                    src={result}
                    alt={`Result ${index + 1}`}
                    className="w-full max-h-48 rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setLightboxOpen(true)}
                    thumbnail
                    thumbnailWidth={480}
                  />
                  {lightboxOpen && (
                    <ImageLightbox
                      src={result}
                      alt={`Result ${index + 1}`}
                      onClose={() => setLightboxOpen(false)}
                    />
                  )}
                </div>
              )}
              {resultIsUrl && mediaType === "video" && (
                <video
                  src={result}
                  controls
                  className="w-full max-h-48 rounded-lg mt-1"
                />
              )}
              {resultIsUrl && mediaType === "audio" && (
                <audio
                  src={result}
                  controls
                  className="w-full mt-1"
                />
              )}
              {!resultIsUrl && (
                <p className="text-[11px] text-gray-600 dark:text-[#ccc] mt-0.5 whitespace-pre-wrap break-words line-clamp-6">
                  {result}
                </p>
              )}
            </div>
          )}

          {!hasResult && (
            <p className="text-[11px] text-red-400 pt-1">Failed</p>
          )}

          {/* Action buttons */}
          {hasResult && resultIsUrl && (
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] flex-1"
                onClick={handleDownload}
              >
                <Download className="w-3 h-3 mr-1" />
                Download
              </Button>
              {(mediaType === "image" || mediaType === "video") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] flex-1"
                  onClick={handleContinue}
                >
                  <ExternalLink className="w-3 h-3 mr-1" />
                  Continue
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function IterationResultsPanel({
  nodeId,
  nodeType,
  listResults,
  listInputs,
}: IterationResultsPanelProps) {
  const [downloading, setDownloading] = useState(false)
  const mediaType = getMediaType(nodeType)
  const mediaIcon = getMediaIcon(mediaType)

  const successCount = listResults.filter((r) => r && r.trim().length > 0).length
  const mediaResults = listResults.filter((r) => r && isMediaUrl(r))

  const handleDownloadAll = useCallback(async () => {
    if (mediaResults.length === 0) return
    setDownloading(true)
    try {
      for (let i = 0; i < mediaResults.length; i++) {
        const ext = getFileExtension(mediaResults[i], mediaType)
        await downloadFile(mediaResults[i], `result-${i + 1}.${ext}`)
        // Small delay between downloads to avoid browser blocking
        if (i < mediaResults.length - 1) {
          await new Promise((r) => setTimeout(r, 300))
        }
      }
    } finally {
      setDownloading(false)
    }
  }, [mediaResults, mediaType])

  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] flex items-center gap-1.5">
          {mediaIcon}
          Results ({successCount}/{listResults.length})
        </Label>
      </div>

      <div className="flex flex-col gap-1.5">
        {listResults.map((result, i) => (
          <IterationCard
            key={i}
            index={i}
            input={listInputs[i] ?? ""}
            result={result}
            mediaType={mediaType}
            nodeType={nodeType}
            nodeId={nodeId}
          />
        ))}
      </div>

      {/* Bulk actions */}
      {mediaResults.length > 1 && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-[#2D2D2D]">
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-[11px]"
            onClick={handleDownloadAll}
            disabled={downloading}
          >
            <Download className="w-3 h-3 mr-1.5" />
            {downloading ? "Downloading..." : `Download All (${mediaResults.length})`}
          </Button>
        </div>
      )}
    </div>
  )
}
