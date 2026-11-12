// frontend/src/components/editor/config-panels/video-overlay-layout-select.tsx
"use client"

import { useT, type MessageKey } from "@/lib/i18n"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { VIDEO_OVERLAY_LAYOUT_IDS, isVideoOverlayLayoutId, type VideoOverlayLayoutId } from "@nodaro/shared/video"
import { videoOverlayShapesPendingKey } from "@/hooks/use-video-overlay-layers"

/** The select's value for "no layout" (a Radix item cannot have an empty value; the node never stores this). */
const CUSTOM = "custom"

const LAYOUT_LABELS: { readonly [L in VideoOverlayLayoutId]: MessageKey } = {
  "video-bottom": "proccfg.videoOverlay.layout.videoBottom",
  "video-top": "proccfg.videoOverlay.layout.videoTop",
  "stack-whole": "proccfg.videoOverlay.layout.stackWhole",
  "stack-filled": "proccfg.videoOverlay.layout.stackFilled",
  pip: "proccfg.videoOverlay.layout.pip",
}

/** A layout's name's key. */
export function videoOverlayLayoutLabelKey(id: VideoOverlayLayoutId): MessageKey {
  return LAYOUT_LABELS[id]
}

/**
 * The Layout picker: the five layouts, then Custom — what an absent, `null`
 * or `""` layout reads as. An unknown stored layout (written as JSON; the
 * panel's verdict says it is refused) selects nothing, so Custom can clear it.
 * `onChange(null)` is Custom; `customBlocked` (a stack whose shapes are still
 * being read, or could not be read) holds Custom back, with the reason.
 */
export function VideoOverlayLayoutSelect({
  layout,
  customBlocked,
  onChange,
}: {
  layout: unknown
  customBlocked?: "reading" | "unreadable"
  onChange: (layout: VideoOverlayLayoutId | null) => void
}) {
  const t = useT()
  const label = t("proccfg.videoOverlay.layout")
  const unknown = typeof layout === "string" && layout !== "" && !isVideoOverlayLayoutId(layout)
  // "" is Radix's "nothing selected": the placeholder shows.
  const value = isVideoOverlayLayoutId(layout) ? layout : unknown ? "" : CUSTOM
  return (
    <div className="px-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(isVideoOverlayLayoutId(v) ? v : null)}>
        <SelectTrigger aria-label={label}><SelectValue placeholder={t("proccfg.videoOverlay.layoutUnknown")} /></SelectTrigger>
        <SelectContent>
          {VIDEO_OVERLAY_LAYOUT_IDS.map((id) => (
            <SelectItem key={id} value={id}>{t(LAYOUT_LABELS[id])}</SelectItem>
          ))}
          <SelectItem value={CUSTOM} disabled={!!customBlocked}>{t("proccfg.videoOverlay.preset.custom")}</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground mt-1">
        {t(customBlocked ? videoOverlayShapesPendingKey(customBlocked === "unreadable") : "proccfg.videoOverlay.layoutHint")}
      </p>
    </div>
  )
}
