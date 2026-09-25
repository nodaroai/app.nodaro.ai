// frontend/src/components/editor/config-panels/video-overlay-config.tsx
"use client"

import { useEffect, useRef } from "react"
import { useT } from "@/lib/i18n"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  VIDEO_OVERLAY_DEFAULT_BACKGROUND,
  VIDEO_OVERLAY_HANDLE_IDS,
  VIDEO_OVERLAY_OUTPUT_ASPECTS,
  expandVideoOverlayLayer,
  validateVideoOverlayRequest,
  videoOverlayCanvas,
  videoOverlaySlotSources,
  type VideoOverlayIssue,
  type VideoOverlayLayerInput,
  type VideoOverlayOutputAspect,
} from "@nodaro/shared"
import { OVERLAY_MAX_LAYERS, visibleOverlayLayerCount, type VideoOverlayData } from "@/types/nodes"
import { useVideoOverlayLayers } from "@/hooks/use-video-overlay-layers"
import { useVideoOverlaySelection } from "@/hooks/use-video-overlay-selection"
import { videoOverlayWarningText } from "@/lib/video-overlay-i18n"
import { COMPOSITION_RATIOS } from "./model-options"
import { Section } from "./panel-section"
import { VideoOverlayLayerCard } from "./video-overlay-layer-card"
import { VideoOverlayTimeline, type VideoOverlayTimelineBar } from "./video-overlay-timeline"
import type { ConfigProps } from "./types"

const SOURCE = "source"

/**
 * The timing / box verdict for ONE slot — the slot-aligned layer after the
 * wired-handle merge, never the compacted request (UX §2.4) — exactly as the
 * run sees it: the stored layer through the shared normaliser (an untouched
 * slot is the default badge; a partial box comes back untouched, so
 * `incomplete_box` still fires). The image check is the card header's job
 * ("not connected" / "waiting for image"), so a stand-in URL keeps
 * `layer_without_image` out of the inline messages.
 */
function slotIssue(raw: VideoOverlayLayerInput | null | undefined, slot: number): VideoOverlayIssue | undefined {
  const verdict = validateVideoOverlayRequest({ layers: [{ ...expandVideoOverlayLayer(raw), imageUrl: "about:blank", slot }] })
  return verdict.ok ? undefined : verdict
}

export function VideoOverlayConfig({ data, onUpdate, sources, nodeId }: ConfigProps<VideoOverlayData> & { nodeId?: string }) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const id = nodeId ?? ""
  const { setLayer, applyPreset, setCustom, removeLayer } = useVideoOverlayLayers(id)
  const [selected, setSelected] = useVideoOverlaySelection(id)
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({})

  const layers = Array.isArray(data.layers) ? data.layers : []
  const baseUrl = sources.find((s) => s.targetHandle === "video")?.value || undefined
  const wired: Array<string | undefined> = []
  const connected = new Set<string>()
  for (const s of sources) {
    if (!s.targetHandle) continue
    connected.add(s.targetHandle)
    const idx = (VIDEO_OVERLAY_HANDLE_IDS as readonly string[]).indexOf(s.targetHandle)
    if (idx >= 0) wired[idx] = s.value || undefined
  }
  const wiredSlotCount = VIDEO_OVERLAY_HANDLE_IDS.reduce((max, h, i) => (connected.has(h) ? i + 1 : max), 0)
  const handleCount = visibleOverlayLayerCount(data.layerCount, Math.min(layers.length, OVERLAY_MAX_LAYERS), wiredSlotCount)
  // Every stored slot gets a card, past VIDEO_OVERLAY_MAX_LAYERS too: a
  // JSON-written node with more than 20 imaged layers is refused
  // (too_many_layers), and the card's remove button is how the user brings it
  // back to 20. Nothing here adds a slot: the handles (and the Add button)
  // stay capped at 12.
  const slotCount = Math.max(handleCount, layers.length)
  const slotSources = videoOverlaySlotSources(layers, wired)

  // The probe cache is trusted only for the url that is wired now.
  const probed = data.probedVideo && baseUrl && data.probedVideo.url === baseUrl ? data.probedVideo : undefined
  const durationSec = probed?.durationSec
  const canvas = videoOverlayCanvas(probed?.width && probed.height ? { width: probed.width, height: probed.height } : null, data.outputAspect) ?? undefined
  const baseLine = !baseUrl
    ? t("proccfg.videoOverlay.baseUnknown")
    : probed?.error
      ? t("proccfg.videoOverlay.baseFailed")
      : durationSec === undefined
        ? t("proccfg.videoOverlay.baseReading")
        : probed?.width && probed.height
          ? t("proccfg.videoOverlay.base", { w: probed.width, h: probed.height, d: Math.round(durationSec * 10) / 10 })
          : t("proccfg.videoOverlay.baseDuration", { d: Math.round(durationSec * 10) / 10 })

  const inUse = (i: number) => (layers[i] ?? null) !== null || (i < VIDEO_OVERLAY_HANDLE_IDS.length && connected.has(VIDEO_OVERLAY_HANDLE_IDS[i]!))
  const bars: VideoOverlayTimelineBar[] = Array.from({ length: slotCount }, (_, i) => i)
    .filter(inUse)
    .map((i) => {
      // A partial box comes back from the normaliser untouched, so `start` / `end` may be absent here.
      const l = expandVideoOverlayLayer(layers[i])
      const start = typeof l.start === "number" && Number.isFinite(l.start) ? l.start : 0
      return { index: i, n: i + 1, start, ...(typeof l.end === "number" && Number.isFinite(l.end) ? { end: l.end } : {}) }
    })

  // A bar click selects the layer (the node's stage seeks to it) — bring its card into view too.
  useEffect(() => {
    if (selected !== null) cardRefs.current[selected]?.scrollIntoView?.({ block: "nearest" })
  }, [selected])

  const warnings = Array.isArray(data.warnings) ? data.warnings : []

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground px-1">{t("proccfg.videoOverlay.intro")}</p>
      <p className="text-[10px] text-muted-foreground px-1">{baseLine}</p>

      {durationSec !== undefined && bars.length > 0 && (
        <VideoOverlayTimeline bars={bars} durationSec={durationSec} selected={selected} onSelect={setSelected} />
      )}

      {warnings.length > 0 && (
        <p className="text-[10px] text-amber-500 px-1">
          {t("proccfg.videoOverlay.lastRun", { items: warnings.map((w) => videoOverlayWarningText(w, t)).join(" · ") })}
        </p>
      )}

      {Array.from({ length: slotCount }, (_, i) => i).map((i) => {
        const handle = VIDEO_OVERLAY_HANDLE_IDS[i]
        const isWired = !!handle && connected.has(handle)
        const own = layers[i]?.imageUrl
        const sourceTag = !handle
          ? t("proccfg.videoOverlay.source.noHandle")
          : isWired
            ? wired[i]
              ? t("proccfg.overlay.connected", { handle })
              : t("proccfg.videoOverlay.source.waiting", { handle })
            : typeof own === "string" && own
              ? t("proccfg.videoOverlay.source.url")
              : t("proccfg.overlay.notConnected", { handle })
        return (
          <div key={i} ref={(el) => { cardRefs.current[i] = el }}>
            <VideoOverlayLayerCard
              index={i}
              layer={expandVideoOverlayLayer(layers[i])}
              sourceTag={sourceTag}
              sourceOk={!!slotSources[i]}
              durationSec={durationSec}
              issue={slotIssue(layers[i], i + 1)}
              canvas={canvas}
              compact
              selected={selected === i}
              onSelect={() => setSelected(i)}
              onPatch={(patch) => setLayer(i, patch)}
              onPreset={(preset, corner) => applyPreset(i, preset, corner)}
              onCustom={() => setCustom(i)}
              onRemove={() => { removeLayer(i); if (selected === i) setSelected(null) }}
            />
          </div>
        )
      })}

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t("proccfg.overlay.layerHandles", { n: handleCount, max: OVERLAY_MAX_LAYERS })}</span>
        <div className="flex gap-1">
          <button
            type="button"
            className="h-7 px-2 rounded-md border border-border/60 text-xs hover:bg-muted disabled:opacity-40"
            disabled={handleCount <= 1 || inUse(handleCount - 1)}
            onClick={() => onUpdate({ layerCount: handleCount - 1 })}
          >
            {t("proccfg.overlay.removeLayer")}
          </button>
          <button
            type="button"
            className="h-7 px-2 rounded-md border border-border/60 text-xs hover:bg-muted disabled:opacity-40"
            disabled={handleCount >= OVERLAY_MAX_LAYERS}
            onClick={() => onUpdate({ layerCount: handleCount + 1 })}
          >
            {t("proccfg.overlay.addLayer")}
          </button>
        </div>
      </div>

      <Section title={t("proccfg.videoOverlay.output")}>
        <div>
          <Label className="text-xs">{t("proccfg.videoOverlay.outputAspect")}</Label>
          <Select
            value={data.outputAspect ?? SOURCE}
            onValueChange={(v) =>
              onUpdate(
                v === SOURCE
                  ? { outputAspect: undefined, baseFit: undefined, backgroundColor: undefined }
                  : { outputAspect: v as VideoOverlayOutputAspect },
              )
            }
          >
            <SelectTrigger aria-label={t("proccfg.videoOverlay.outputAspect")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={SOURCE}>{t("proccfg.videoOverlay.sameAsVideo")}</SelectItem>
              {VIDEO_OVERLAY_OUTPUT_ASPECTS.map((a) => (
                <SelectItem key={a} value={a}>{localizeOption(COMPOSITION_RATIOS.find((r) => r.value === a)?.label ?? a)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {data.outputAspect && (
          <div>
            <Label className="text-xs">{t("proccfg.videoOverlay.baseFit")}</Label>
            <Select value={data.baseFit ?? "cover"} onValueChange={(v) => onUpdate({ baseFit: v })}>
              <SelectTrigger aria-label={t("proccfg.videoOverlay.baseFit")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cover">{t("proccfg.overlay.fitCover")}</SelectItem>
                <SelectItem value="contain">{t("proccfg.overlay.fitContain")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {data.outputAspect && data.baseFit === "contain" && (
          <div>
            <Label htmlFor="vo-bg" className="text-xs">{t("proccfg.videoOverlay.background")}</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={t("proccfg.videoOverlay.background")}
                value={data.backgroundColor ?? VIDEO_OVERLAY_DEFAULT_BACKGROUND}
                onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
                className="w-8 h-8 rounded border border-[var(--border-primary)] cursor-pointer bg-transparent"
              />
              <Input id="vo-bg" value={data.backgroundColor ?? VIDEO_OVERLAY_DEFAULT_BACKGROUND} onChange={(e) => onUpdate({ backgroundColor: e.target.value })} className="h-8 text-xs flex-1" />
            </div>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">{t("proccfg.videoOverlay.outputHint")}</p>
      </Section>
    </div>
  )
}
