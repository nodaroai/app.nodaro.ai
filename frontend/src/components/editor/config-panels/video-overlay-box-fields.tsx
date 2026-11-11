// frontend/src/components/editor/config-panels/video-overlay-box-fields.tsx
"use client"

import { useT } from "@/lib/i18n"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { VIDEO_OVERLAY_BOUNDS, type VideoOverlayBoxInput, type VideoOverlayCanvas, type VideoOverlayFit } from "@nodaro/shared/video"
import type { OverlayAnchor } from "@nodaro/shared/media"
import { AnchorGrid, PctSlider, pctPx } from "./panel-section"

/**
 * A stored number, or `fallback` when it is absent / not a finite number. A
 * box written as workflow JSON may be partial (the validator answers
 * `incomplete_box`), so every field is read through this and the card renders
 * instead of reading "NaN".
 */
export const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback)
export const optNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/**
 * The box fields, in % of the output frame: anchor, width, offsets, an
 * optional height and — with a height — the fit. The ONE set a Custom layer's
 * card and the Base video card both show, so a layer and the base are placed
 * in the same words. `onPatch` gets only the field edited; a cleared height is
 * `height: undefined` (the picture follows its own aspect).
 */
export function VideoOverlayBoxFields({
  idPrefix,
  box,
  canvas,
  anchorHint,
  menuMarker,
  onPatch,
}: {
  idPrefix: string
  box: VideoOverlayBoxInput
  canvas?: VideoOverlayCanvas
  anchorHint: string
  /** Marks the menus these fields open (they render in a portal) as part of the owner — the Base video card's, so a press in them keeps the base selected. */
  menuMarker?: string
  onPatch: (patch: VideoOverlayBoxInput) => void
}) {
  const t = useT()
  const width = num(box.width, VIDEO_OVERLAY_BOUNDS.width[0])
  const x = num(box.x, 0)
  const y = num(box.y, 0)
  const height = optNum(box.height)
  return (
    <>
      <div className="flex items-start gap-3">
        <div>
          <Label className="text-xs">{t("proccfg.overlay.anchor")}</Label>
          {/* A partial box may have no anchor: none is shown selected (its incomplete_box alert says why). */}
          <AnchorGrid value={box.anchor as OverlayAnchor} label={t("proccfg.overlay.anchor")} onChange={(anchor) => onPatch({ anchor })} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-5 flex-1">{anchorHint}</p>
      </div>
      <PctSlider id={`${idPrefix}-w`} label={t("proccfg.overlay.width")} value={width} min={VIDEO_OVERLAY_BOUNDS.width[0]} max={VIDEO_OVERLAY_BOUNDS.width[1]} hint={`%${pctPx(width, canvas?.w)}`} onChange={(width) => onPatch({ width })} />
      <PctSlider id={`${idPrefix}-x`} label={t("proccfg.overlay.offsetX")} value={x} min={VIDEO_OVERLAY_BOUNDS.x[0]} max={VIDEO_OVERLAY_BOUNDS.x[1]} hint={`%${pctPx(x, canvas?.w)}`} onChange={(x) => onPatch({ x })} />
      <PctSlider id={`${idPrefix}-y`} label={t("proccfg.overlay.offsetY")} value={y} min={VIDEO_OVERLAY_BOUNDS.y[0]} max={VIDEO_OVERLAY_BOUNDS.y[1]} hint={`%${pctPx(y, canvas?.h)}`} onChange={(y) => onPatch({ y })} />
      <div>
        <Label htmlFor={`${idPrefix}-h`} className="text-xs">{t("proccfg.videoOverlay.height")}</Label>
        <Input
          id={`${idPrefix}-h`}
          type="number" min={VIDEO_OVERLAY_BOUNDS.height[0]} max={VIDEO_OVERLAY_BOUNDS.height[1]} step={1}
          placeholder={t("proccfg.overlay.heightAuto")}
          value={height ?? ""}
          onChange={(e) => onPatch({ height: e.target.value === "" ? undefined : Math.min(VIDEO_OVERLAY_BOUNDS.height[1], Math.max(VIDEO_OVERLAY_BOUNDS.height[0], Number(e.target.value))) })}
          className="h-8 text-xs"
        />
      </div>
      {height !== undefined && (
        <div>
          <Label className="text-xs">{t("proccfg.overlay.fit")}</Label>
          <Select value={box.fit ?? "contain"} onValueChange={(v) => onPatch({ fit: v as VideoOverlayFit })}>
            <SelectTrigger aria-label={t("proccfg.overlay.fit")}><SelectValue /></SelectTrigger>
            <SelectContent {...(menuMarker ? { "data-video-overlay-base": menuMarker } : {})}>
              <SelectItem value="contain">{t("proccfg.overlay.fitContain")}</SelectItem>
              <SelectItem value="cover">{t("proccfg.overlay.fitCover")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  )
}
