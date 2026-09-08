"use client"

import { useT } from "@/lib/i18n"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { useState } from "react"
import { Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ImageOverlayEditor } from "@/components/nodes/image-overlay-editor"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  OVERLAY_ANCHORS,
  OVERLAY_HANDLE_IDS,
  OVERLAY_MAX_LAYERS,
  OVERLAY_PRESETS,
  visibleOverlayLayerCount,
  DEFAULT_OVERLAY_LAYER,
  type ImageOverlayData,
  type OverlayLayerConfig,
} from "@/types/nodes"
import type { ConfigProps, SourceNodeInfo } from "./types"
import { OverlayLayerEditor } from "./image-overlay-layer-editor"
import { useImageOverlayLayers } from "@/hooks/use-image-overlay-layers"
import { OVERLAY_MAX_VARIANTS, OVERLAY_PLATFORMS, overlayPlatformById, overlayVariantHandle } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useImageOverlayAiFinish } from "@/hooks/use-image-overlay-ai-finish"
import { overlayPlatformPatch } from "@/lib/image-overlay-platform"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"

export { OverlayLayerEditor } from "./image-overlay-layer-editor"

/** Pixel size of the base image when the connected source already knows it —
 *  the % fields show their pixel equivalent next to them. */
function baseImageSize(sources: ReadonlyArray<SourceNodeInfo>): { w: number; h: number } | undefined {
  const base = sources.find((s) => s.targetHandle === "image") ?? sources.find((s) => !s.targetHandle)
  const results = base?.nodeData?.generatedResults as ReadonlyArray<{ width?: number; height?: number }> | undefined
  const active = (base?.nodeData?.activeResultIndex as number | undefined) ?? 0
  const r = results?.[active] ?? results?.[0]
  if (r?.width && r?.height) return { w: r.width, h: r.height }
  const w = base?.nodeData?.width as number | undefined
  const h = base?.nodeData?.height as number | undefined
  return w && h ? { w, h } : undefined
}

export function ImageOverlayConfig({ data, onUpdate, sources, nodeId }: ConfigProps<ImageOverlayData> & { nodeId?: string }) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const [editorOpen, setEditorOpen] = useState(false)
  const { addGenerated } = useImageOverlayLayers(nodeId ?? "", 0)
  const { addAiFinish } = useImageOverlayAiFinish(nodeId ?? "")
  const baseUrl = sources.find((s) => s.targetHandle === "image")?.value || sources.find((s) => !s.targetHandle)?.value
  const safeArea = overlayPlatformById(data.platform)?.safe
  const layers = Array.isArray(data.layers) ? data.layers : []
  const base = baseImageSize(sources)
  const connectedHandles = new Set(sources.map((s) => s.targetHandle))
  const canvas = data.canvas

  function updateLayer(i: number, patch: Partial<OverlayLayerConfig>, replace = false) {
    // Fill the holes up to `i` so a later handle's layer never shifts index.
    const next = Array.from({ length: Math.max(layers.length, i + 1) }, (_, k) => layers[k] ?? DEFAULT_OVERLAY_LAYER)
    onUpdate({ layers: next.map((l, k) => (k === i ? (replace ? { ...patch } as OverlayLayerConfig : { ...l, ...patch }) : l)) })
  }

  // Highest wired layer handle + 1, so the panel and the node agree on the count.
  const wiredSlotCount = sources.reduce((max, s) => Math.max(max, (OVERLAY_HANDLE_IDS as readonly string[]).indexOf(s.targetHandle ?? "") + 1), 0)
  const layerCount = visibleOverlayLayerCount(data.layerCount, layers.length, wiredSlotCount)

  const wiredSlots = OVERLAY_HANDLE_IDS.map((h) => connectedHandles.has(h))

  // One editor per handle the node shows (plus any wired beyond that).
  const visible = Array.from({ length: OVERLAY_MAX_LAYERS }, (_, i) => i).filter(
    (i) => i < layerCount || connectedHandles.has(OVERLAY_HANDLE_IDS[i]) || layers[i] !== undefined,
  )

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground px-1">{t("proccfg.overlay.intro")}</p>
      {nodeId && (
        <>
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setEditorOpen(true)}>
            <Maximize2 className="w-3.5 h-3.5 me-1.5" />
            {t("overlayEditor.open")}
          </Button>
          {editorOpen && <ImageOverlayEditor nodeId={nodeId} open={editorOpen} onOpenChange={setEditorOpen} />}
        </>
      )}
      {base && (
        <p className="text-[10px] text-muted-foreground px-1">{t("proccfg.overlay.baseSize", { w: base.w, h: base.h })}</p>
      )}

      <div>
        <Label className="text-xs">{t("proccfg.overlay.preset")}</Label>
        {/* Presets only fill layer 1 — a starting point, not a mode. */}
        <Select value="" onValueChange={(id) => {
          const preset = OVERLAY_PRESETS.find((p) => p.id === id)
          // A preset REPLACES the placement — height/fit/rotation included — so
          // a full-bleed height cannot linger under a watermark corner preset.
          if (preset) updateLayer(0, { ...DEFAULT_OVERLAY_LAYER, height: undefined, ...preset.layer }, true)
        }}>
          <SelectTrigger aria-label={t("proccfg.overlay.preset")}><SelectValue placeholder={t("proccfg.overlay.presetPlaceholder")} /></SelectTrigger>
          <SelectContent>
            {OVERLAY_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>{localizeOption(p.label)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visible.map((i) => (
        <div key={i} className="rounded-md border border-border/60 p-2">
          <OverlayLayerEditor
            index={i}
            layer={layers[i] ?? DEFAULT_OVERLAY_LAYER}
            connected={connectedHandles.has(OVERLAY_HANDLE_IDS[i])}
            base={base}
            onChange={(patch) => updateLayer(i, patch)}
            baseUrl={baseUrl}
            safeArea={safeArea}
            compact
          />
        </div>
      ))}

      {nodeId && (
        <div className="flex gap-1">
          <button type="button" className="flex-1 h-7 rounded-md border border-border/60 text-xs hover:bg-muted" onClick={() => addGenerated("text", wiredSlots)}>{t("overlayEditor.addText")}</button>
          <button type="button" className="flex-1 h-7 rounded-md border border-border/60 text-xs hover:bg-muted" onClick={() => addGenerated("qr", wiredSlots)}>{t("overlayEditor.addQr")}</button>
          <button type="button" className="flex-1 h-7 rounded-md border border-border/60 text-xs hover:bg-muted" onClick={() => addGenerated("shape", wiredSlots)}>{t("overlayEditor.addShape")}</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t("proccfg.overlay.layerHandles", { n: layerCount, max: OVERLAY_MAX_LAYERS })}</span>
        <div className="flex gap-1">
          <button
            type="button"
            className="h-7 px-2 rounded-md border border-border/60 text-xs hover:bg-muted disabled:opacity-40"
            disabled={layerCount <= 1 || connectedHandles.has(OVERLAY_HANDLE_IDS[layerCount - 1]) || layers[layerCount - 1] !== undefined}
            onClick={() => onUpdate({ layerCount: layerCount - 1 })}
          >
            {t("proccfg.overlay.removeLayer")}
          </button>
          <button
            type="button"
            className="h-7 px-2 rounded-md border border-border/60 text-xs hover:bg-muted disabled:opacity-40"
            disabled={layerCount >= OVERLAY_MAX_LAYERS}
            onClick={() => onUpdate({ layerCount: layerCount + 1 })}
          >
            {t("proccfg.overlay.addLayer")}
          </button>
        </div>
      </div>

      <div>
        <Label className="text-xs">{t("proccfg.overlay.outputFormat")}</Label>
        <Select value={data.outputFormat ?? "png"} onValueChange={(v) => onUpdate({ outputFormat: v })}>
          <SelectTrigger aria-label={t("proccfg.overlay.outputFormat")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="png">{t("proccfg.overlay.formatPng")}</SelectItem>
            <SelectItem value="jpg">{t("proccfg.overlay.formatJpg")}</SelectItem>
            <SelectItem value="webp">{t("proccfg.overlay.formatWebp")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {nodeId && (
        <div className="rounded-md border border-[#ff0073]/40 bg-[#ff0073]/5 p-2 space-y-1.5">
          <Button type="button" size="sm" className="w-full" onClick={() => { const id = addAiFinish(); if (id) toast.success(t("overlayAi.finishAdded")) }}>
            <Sparkles className="w-3.5 h-3.5 me-1.5" />
            {t("overlayAi.addFinish")}
          </Button>
          <p className="text-[10px] text-muted-foreground leading-snug">{t("overlayAi.finishHint")}</p>
        </div>
      )}

      <div>
        <Label className="text-xs">{t("overlayAi.maskMode")}</Label>
        <Select value={data.maskMode ?? "around"} onValueChange={(v) => onUpdate({ maskMode: v })}>
          <SelectTrigger aria-label={t("overlayAi.maskMode")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="around">{t("overlayAi.maskAround")}</SelectItem>
            <SelectItem value="layers">{t("overlayAi.maskLayers")}</SelectItem>
            <SelectItem value="outside">{t("overlayAi.maskOutside")}</SelectItem>
            <SelectItem value="none">{t("overlayAi.maskNone")}</SelectItem>
          </SelectContent>
        </Select>
        {(data.maskMode ?? "around") === "around" && (
          <div className="mt-1">
            <Label className="text-xs">{t("overlayAi.maskSpread")}</Label>
            <Input type="number" min={1} max={400} value={data.maskSpread ?? 48} onChange={(e) => onUpdate({ maskSpread: Math.min(400, Math.max(1, Math.round(Number(e.target.value) || 48))) })} />
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-1">{t("overlayAi.maskHint")}</p>
      </div>

      <div>
        <Label className="text-xs">{t("overlayPlatform.label")}</Label>
        <Select
          value={data.platform && overlayPlatformById(data.platform) ? data.platform : "none"}
          onValueChange={(id) => onUpdate(overlayPlatformPatch(id, data))}
        >
          <SelectTrigger aria-label={t("overlayPlatform.label")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("overlayPlatform.none")}</SelectItem>
            {OVERLAY_PLATFORMS.map((p) => (
              <SelectItem key={p.id} value={p.id}>{localizeOption(p.label)} · {p.width}×{p.height}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data.platform && overlayPlatformById(data.platform)?.note && (
          <p className="text-[10px] text-muted-foreground mt-1">{localizeOption(overlayPlatformById(data.platform)!.note!)}</p>
        )}
        <p className="text-[10px] text-muted-foreground mt-1">{t("overlayPlatform.hint")}</p>
      </div>

      <div>
        <Label className="text-xs">{t("overlayPlatform.exportAlso")}</Label>
        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
          {OVERLAY_PLATFORMS.map((p) => {
            const on = Array.isArray(data.variants) && data.variants.includes(p.id)
            return (
              <label key={p.id} className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-[#ff0073]"
                  checked={on}
                  onChange={(e) => {
                    const current = Array.isArray(data.variants) ? data.variants : []
                    const next = e.target.checked ? [...current, p.id] : current.filter((v) => v !== p.id)
                    onUpdate({ variants: next.length ? next.slice(0, OVERLAY_MAX_VARIANTS) : undefined })
                    // The handle goes with the tick — take its wires along so
                    // no invisible edge points at an output that no longer exists.
                    if (!e.target.checked && nodeId) {
                      const store = useWorkflowStore.getState()
                      const handle = overlayVariantHandle(p.id)
                      for (const ed of store.edges.filter((ed) => ed.source === nodeId && ed.sourceHandle === handle)) store.deleteEdge(ed.id)
                    }
                  }}
                />
                <span className="truncate" title={`${p.width}×${p.height}`}>{localizeOption(p.label)}</span>
              </label>
            )
          })}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">{t("overlayPlatform.exportHint")}</p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="ov-canvas" className="text-xs">{t("proccfg.overlay.customCanvas")}</Label>
          <Switch
            id="ov-canvas"
            checked={!!canvas}
            onCheckedChange={(on) =>
              onUpdate({ canvas: on ? { width: base?.w ?? 1920, height: base?.h ?? 1080, backgroundColor: "#000000" } : undefined, ...(on ? {} : { platform: undefined }) })
            }
          />
        </div>
        <p className="text-[10px] text-muted-foreground">{t("proccfg.overlay.customCanvasHint")}</p>
        {canvas && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t("proccfg.overlay.canvasWidth")}</Label>
              <Input type="number" min={16} max={8192} value={canvas.width} onChange={(e) => onUpdate({ canvas: { ...canvas, width: Math.min(8192, Math.max(16, Math.round(Number(e.target.value) || 16))) } })} />
            </div>
            <div>
              <Label className="text-xs">{t("proccfg.overlay.canvasHeight")}</Label>
              <Input type="number" min={16} max={8192} value={canvas.height} onChange={(e) => onUpdate({ canvas: { ...canvas, height: Math.min(8192, Math.max(16, Math.round(Number(e.target.value) || 16))) } })} />
            </div>
            <div>
              <Label className="text-xs">{t("proccfg.overlay.canvasBackground")}</Label>
              <Input type="color" value={canvas.backgroundColor} onChange={(e) => onUpdate({ canvas: { ...canvas, backgroundColor: e.target.value } })} />
            </div>
            <div>
              <Label className="text-xs">{t("proccfg.overlay.baseFit")}</Label>
              <Select value={data.baseFit ?? "contain"} onValueChange={(v) => onUpdate({ baseFit: v })}>
                <SelectTrigger aria-label={t("proccfg.overlay.baseFit")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contain">{t("proccfg.overlay.fitContain")}</SelectItem>
                  <SelectItem value="cover">{t("proccfg.overlay.fitCover")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground px-1">{t("proccfg.overlay.anchorsList", { anchors: OVERLAY_ANCHORS.join(", ") })}</p>
    </div>
  )
}
