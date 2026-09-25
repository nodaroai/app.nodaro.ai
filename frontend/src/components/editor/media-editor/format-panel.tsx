// frontend/src/components/editor/media-editor/format-panel.tsx
import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import {
  IMAGE_FORMAT_OPTIONS,
  VIDEO_FORMAT_OPTIONS,
  AUDIO_FORMAT_OPTIONS,
  type MediaCategory,
} from "./utils"

interface FormatPanelProps {
  mediaType: MediaCategory
  format: string | null
  onFormatChange: (format: string | null) => void
  originalFormat: string
}

export function FormatPanel({
  mediaType,
  format,
  onFormatChange,
  originalFormat,
}: FormatPanelProps) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const [open, setOpen] = useState(false)

  const options =
    mediaType === "image"
      ? IMAGE_FORMAT_OPTIONS
      : mediaType === "video"
        ? VIDEO_FORMAT_OPTIONS
        : AUDIO_FORMAT_OPTIONS

  return (
    <div className="border-t border-border/40">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full px-1 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          className={cn("w-3 h-3 transition-transform", open ? "rotate-90" : isRtl && "rotate-180")}
        />
        {t("mediaed.advanced")}
        {format && (
          <span className="ms-auto text-[#ff0073] text-[10px]">
            &rarr; {format.toUpperCase()}
          </span>
        )}
      </button>

      {open && (
        <div className="pb-2 px-1">
          <div className="text-[11px] text-muted-foreground mb-1.5">{t("cfgext.aiAvOutputFormat")}</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onFormatChange(null)}
              className={cn(
                "px-2.5 py-1 rounded text-xs border transition-colors",
                format === null
                  ? "border-[#ff0073] bg-[#ff0073]/10 text-white"
                  : "border-border/40 text-muted-foreground hover:border-border",
              )}
            >
              {t("common.qualified", { token: t("proccfg.original"), qualifier: originalFormat.toUpperCase() })}
            </button>
            {options
              .filter((o) => o.value !== originalFormat)
              .map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onFormatChange(opt.value)}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs border transition-colors",
                    format === opt.value
                      ? "border-[#ff0073] bg-[#ff0073]/10 text-white"
                      : "border-border/40 text-muted-foreground hover:border-border",
                  )}
                >
                  {opt.label}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
