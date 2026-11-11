// frontend/src/components/editor/config-panels/video-overlay-config.tsx
"use client"

import { useEffect, useMemo, useRef } from "react"
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
  expandVideoOverlayLayout,
  firstVideoLayerIndex,
  hasDrawableVideoOverlayBox,
  isVideoOverlayCorner,
  isVideoOverlayLayoutId,
  isVideoOverlayOutputAspect,
  validateVideoOverlayRequest,
  videoOverlayCanvas,
  videoOverlayLayoutNeedsAspect,
  videoOverlayLayoutPlacesBase,
  videoOverlaySlotSources,
  type VideoOverlayCorner,
  type VideoOverlayIssue,
  type VideoOverlayLayer,
  type VideoOverlayLayerInput,
  type VideoOverlayLayoutId,
  type VideoOverlayOutputAspect,
} from "@nodaro/shared/video"
import { OVERLAY_MAX_LAYERS, visibleOverlayLayerCount, type VideoOverlayData } from "@/types/nodes"
import { useVideoOverlayLayers } from "@/hooks/use-video-overlay-layers"
import { useVideoOverlayBaseSelection, useVideoOverlaySelection } from "@/hooks/use-video-overlay-selection"
import { useVideoOverlayUpstream } from "@/hooks/use-video-overlay-upstream"
import { useVideoOverlayAspectStore } from "@/hooks/use-video-overlay-aspects"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useCarriedEdges } from "@/hooks/use-carried-edges"
import { videoOverlayIssueText, videoOverlayLengthWarningText, videoOverlayWarningText } from "@/lib/video-overlay-i18n"
import { videoOverlayLengthWarning } from "@/lib/video-overlay-limits"
import { resolveVideoOverlayView, videoOverlayViewMedia } from "@/lib/video-overlay-view"
import { videoOverlayLayoutAsCustom } from "@/lib/video-overlay-layout-custom"
import { videoOverlayEffectiveBaseBox } from "@/lib/video-overlay-base-box"
import { videoOverlayWireBaseSec } from "@/lib/video-utility-estimate"
import { VideoOverlayShapeProbe } from "@/components/nodes/video-overlay-preview"
import { COMPOSITION_RATIOS } from "./model-options"
import { Section } from "./panel-section"
import { VideoOverlayBaseCard, type VideoOverlayBaseCardState } from "./video-overlay-base-card"
import { VideoOverlayLayerCard } from "./video-overlay-layer-card"
import { VideoOverlayLayoutSelect, videoOverlayLayoutLabelKey } from "./video-overlay-layout-select"
import { VideoOverlayTimeline, type VideoOverlayTimelineBar } from "./video-overlay-timeline"
import type { ConfigProps } from "./types"

const SOURCE = "source"

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0

/**
 * The timing / box verdict for ONE slot — the slot-aligned layer after the
 * wired-handle merge, never the compacted request (UX §2.4) — exactly as the
 * run sees it: `run` is the slot's layer as the run assembles it (its wire's
 * kind; a wired image's stale sound skipped), when the slot has a source. The
 * source check is the card header's job ("not connected" / "waiting for an
 * image or video"), so a slot with no source is checked as stored with a
 * stand-in source: a video when it stores a sound (a sound is its wire's to
 * judge, and the volume is still checked), else an image.
 */
function slotIssue(run: VideoOverlayLayer | undefined, raw: VideoOverlayLayerInput | null | undefined, slot: number): VideoOverlayIssue | undefined {
  const layer = run ?? expandVideoOverlayLayer(raw)
  const standIn = run ? {} : layer.sound != null ? { videoUrl: "about:blank" } : { imageUrl: "about:blank" }
  const verdict = validateVideoOverlayRequest({ layers: [{ ...layer, ...standIn, slot }] })
  return verdict.ok ? undefined : verdict
}

/** The corner pip puts its inset in: the layer's own `corner`, else bottom-right (the layout's default). */
function pipCornerOf(raw: VideoOverlayLayerInput | null | undefined): VideoOverlayCorner {
  const corner = raw?.corner
  return isVideoOverlayCorner(corner) ? corner : "bottom-right"
}

export function VideoOverlayConfig({ data, onUpdate, nodeId }: ConfigProps<VideoOverlayData> & { nodeId?: string }) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const id = nodeId ?? ""
  const { setLayer, applyPreset, setCustom, setLayout, setBaseBox, resetBaseBox, removeLayer } = useVideoOverlayLayers(id)
  const [selected, setSelected] = useVideoOverlaySelection(id)
  const [baseSelected, setBaseSelected] = useVideoOverlayBaseSelection(id)
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({})
  // The wires as the node and the run read them: each layer's file and kind.
  const upstream = useVideoOverlayUpstream(id)
  const aspects = useVideoOverlayAspectStore((s) => s.aspects)
  const unreadable = useVideoOverlayAspectStore((s) => s.unreadable)
  const clearUnreadable = useVideoOverlayAspectStore((s) => s.clearUnreadable)

  const layers = Array.isArray(data.layers) ? data.layers : []
  const baseUrl = upstream.base
  const connected = upstream.connected
  const wiredSlotCount = VIDEO_OVERLAY_HANDLE_IDS.reduce((max, h, i) => (connected.has(h) ? i + 1 : max), 0)
  const handleCount = visibleOverlayLayerCount(data.layerCount, Math.min(layers.length, OVERLAY_MAX_LAYERS), wiredSlotCount)
  // Every stored slot gets a card, past VIDEO_OVERLAY_MAX_LAYERS too: a
  // JSON-written node with more than 20 imaged layers is refused
  // (too_many_layers), and the card's remove button is how the user brings it
  // back to 20. Nothing here adds a slot: the handles (and the Add button)
  // stay capped at 12.
  const slotCount = Math.max(handleCount, layers.length)
  const slotSources = videoOverlaySlotSources(layers, upstream.layers)

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

  // What the run sends and what the stage draws, read as the node reads them:
  // a slot's layer is its kind's (a wired video is a video layer) and, under a
  // layout, carries the box the layout gives it.
  const view = useMemo(
    () => resolveVideoOverlayView(data, upstream, videoOverlayViewMedia(data.probedVideo, upstream.base, aspects)),
    [data, upstream, aspects],
  )
  const runBySlot = useMemo(() => new Map(view.request.layers.flatMap((l) => (l.slot !== undefined ? [[l.slot, l] as const] : []))), [view])
  const shownLayer = (i: number): VideoOverlayLayer => view.stage.items[view.slots.planLayers.length + i]?.layer ?? expandVideoOverlayLayer(layers[i])

  // The run's verdict on the whole node — the shared validator on the
  // assembled request — when no card names it: a request-wide refusal or a
  // plan layer's. An empty node is the node's own placeholder, not an error here.
  const verdict = validateVideoOverlayRequest(view.request)
  const nodeIssue = !verdict.ok && verdict.code !== "no_layers" && verdict.slot === undefined ? verdict : undefined
  // The base's length cap, from the length the price reads (the base wire as it
  // carries — a teleport pair read through): a warning only — the server measures the file and decides.
  const graphNodes = useWorkflowStore((s) => s.nodes)
  const carried = useCarriedEdges()
  const wireSec = useMemo(() => videoOverlayWireBaseSec({ id }, graphNodes, carried), [id, graphNodes, carried])
  const lengthWarning = videoOverlayLengthWarning(view.request.layers, wireSec)

  // The layout's first video layer: pip's inset (its corner is the layout's
  // own input), and the clip a stack-whole waits for before it can be Custom.
  const first = firstVideoLayerIndex(view.request.layers)
  const firstLayer = first >= 0 ? view.request.layers[first] : undefined
  const customPending = useMemo(() => videoOverlayLayoutAsCustom(data, view, new Set()) === "shapes-pending", [data, view])
  // Why: a shape still being read, or one that could not be read (the clip's, or the base's probe failed) — the layout still renders.
  const clipUrl = firstLayer?.videoUrl
  const shapeUnreadable = (!!clipUrl && !!unreadable[clipUrl]) || (!!probed?.error && view.baseAspect === undefined)
  const customBlocked = customPending ? (shapeUnreadable ? "unreadable" : "reading") : undefined
  const probeUrl = customBlocked === "reading" && clipUrl && view.aspectOf(clipUrl) === undefined ? clipUrl : undefined
  // An unreadable mark is not for good: opening the panel (or a new clip) reads the stack's clip again.
  const stackLayout = isVideoOverlayLayoutId(data.layout) && videoOverlayLayoutPlacesBase(data.layout)
  useEffect(() => {
    if (stackLayout && clipUrl) clearUnreadable(clipUrl)
  }, [stackLayout, clipUrl, clearUnreadable])
  const pipSlot = data.layout === "pip" ? firstLayer?.slot : undefined

  // The base's card: no box without an output aspect; the layout's under a
  // stack; Video fit's — nothing to edit — until it has a box of its own; its
  // box (the stored one, or an edge layout's) as fields.
  const stack = stackLayout
  const storedBase = hasDrawableVideoOverlayBox(data.baseBox)
  const edgeBase = data.baseBox == null && isVideoOverlayLayoutId(data.layout) && expandVideoOverlayLayout({ layout: data.layout }).baseBox != null
  const effectiveBase = videoOverlayEffectiveBaseBox(data)
  const baseState: VideoOverlayBaseCardState = !isVideoOverlayOutputAspect(data.outputAspect)
    ? { kind: "needs-aspect" }
    : stack
      ? { kind: "by-stack", customBlocked: !!customBlocked }
      : (storedBase || edgeBase) && effectiveBase
        ? {
            kind: "box",
            box: effectiveBase,
            summary: storedBase ? t("proccfg.videoOverlay.preset.custom") : t(videoOverlayLayoutLabelKey(data.layout as VideoOverlayLayoutId)),
          }
        : { kind: "by-fit" }

  const inUse = (i: number) => (layers[i] ?? null) !== null || (i < VIDEO_OVERLAY_HANDLE_IDS.length && connected.has(VIDEO_OVERLAY_HANDLE_IDS[i]!))
  const bars: VideoOverlayTimelineBar[] = Array.from({ length: slotCount }, (_, i) => i)
    .filter(inUse)
    .map((i) => {
      // A partial box comes back from the normaliser untouched, so `start` / `end` may be absent here.
      const l = shownLayer(i)
      const start = typeof l.start === "number" && Number.isFinite(l.start) ? l.start : 0
      return { index: i, n: i + 1, start, ...(typeof l.end === "number" && Number.isFinite(l.end) ? { end: l.end } : {}) }
    })

  // A bar click selects the layer (the node's stage seeks to it) — bring its card into view too.
  useEffect(() => {
    if (selected !== null) cardRefs.current[selected]?.scrollIntoView?.({ block: "nearest" })
  }, [selected])

  const warnings = Array.isArray(data.warnings) ? data.warnings : []
  // A box places the base — a stack's, an edge layout's or a stored one — so
  // Video fit has no effect; what the box leaves uncovered shows the padding colour.
  const placesBase = stack || expandVideoOverlayLayout({ layout: data.layout, baseBox: data.baseBox ?? undefined }).baseBox != null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground px-1">{t("proccfg.videoOverlay.intro")}</p>
      <p className="text-[11px] text-muted-foreground px-1">{baseLine}</p>

      <VideoOverlayLayoutSelect layout={data.layout} customBlocked={customBlocked} onChange={setLayout} />
      {probeUrl && <VideoOverlayShapeProbe url={probeUrl} />}
      {nodeIssue && <p className="text-[11px] text-red-500 px-1" role="alert">{videoOverlayIssueText(nodeIssue, t)}</p>}
      {lengthWarning && <p className="text-[11px] text-amber-500 px-1">{videoOverlayLengthWarningText(lengthWarning, t)}</p>}

      <VideoOverlayBaseCard
        state={baseState}
        stored={data.baseBox != null}
        canvas={canvas}
        marker={id}
        selected={baseSelected}
        onSelect={setBaseSelected}
        onPatch={(patch) => setBaseBox(patch, baseState.kind === "box" ? baseState.box : undefined)}
        onReset={resetBaseBox}
      />

      {durationSec !== undefined && bars.length > 0 && (
        <VideoOverlayTimeline bars={bars} durationSec={durationSec} selected={selected} onSelect={setSelected} />
      )}

      {warnings.length > 0 && (
        <p className="text-[11px] text-amber-500 px-1">
          {t("proccfg.videoOverlay.lastRun", { items: warnings.map((w) => videoOverlayWarningText(w, t)).join(" · ") })}
        </p>
      )}

      {Array.from({ length: slotCount }, (_, i) => i).map((i) => {
        const handle = VIDEO_OVERLAY_HANDLE_IDS[i]
        const isWired = !!handle && connected.has(handle)
        const layer = shownLayer(i)
        const video = nonEmpty(layer.videoUrl)
        const own = layers[i]
        const ownSource = nonEmpty(own?.imageUrl) || nonEmpty(own?.videoUrl)
        const ownVideo = !nonEmpty(own?.imageUrl) && nonEmpty(own?.videoUrl)
        const sourceTag = !handle
          ? t(ownVideo ? "proccfg.videoOverlay.source.noHandleVideo" : "proccfg.videoOverlay.source.noHandle")
          : isWired
            ? upstream.layers[i]
              ? t("proccfg.overlay.connected", { handle })
              : t("proccfg.videoOverlay.source.waiting", { handle })
            : ownSource
              ? t(ownVideo ? "proccfg.videoOverlay.source.videoUrl" : "proccfg.videoOverlay.source.url")
              : t("proccfg.overlay.notConnected", { handle })
        return (
          <div key={i} ref={(el) => { cardRefs.current[i] = el }}>
            <VideoOverlayLayerCard
              index={i}
              layer={layer}
              video={video}
              {...(pipSlot === i + 1 ? { pipCorner: pipCornerOf(layers[i]) } : {})}
              sourceTag={sourceTag}
              sourceOk={!!slotSources[i]}
              durationSec={durationSec}
              issue={slotIssue(runBySlot.get(i + 1), layers[i], i + 1)}
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
                  ? {
                      // Everything that needs an output aspect goes with it, so the node is never left refused for it.
                      outputAspect: undefined,
                      baseFit: undefined,
                      backgroundColor: undefined,
                      baseBox: undefined,
                      ...(isVideoOverlayLayoutId(data.layout) && videoOverlayLayoutNeedsAspect(data.layout) ? { layout: undefined } : {}),
                    }
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
        {data.outputAspect && !placesBase && (
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
        {data.outputAspect && (placesBase || data.baseFit === "contain") && (
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
        <p className="text-[11px] text-muted-foreground">{t("proccfg.videoOverlay.outputHint")}</p>
      </Section>
    </div>
  )
}
