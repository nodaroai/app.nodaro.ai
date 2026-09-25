// frontend/src/components/editor/config-panels/video-overlay-layer-card.tsx
"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { useT, type MessageKey } from "@/lib/i18n"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  VIDEO_OVERLAY_BOUNDS,
  VIDEO_OVERLAY_CORNERS,
  type VideoOverlayCanvas,
  type VideoOverlayCorner,
  type VideoOverlayFit,
  type VideoOverlayIssue,
  type VideoOverlayLayer,
  type VideoOverlayLayerInput,
  type VideoOverlayPresetId,
  isVideoOverlayPresetId,
} from "@nodaro/shared"
import { videoOverlayIssueMessage } from "@/lib/video-overlay-i18n"
import { AnchorGrid, PctSlider, Section, pctPx } from "./panel-section"

const PLACEMENTS: ReadonlyArray<{ id: VideoOverlayPresetId | "custom"; label: MessageKey }> = [
  { id: "card", label: "proccfg.videoOverlay.preset.card" },
  { id: "corner-badge", label: "proccfg.videoOverlay.preset.cornerBadge" },
  { id: "full-frame", label: "proccfg.videoOverlay.preset.fullFrame" },
  { id: "custom", label: "proccfg.videoOverlay.preset.custom" },
]

const CORNER_LABELS: { readonly [C in VideoOverlayCorner]: MessageKey } = {
  "top-left": "proccfg.videoOverlay.corner.topLeft",
  "top-right": "proccfg.videoOverlay.corner.topRight",
  "bottom-left": "proccfg.videoOverlay.corner.bottomLeft",
  "bottom-right": "proccfg.videoOverlay.corner.bottomRight",
}

/**
 * A stored number, or `fallback` when it is absent / not a finite number. The
 * layer handed to the card is typed as expanded, but a PARTIAL box (written as
 * workflow JSON — `update_workflow_json`, a template, a REST full-body save)
 * comes back from `expandVideoOverlayLayer` untouched, so any field may be
 * missing and `preset` may be an unknown string. The card reads every field
 * through this / `isVideoOverlayPresetId` so such a layer renders (with its
 * `incomplete_box` alert) instead of crashing or reading "NaN".
 */
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback)
const optNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/** Seconds shown to 2 decimals WITHOUT rounding what is stored (word-aligned ms survive). */
const shownSeconds = (v: number | undefined): string => (v === undefined ? "" : String(Math.round(v * 100) / 100))

/** A seconds field that shows the stored value unless the user is typing in it. */
function SecondsInput({ id, value, placeholder, onCommit }: { id: string; value: number | undefined; placeholder?: string; onCommit: (v: number | undefined) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      step={0.1}
      min={0}
      placeholder={placeholder}
      value={draft ?? shownSeconds(value)}
      onFocus={() => setDraft(shownSeconds(value))}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value)
        if (e.target.value === "") return onCommit(undefined)
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onCommit(n)
      }}
      className="h-8 text-xs"
    />
  )
}

export interface VideoOverlayLayerCardProps {
  /** 0-based slot index. */
  readonly index: number
  /** The slot's layer, EXPANDED (the default badge for an untouched slot). */
  readonly layer: VideoOverlayLayer
  /** "connected (overlay2)" / "image URL" / "not connected (overlay3)" … */
  readonly sourceTag: string
  readonly sourceOk: boolean
  /** The base's length when known — enables the (advisory) clipped / skipped hints. */
  readonly durationSec?: number
  /** The shared validator's verdict for this slot (timing / box), if any. */
  readonly issue?: VideoOverlayIssue
  /** The output canvas in px, for the ≈px hints. */
  readonly canvas?: VideoOverlayCanvas
  /** Sidebar mode: only Timing starts open. */
  readonly compact: boolean
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onPatch: (patch: VideoOverlayLayerInput) => void
  readonly onPreset: (preset: VideoOverlayPresetId, corner?: VideoOverlayCorner) => void
  readonly onCustom: () => void
  readonly onRemove: () => void
}

/** One layer's card (UX §2.4): Timing · Placement · Look. */
export function VideoOverlayLayerCard(p: VideoOverlayLayerCardProps) {
  const t = useT()
  const { layer, index } = p
  const n = index + 1
  const placement: VideoOverlayPresetId | "custom" = isVideoOverlayPresetId(layer.preset) ? layer.preset : "custom"
  const storedStart = optNum(layer.start)
  const start = storedStart ?? 0
  const end = optNum(layer.end)
  const opacity = num(layer.opacity, 1)
  const animate = typeof layer.animate === "boolean" ? layer.animate : true
  const width = num(layer.width, VIDEO_OVERLAY_BOUNDS.width[0])
  const x = num(layer.x, 0)
  const y = num(layer.y, 0)
  const height = optNum(layer.height)
  const zIndex = optNum(layer.zIndex)
  const d = p.durationSec
  const amber =
    d === undefined
      ? undefined
      : start >= d
        ? t("proccfg.videoOverlay.skipped", { d: shownSeconds(d) })
        : end !== undefined && end > d
          ? t("proccfg.videoOverlay.clipped", { d: shownSeconds(d) })
          : undefined
  const readout = end === undefined ? t("proccfg.videoOverlay.shownToEnd") : t("proccfg.videoOverlay.shownFor", { d: shownSeconds(Math.max(0, end - start)) })
  const lookSummary = t(animate ? "proccfg.videoOverlay.lookAnimated" : "proccfg.videoOverlay.lookStatic", { opacity: Math.round(opacity * 100) })
  const placementLabel = PLACEMENTS.find((o) => o.id === placement)?.label ?? "proccfg.videoOverlay.preset.custom"

  return (
    <div className={`rounded-md border p-2 space-y-2 ${p.selected ? "border-[#ff0073]" : "border-border/60"}`}>
      <div className="flex items-center justify-between px-0.5">
        <button type="button" className="text-xs font-medium text-start" onClick={p.onSelect}>
          {t("proccfg.overlay.layerN", { n })}
          <span className={`ms-1.5 text-[10px] font-normal ${p.sourceOk ? "text-emerald-500" : "text-muted-foreground"}`}>{p.sourceTag}</span>
        </button>
        <button type="button" className="text-muted-foreground hover:text-red-500" aria-label={t("proccfg.videoOverlay.removeLayer")} title={t("proccfg.videoOverlay.removeLayer")} onClick={p.onRemove}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <Section title={t("proccfg.videoOverlay.section.timing")}>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor={`vo-${index}-start`} className="text-xs">{t("proccfg.videoOverlay.start")}</Label>
            <SecondsInput id={`vo-${index}-start`} value={storedStart} onCommit={(v) => p.onPatch({ start: v })} />
          </div>
          <div>
            <Label htmlFor={`vo-${index}-end`} className="text-xs">{t("proccfg.videoOverlay.end")}</Label>
            <SecondsInput id={`vo-${index}-end`} value={end} placeholder={t("proccfg.videoOverlay.endPlaceholder")} onCommit={(v) => p.onPatch({ end: v })} />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">{readout}</p>
        {p.issue && <p className="text-[10px] text-red-500" role="alert">{videoOverlayIssueMessage(p.issue, t)}</p>}
        {!p.issue && amber && <p className="text-[10px] text-amber-500">{amber}</p>}
      </Section>

      <Section title={t("proccfg.videoOverlay.placement")} summary={t(placementLabel)} defaultOpen={!p.compact}>
        <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={t("proccfg.videoOverlay.placement")}>
          {PLACEMENTS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={placement === opt.id}
              className={`h-7 rounded border text-[10px] ${placement === opt.id ? "bg-[#ff0073] border-[#ff0073] text-white" : "bg-muted/40 border-border/60 hover:bg-muted"}`}
              onClick={() => (opt.id === "custom" ? p.onCustom() : p.onPreset(opt.id))}
            >
              {t(opt.label)}
            </button>
          ))}
        </div>
        {placement === "corner-badge" && (
          <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label={t("proccfg.videoOverlay.corner")}>
            {VIDEO_OVERLAY_CORNERS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={(layer.corner ?? "bottom-right") === c}
                className={`h-6 rounded border text-[10px] ${(layer.corner ?? "bottom-right") === c ? "bg-[#ff0073] border-[#ff0073] text-white" : "bg-muted/40 border-border/60 hover:bg-muted"}`}
                onClick={() => p.onPreset("corner-badge", c)}
              >
                {t(CORNER_LABELS[c])}
              </button>
            ))}
          </div>
        )}
        {placement === "custom" && (
          <>
            <div className="flex items-start gap-3">
              <div>
                <Label className="text-xs">{t("proccfg.overlay.anchor")}</Label>
                <AnchorGrid value={layer.anchor} label={t("proccfg.overlay.anchor")} onChange={(anchor) => p.onPatch({ anchor })} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-5 flex-1">{t("proccfg.videoOverlay.anchorHint")}</p>
            </div>
            <PctSlider id={`vo-${index}-w`} label={t("proccfg.overlay.width")} value={width} min={VIDEO_OVERLAY_BOUNDS.width[0]} max={VIDEO_OVERLAY_BOUNDS.width[1]} hint={`%${pctPx(width, p.canvas?.w)}`} onChange={(width) => p.onPatch({ width })} />
            <PctSlider id={`vo-${index}-x`} label={t("proccfg.overlay.offsetX")} value={x} min={VIDEO_OVERLAY_BOUNDS.x[0]} max={VIDEO_OVERLAY_BOUNDS.x[1]} hint={`%${pctPx(x, p.canvas?.w)}`} onChange={(x) => p.onPatch({ x })} />
            <PctSlider id={`vo-${index}-y`} label={t("proccfg.overlay.offsetY")} value={y} min={VIDEO_OVERLAY_BOUNDS.y[0]} max={VIDEO_OVERLAY_BOUNDS.y[1]} hint={`%${pctPx(y, p.canvas?.h)}`} onChange={(y) => p.onPatch({ y })} />
            <div>
              <Label htmlFor={`vo-${index}-h`} className="text-xs">{t("proccfg.videoOverlay.height")}</Label>
              <Input
                id={`vo-${index}-h`}
                type="number" min={VIDEO_OVERLAY_BOUNDS.height[0]} max={VIDEO_OVERLAY_BOUNDS.height[1]} step={1}
                placeholder={t("proccfg.overlay.heightAuto")}
                value={height ?? ""}
                onChange={(e) => p.onPatch({ height: e.target.value === "" ? undefined : Math.min(VIDEO_OVERLAY_BOUNDS.height[1], Math.max(VIDEO_OVERLAY_BOUNDS.height[0], Number(e.target.value))) })}
                className="h-8 text-xs"
              />
            </div>
            {height !== undefined && (
              <div>
                <Label className="text-xs">{t("proccfg.overlay.fit")}</Label>
                <Select value={layer.fit ?? "contain"} onValueChange={(v) => p.onPatch({ fit: v as VideoOverlayFit })}>
                  <SelectTrigger aria-label={t("proccfg.overlay.fit")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contain">{t("proccfg.overlay.fitContain")}</SelectItem>
                    <SelectItem value="cover">{t("proccfg.overlay.fitCover")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor={`vo-${index}-z`} className="text-xs">{t("proccfg.overlay.zIndex")}</Label>
              <Input
                id={`vo-${index}-z`}
                type="number" min={VIDEO_OVERLAY_BOUNDS.zIndex[0]} max={VIDEO_OVERLAY_BOUNDS.zIndex[1]} step={1}
                placeholder={String(index)}
                value={zIndex ?? ""}
                onChange={(e) => p.onPatch({ zIndex: e.target.value === "" ? undefined : Math.min(VIDEO_OVERLAY_BOUNDS.zIndex[1], Math.max(VIDEO_OVERLAY_BOUNDS.zIndex[0], Math.round(Number(e.target.value)))) })}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground mt-1">{t("proccfg.overlay.zIndexHint")}</p>
            </div>
          </>
        )}
      </Section>

      <Section title={t("proccfg.videoOverlay.section.look")} summary={lookSummary} defaultOpen={false}>
        <PctSlider id={`vo-${index}-o`} label={t("proccfg.overlay.opacity")} value={Math.round(opacity * 100)} min={0} max={100} hint="%" onChange={(v) => p.onPatch({ opacity: v / 100 })} />
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor={`vo-${index}-animate`} className="text-xs">{t("proccfg.videoOverlay.animate")}</Label>
            <Switch id={`vo-${index}-animate`} checked={animate} onCheckedChange={(animate) => p.onPatch({ animate })} />
          </div>
          <p className="text-[10px] text-muted-foreground">{t("proccfg.videoOverlay.animateHint")}</p>
        </div>
      </Section>
    </div>
  )
}
