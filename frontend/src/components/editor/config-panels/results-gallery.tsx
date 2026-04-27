"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Copy, Check, Download, ImageIcon, Play, Music } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CachedImage } from "@/components/ui/cached-image"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { downloadFile } from "@/components/presentation/output-cards/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { cn } from "@/lib/utils"
import { JobConfigDisplay } from "./job-config-display"

const EXTENSION_MAP = { video: "mp4", audio: "mp3", image: "png" } as const

interface ResultsGalleryProps {
  readonly nodeType: string
  readonly results: ReadonlyArray<{ url?: string; jobId?: string; timestamp?: number }>
  readonly activeIndex: number
  readonly mediaType: "image" | "video" | "audio"
  readonly onUpdate: (data: Record<string, unknown>) => void
}

export function ResultsGallery({
  nodeType,
  results,
  activeIndex,
  mediaType,
  onUpdate,
}: ResultsGalleryProps) {
  const setWorkflowThumbnail = useWorkflowStore((s) => s.setWorkflowThumbnail)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current) }
  }, [])

  const activeUrl = results[activeIndex]?.url
  const activeJobId = results[activeIndex]?.jobId

  const handleCopyUrl = useCallback((url: string, idx: number) => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    navigator.clipboard.writeText(url)
    setCopiedIdx(idx)
    copyTimeoutRef.current = setTimeout(() => setCopiedIdx(null), 2000)
  }, [])

  const handleSetActive = useCallback((idx: number) => {
    const result = results[idx]
    if (!result?.url) return
    const updates: Record<string, unknown> = { activeResultIndex: idx }
    if (mediaType === "image") {
      updates.generatedImageUrl = result.url
    } else if (mediaType === "video") {
      updates.generatedVideoUrl = result.url
    }
    onUpdate(updates)
  }, [results, mediaType, onUpdate])

  if (results.length === 0 || !activeUrl) return null

  const canSetThumbnail = mediaType !== "audio"

  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2">
        Latest Results
      </div>

      {/* Thumbnail grid */}
      {results.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {results.map((r, idx) => {
            if (!r.url) return null
            return (
              <button
                key={`${r.url}-${idx}`}
                type="button"
                onClick={() => handleSetActive(idx)}
                className={cn(
                  "relative w-12 h-12 rounded-md overflow-hidden border-2 transition-colors",
                  idx === activeIndex
                    ? "border-[#ff0073]"
                    : "border-transparent hover:border-gray-400 dark:hover:border-gray-500",
                )}
              >
                {mediaType === "audio" ? (
                  <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-[#2D2D2D]">
                    <Music className="w-4 h-4 text-gray-400" />
                  </div>
                ) : mediaType === "video" ? (
                  <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-[#2D2D2D]">
                    <Play className="w-4 h-4 text-gray-400" />
                  </div>
                ) : (
                  <CachedImage
                    src={r.url}
                    alt={`Result ${idx + 1}`}
                    className="w-full h-full object-cover"
                    thumbnail
                    thumbnailWidth={96}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Active result actions */}
      <div className="flex flex-col gap-1.5">
        {/* Copy URL + Download row */}
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            onClick={() => handleCopyUrl(activeUrl, activeIndex)}
          >
            {copiedIdx === activeIndex ? (
              <Check className="w-3 h-3 mr-1.5 text-green-500" />
            ) : (
              <Copy className="w-3 h-3 mr-1.5" />
            )}
            {copiedIdx === activeIndex ? "Copied" : "Copy URL"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            onClick={() => downloadFile(activeUrl, `${nodeType}-result.${EXTENSION_MAP[mediaType]}`)}
          >
            <Download className="w-3 h-3 mr-1.5" />
            Download
          </Button>
        </div>

        {/* Save to Library */}
        <SaveToLibraryButton url={activeUrl} type={mediaType} compact={false} className="w-full" />

        {/* Set as Thumbnail */}
        {canSetThumbnail && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setWorkflowThumbnail(activeUrl)}
          >
            <ImageIcon className="w-3.5 h-3.5 mr-2" />
            Set as Thumbnail
          </Button>
        )}

        {/* Config used to produce this result */}
        {activeJobId && (
          <details className="mt-1 rounded-md border border-gray-200 dark:border-[#2D2D2D] overflow-hidden group">
            <summary className="text-xs px-3 py-1.5 cursor-pointer select-none text-gray-600 dark:text-[#94A3B8] bg-gray-50 dark:bg-[#181818] hover:bg-gray-100 dark:hover:bg-[#2D2D2D]">
              Config used
            </summary>
            <JobConfigDisplay jobId={activeJobId} />
          </details>
        )}
      </div>
    </div>
  )
}
