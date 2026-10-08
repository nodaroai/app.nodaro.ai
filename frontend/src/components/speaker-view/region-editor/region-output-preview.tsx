"use client"

/**
 * OUTPUT (U4): what the selected speaker's tile will show — the cover crop of
 * the current frame, drawn at the slot's shape — and the resolution chip:
 * "608 × 1080 → 1080 × 1920 · 1.8× upscale", amber above 1.5× (SV8 a).
 */
import { useEffect, useRef } from "react"
import { AlertTriangle } from "lucide-react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { UPSCALE_WARN, upscaleOf, type Size, type SlotRect } from "./region-geometry"

interface RegionOutputPreviewProps {
  readonly speaker: string
  /** The cover crop in source pixels; absent while the frame's size is unknown. */
  readonly crop?: SlotRect
  readonly slot: Size
  /** The element the frame is drawn from (the camera's video or thumbnail). */
  readonly source: () => CanvasImageSource | null
  /** Bumps when the frame under the crop may have changed (a seek, a load). */
  readonly frameTick: number
}

const PREVIEW_LONG_SIDE = 160

export function RegionOutputPreview({ speaker, crop, slot, source, frameTick }: RegionOutputPreviewProps) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scale = PREVIEW_LONG_SIDE / Math.max(slot.width, slot.height)
  const w = Math.max(1, Math.round(slot.width * scale))
  const h = Math.max(1, Math.round(slot.height * scale))

  useEffect(() => {
    const ctx = canvasRef.current?.getContext?.("2d")
    if (!ctx) return
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, w, h)
    const img = source()
    if (!img || !crop) return
    try {
      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h)
    } catch {
      // A frame not decoded yet: the black tile stands until the next tick.
    }
  }, [crop, w, h, source, frameTick])

  const up = crop ? upscaleOf(crop, slot) : undefined
  const warn = up !== undefined && up > UPSCALE_WARN
  return (
    <div className="flex flex-col items-center gap-2" data-testid="region-output">
      <span className="text-[11px] text-muted-foreground self-start">{t("speakerView.framing.output", { speaker })}</span>
      <canvas ref={canvasRef} width={w} height={h} className="rounded border border-border bg-black" style={{ width: w, height: h }} />
      {crop && up !== undefined && (
        <p
          data-testid="region-chip"
          className={cn("text-[11px] tabular-nums flex items-center gap-1", warn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}
        >
          {warn && <AlertTriangle className="w-3 h-3" aria-hidden />}
          {up > 1
            ? t("speakerView.framing.chip", {
                from: `${Math.round(crop.w)} × ${Math.round(crop.h)}`,
                to: `${slot.width} × ${slot.height}`,
                factor: (Math.round(up * 10) / 10).toFixed(1),
              })
            : t("speakerView.framing.chipSharp", { from: `${Math.round(crop.w)} × ${Math.round(crop.h)}`, to: `${slot.width} × ${slot.height}` })}
        </p>
      )}
    </div>
  )
}
