"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { OVERLAY_HANDLE_IDS, type OverlayAnchor, type OverlayLayerConfig } from "@/types/nodes"
import { TextStyleEditor, QrStyleEditor, ShapeStyleEditor, ImageEffectsEditor } from "./image-overlay-kind-editors"
import { suggestOverlayPlacement } from "@/lib/api"

/** The 3×3 anchor picker, laid out like the base image. */
const ANCHOR_GRID: ReadonlyArray<ReadonlyArray<OverlayAnchor>> = [
  ["top-left", "top", "top-right"],
  ["left", "center", "right"],
  ["bottom-left", "bottom", "bottom-right"],
]

function px(pct: number, total: number | undefined): string {
  return total ? ` ≈ ${Math.round((pct / 100) * total)}px` : ""
}

function PctSlider({
  id, label, value, min, max, step = 1, onChange, hint,
}: {
  id: string; label: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; hint?: string
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs">{label}</Label>
        <span className="text-[10px] tabular-nums text-muted-foreground">{value}{hint ?? ""}</span>
      </div>
      <Slider id={id} value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
    </div>
  )
}

/**
 * One of the three groups every layer's controls fall into. Content and
 * Placement open by default; Style (blend, shadow — the rare ones) starts
 * folded with a one-line summary, so the panel reads top-down as "what it
 * is → where it goes → how it looks" instead of seventeen stacked controls.
 */
function Section({ title, summary, defaultOpen = true, children }: { title: string; summary?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-md border border-border/60">
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-start"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden /> : <ChevronRight className="w-3 h-3 text-muted-foreground" aria-hidden />}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        {!open && summary && <span className="ms-auto text-[10px] text-muted-foreground truncate">{summary}</span>}
      </button>
      {open && <div className="px-2 pb-2 space-y-2">{children}</div>}
    </section>
  )
}

/**
 * The selected layer's controls, shared by the config panel and the full
 * editor. Grouped Content / Placement / Style; the QR's destination link
 * sits first because it is the point of that layer.
 */
export function OverlayLayerEditor({
  index, layer, connected, base, onChange, baseUrl, safeArea, compact = false, wiredQrText,
}: {
  index: number
  layer: OverlayLayerConfig
  connected: boolean
  base: { w: number; h: number } | undefined
  onChange: (patch: Partial<OverlayLayerConfig>) => void
  /** The base image URL — enables "Suggest placement". */
  baseUrl?: string
  safeArea?: { x: number; y: number; w: number; h: number }
  /** Sidebar mode: several layers stack, so only Content starts open. */
  compact?: boolean
  /** Text currently wired into the node's QR link handle (shown for fromInput QR layers). */
  wiredQrText?: string
}) {
  const t = useT()
  const [suggesting, setSuggesting] = useState(false)
  async function suggest() {
    if (!baseUrl) return
    setSuggesting(true)
    try {
      const kindWord = layer.kind === "text" ? `a headline: "${layer.text?.text ?? ""}"` : layer.kind === "qr" ? "a QR code" : layer.kind === "shape" ? "a badge" : "a logo"
      const aspect = layer.kind === "qr" ? 1 : layer.kind === "shape" ? (layer.width || 30) / (layer.height || 8) : 2
      const { placement } = await suggestOverlayPlacement({ imageUrl: baseUrl, layerAspect: aspect, intent: kindWord, safeArea })
      const patch: Partial<OverlayLayerConfig> = { anchor: placement.anchor as OverlayAnchor, x: placement.x, y: placement.y }
      if (layer.kind !== "text") patch.width = placement.width
      onChange(patch)
      toast.success(placement.reason)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("overlayAi.suggestFailed"))
    } finally {
      setSuggesting(false)
    }
  }
  const handleId = OVERLAY_HANDLE_IDS[index]
  const shadow = layer.shadow
  const kind = layer.kind ?? "image"
  const sizeByWidth = kind !== "text"
  const blendName = t(`proccfg.overlay.blend${layer.blend === "multiply" ? "Multiply" : layer.blend === "screen" ? "Screen" : "Over"}` as never)
  const styleSummary = `${Math.round(layer.opacity * 100)}% · ${blendName}${shadow ? ` · ${t("proccfg.overlay.shadow")}` : ""}`

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-xs font-medium">
          {t("proccfg.overlay.layerN", { n: index + 1 })}
          <span className="ms-1.5 text-[10px] font-normal text-muted-foreground">{t(`overlayKinds.kind.${kind}` as never)}</span>
        </span>
        {kind === "image" ? (
          <span className={`text-[10px] ${connected ? "text-emerald-500" : "text-muted-foreground"}`}>
            {connected ? t("proccfg.overlay.connected", { handle: handleId }) : t("proccfg.overlay.notConnected", { handle: handleId })}
          </span>
        ) : (
          <button type="button" className="text-[10px] text-muted-foreground hover:text-red-500" onClick={() => onChange({ kind: undefined, text: undefined, qr: undefined, shape: undefined })}>
            {t("overlayKinds.remove")}
          </button>
        )}
      </div>

      <Section title={t("overlayEditor.section.content")}>
        {kind === "text" && <TextStyleEditor index={index} style={layer.text} onChange={(text) => onChange({ text })} />}
        {kind === "qr" && <QrStyleEditor index={index} style={layer.qr} wiredText={wiredQrText} onChange={(qr) => onChange({ qr })} />}
        {kind === "shape" && <ShapeStyleEditor index={index} style={layer.shape} onChange={(shape) => onChange({ shape })} />}
        {kind === "image" && (
          <>
            {!connected && <p className="text-[10px] text-muted-foreground">{t("overlayEditor.wireHint", { handle: handleId })}</p>}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">{t("proccfg.overlay.height")}</Label>
                <Input
                  type="number" min={1} max={100} step={1}
                  placeholder={t("proccfg.overlay.heightAuto")}
                  value={layer.height ?? ""}
                  onChange={(e) => onChange({ height: e.target.value === "" ? undefined : Math.min(100, Math.max(1, Number(e.target.value))) })}
                />
              </div>
              <div>
                <Label className="text-xs">{t("proccfg.overlay.roundedCorners")}</Label>
                <Input
                  type="number" min={0} max={500} step={1} placeholder="0"
                  value={layer.roundedCorners ?? ""}
                  onChange={(e) => onChange({ roundedCorners: e.target.value === "" ? undefined : Math.min(500, Math.max(0, Math.round(Number(e.target.value)))) })}
                />
              </div>
            </div>
            {layer.height !== undefined && (
              <div>
                <Label className="text-xs">{t("proccfg.overlay.fit")}</Label>
                <Select value={layer.fit} onValueChange={(v) => onChange({ fit: v as OverlayLayerConfig["fit"] })}>
                  <SelectTrigger aria-label={t("proccfg.overlay.fit")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contain">{t("proccfg.overlay.fitContain")}</SelectItem>
                    <SelectItem value="cover">{t("proccfg.overlay.fitCover")}</SelectItem>
                    <SelectItem value="stretch">{t("proccfg.overlay.fitStretch")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <ImageEffectsEditor index={index} effects={layer.effects} onChange={(effects) => onChange({ effects })} />
          </>
        )}
      </Section>

      <Section title={t("overlayEditor.section.placement")} summary={`${layer.anchor} · ${layer.width}%`} defaultOpen={!compact}>
        {baseUrl && (
          <Button type="button" variant="outline" size="sm" className="w-full" disabled={suggesting} onClick={() => void suggest()}>
            <Wand2 className="w-3.5 h-3.5 me-1.5" />
            {suggesting ? t("overlayAi.suggesting") : t("overlayAi.suggestPlacement")}
          </Button>
        )}
        <div className="flex items-start gap-3">
          <div>
            <Label className="text-xs">{t("proccfg.overlay.anchor")}</Label>
            <div className="grid grid-cols-3 gap-1 w-24 mt-1" role="radiogroup" aria-label={t("proccfg.overlay.anchor")}>
              {ANCHOR_GRID.flat().map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={layer.anchor === a}
                  aria-label={a}
                  title={a}
                  className={`h-6 rounded border ${layer.anchor === a ? "bg-[#ff0073] border-[#ff0073]" : "bg-muted/40 border-border/60 hover:bg-muted"}`}
                  onClick={() => onChange({ anchor: a })}
                />
              ))}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-5 flex-1">{t("proccfg.overlay.anchorHint")}</p>
        </div>
        {sizeByWidth && <PctSlider id={`ov-${index}-w`} label={t("proccfg.overlay.width")} value={layer.width} min={1} max={100} hint={`%${px(layer.width, base?.w)}`} onChange={(v) => onChange({ width: v })} />}
        {kind === "shape" && <PctSlider id={`ov-${index}-h`} label={t("proccfg.overlay.height")} value={layer.height ?? 8} min={1} max={100} hint={`%${px(layer.height ?? 8, base?.h)}`} onChange={(v) => onChange({ height: v })} />}
        <PctSlider id={`ov-${index}-x`} label={t("proccfg.overlay.offsetX")} value={layer.x} min={-100} max={100} hint={`%${px(layer.x, base?.w)}`} onChange={(v) => onChange({ x: v })} />
        <PctSlider id={`ov-${index}-y`} label={t("proccfg.overlay.offsetY")} value={layer.y} min={-100} max={100} hint={`%${px(layer.y, base?.h)}`} onChange={(v) => onChange({ y: v })} />
        <PctSlider id={`ov-${index}-r`} label={t("proccfg.overlay.rotation")} value={layer.rotation} min={-180} max={180} hint="°" onChange={(v) => onChange({ rotation: v })} />
        <div>
          <Label className="text-xs">{t("proccfg.overlay.zIndex")}</Label>
          <Input
            type="number" min={0} max={100} step={1}
            placeholder={String(index)}
            value={layer.zIndex ?? ""}
            onChange={(e) => onChange({ zIndex: e.target.value === "" ? undefined : Math.min(100, Math.max(0, Math.round(Number(e.target.value)))) })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">{t("proccfg.overlay.zIndexHint")}</p>
        </div>
      </Section>

      <Section title={t("overlayEditor.section.style")} summary={styleSummary} defaultOpen={false}>
        <PctSlider id={`ov-${index}-o`} label={t("proccfg.overlay.opacity")} value={Math.round(layer.opacity * 100)} min={0} max={100} hint="%" onChange={(v) => onChange({ opacity: v / 100 })} />
        <div>
          <Label className="text-xs">{t("proccfg.overlay.blend")}</Label>
          <Select value={layer.blend} onValueChange={(v) => onChange({ blend: v as OverlayLayerConfig["blend"] })}>
            <SelectTrigger aria-label={t("proccfg.overlay.blend")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="over">{t("proccfg.overlay.blendOver")}</SelectItem>
              <SelectItem value="multiply">{t("proccfg.overlay.blendMultiply")}</SelectItem>
              <SelectItem value="screen">{t("proccfg.overlay.blendScreen")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor={`ov-${index}-shadow`} className="text-xs">{t("proccfg.overlay.shadow")}</Label>
            <Switch
              id={`ov-${index}-shadow`}
              checked={!!shadow}
              onCheckedChange={(on) => onChange({ shadow: on ? { blur: 24, offsetX: 0, offsetY: 12, color: "#000000", opacity: 0.5 } : undefined })}
            />
          </div>
          {shadow && (
            <div className="grid grid-cols-2 gap-2">
              <PctSlider id={`ov-${index}-sb`} label={t("proccfg.overlay.shadowBlur")} value={shadow.blur} min={0} max={200} hint="px" onChange={(v) => onChange({ shadow: { ...shadow, blur: v } })} />
              <PctSlider id={`ov-${index}-so`} label={t("proccfg.overlay.shadowOpacity")} value={Math.round(shadow.opacity * 100)} min={0} max={100} hint="%" onChange={(v) => onChange({ shadow: { ...shadow, opacity: v / 100 } })} />
              <PctSlider id={`ov-${index}-sx`} label={t("proccfg.overlay.shadowOffsetX")} value={shadow.offsetX} min={-200} max={200} hint="px" onChange={(v) => onChange({ shadow: { ...shadow, offsetX: v } })} />
              <PctSlider id={`ov-${index}-sy`} label={t("proccfg.overlay.shadowOffsetY")} value={shadow.offsetY} min={-200} max={200} hint="px" onChange={(v) => onChange({ shadow: { ...shadow, offsetY: v } })} />
              <div className="col-span-2">
                <Label className="text-xs">{t("proccfg.overlay.shadowColor")}</Label>
                <Input type="color" value={shadow.color} onChange={(e) => onChange({ shadow: { ...shadow, color: e.target.value } })} />
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}
