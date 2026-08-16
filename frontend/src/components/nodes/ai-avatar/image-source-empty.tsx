"use client"

// Empty state of the AI Avatar node in image-source mode: "START WITH AN
// IMAGE" — upload a portrait right on the card, wire one into the Image input,
// or paste a URL in the settings panel; plus the way back to a catalog avatar.

import { useCallback, type ChangeEvent, type MouseEvent } from "react"
import { Loader2, Upload, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { useFileUpload } from "@/hooks/use-file-upload"
import { FIELD_SURFACE, GHOST_BUTTON, KICKER, PINK_LINK } from "./styles"

interface ImageSourceEmptyProps {
  readonly onUploaded: (url: string) => void
  /** Open the settings panel (URL field lives there). */
  readonly onOpenSettings: () => void
  /** Switch the node back to catalog-avatar mode. */
  readonly onUseCatalog: () => void
}

function stop(e: MouseEvent) {
  e.stopPropagation()
}

export function ImageSourceEmpty({ onUploaded, onOpenSettings, onUseCatalog }: ImageSourceEmptyProps) {
  const { upload, isUploading, uploadError } = useFileUpload()

  const handleFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = "" // re-selecting the same file must fire onChange again
      if (!file) return
      try {
        const result = await upload(file)
        onUploaded(result.url)
      } catch {
        // useFileUpload surfaces the error state (uploadError) — shown below.
      }
    },
    [upload, onUploaded],
  )

  return (
    <div className="flex flex-col gap-3 h-full min-h-0 px-3.5 pt-3.5 pb-3" data-testid="ai-avatar-image-empty">
      <div className="flex items-center gap-2.5 shrink-0">
        <span className={KICKER}>Start with an image</span>
        <span className="flex-1 h-px bg-border/60" />
        <button type="button" className={PINK_LINK} onClick={(e) => { stop(e); onOpenSettings() }}>
          Paste a URL ›
        </button>
      </div>

      <label
        className={cn(
          "nodrag nopan flex-1 min-h-0 flex flex-col items-center justify-center gap-1.5 text-center px-6",
          FIELD_SURFACE, "border-dashed cursor-pointer transition-colors",
          "hover:border-[#ff0073]/60 hover:bg-muted/40",
          isUploading && "opacity-70 cursor-progress",
        )}
        onClick={stop}
      >
        {isUploading ? (
          <Loader2 className="size-6 text-muted-foreground/60 animate-spin" />
        ) : (
          <Upload className="size-6 text-muted-foreground/60" />
        )}
        <span className="text-[12px] text-foreground/85">
          {isUploading ? "Uploading…" : "Upload a portrait"}
        </span>
        <span className="text-[10.5px] text-muted-foreground/70 leading-snug">
          or wire an image into the node&apos;s Image input
        </span>
        {uploadError && (
          <span className="text-[10.5px] text-red-500 leading-snug" role="alert">{uploadError}</span>
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={isUploading}
          aria-label="Upload a portrait"
          onChange={handleFile}
        />
      </label>

      <div className="flex items-center gap-2.5 shrink-0">
        <span className="text-[11px] text-muted-foreground">Prefer a ready-made avatar?</span>
        <button type="button" className={GHOST_BUTTON} onClick={(e) => { stop(e); onUseCatalog() }}>
          <User className="size-3 opacity-70" />
          Choose an avatar
        </button>
      </div>
    </div>
  )
}
