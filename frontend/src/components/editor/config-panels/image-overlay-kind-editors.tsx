"use client"

import { useT } from "@/lib/i18n"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  OVERLAY_FONTS,
  OVERLAY_SHAPES,
  DEFAULT_OVERLAY_TEXT,
  DEFAULT_OVERLAY_QR,
  DEFAULT_OVERLAY_SHAPE,
  type OverlayImageEffects,
  type OverlayQrStyle,
  type OverlayShapeStyle,
  type OverlayTextStyle,
} from "@nodaro/shared"
import { overlayFontFamily } from "@/lib/overlay-fonts"
import { ShapeGlyph } from "@/components/nodes/image-overlay-kinds"
import { isOpenableLink } from "@/lib/image-overlay-labels"
import { ExternalLink, Link2 } from "lucide-react"

/** Per-kind settings for a layer: text typography, QR payload, shape look, image finishing. */

function Row({ id, label, value, min, max, step = 1, hint, onChange }: { id: string; label: string; value: number; min: number; max: number; step?: number; hint?: string; onChange: (v: number) => void }) {
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

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

export function TextStyleEditor({ index, style: raw, onChange }: { index: number; style: OverlayTextStyle | undefined; onChange: (style: OverlayTextStyle) => void }) {
  const t = useT()
  const style = { ...DEFAULT_OVERLAY_TEXT, ...(raw ?? {}) }
  const set = (patch: Partial<OverlayTextStyle>) => onChange({ ...style, ...patch })
  const font = OVERLAY_FONTS.find((f) => f.id === style.fontId) ?? OVERLAY_FONTS[0]
  const bg = style.background
  const stroke = style.stroke
  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={`ov-${index}-text`} className="text-xs">{t("overlayKinds.text")}</Label>
        <Textarea id={`ov-${index}-text`} rows={2} value={style.text} maxLength={500} onChange={(e) => set({ text: e.target.value })} style={{ fontFamily: overlayFontFamily(style.fontId) }} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">{t("overlayKinds.font")}</Label>
          <Select value={style.fontId} onValueChange={(v) => set({ fontId: v as OverlayTextStyle["fontId"] })}>
            <SelectTrigger aria-label={t("overlayKinds.font")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {OVERLAY_FONTS.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  <span style={{ fontFamily: overlayFontFamily(f.id) }}>{f.family}</span>
                  {(f.scripts as readonly string[]).includes("hebrew") && <span className="ms-1 text-[10px] text-muted-foreground">אב</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{t("overlayKinds.align")}</Label>
          <Select value={style.align} onValueChange={(v) => set({ align: v as OverlayTextStyle["align"] })}>
            <SelectTrigger aria-label={t("overlayKinds.align")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">{t("overlayKinds.alignLeft")}</SelectItem>
              <SelectItem value="center">{t("overlayKinds.alignCenter")}</SelectItem>
              <SelectItem value="right">{t("overlayKinds.alignRight")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Row id={`ov-${index}-fs`} label={t("overlayKinds.fontSize")} value={style.fontSize} min={1} max={50} step={0.5} hint="%" onChange={(v) => set({ fontSize: v })} />
      {font.variable && <Row id={`ov-${index}-fw`} label={t("overlayKinds.fontWeight")} value={style.fontWeight} min={100} max={900} step={100} onChange={(v) => set({ fontWeight: v })} />}
      <Row id={`ov-${index}-ls`} label={t("overlayKinds.letterSpacing")} value={style.letterSpacing} min={-0.2} max={1} step={0.01} hint="em" onChange={(v) => set({ letterSpacing: v })} />
      <Row id={`ov-${index}-lh`} label={t("overlayKinds.lineHeight")} value={style.lineHeight} min={0.8} max={2.5} step={0.05} onChange={(v) => set({ lineHeight: v })} />
      <div className="grid grid-cols-2 gap-2 items-end">
        <Color label={t("overlayKinds.textColor")} value={style.color} onChange={(v) => set({ color: v })} />
        <div className="flex items-center justify-between h-9">
          <Label htmlFor={`ov-${index}-upper`} className="text-xs">{t("overlayKinds.uppercase")}</Label>
          <Switch id={`ov-${index}-upper`} checked={style.uppercase} onCheckedChange={(v) => set({ uppercase: v })} />
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={`ov-${index}-tstroke`} className="text-xs">{t("overlayKinds.outline")}</Label>
          <Switch id={`ov-${index}-tstroke`} checked={!!stroke} onCheckedChange={(on) => set({ stroke: on ? { width: 4, color: "#000000" } : undefined })} />
        </div>
        {stroke && (
          <div className="grid grid-cols-2 gap-2">
            <Row id={`ov-${index}-tsw`} label={t("overlayKinds.outlineWidth")} value={stroke.width} min={0} max={50} hint="px" onChange={(v) => set({ stroke: { ...stroke, width: v } })} />
            <Color label={t("overlayKinds.outlineColor")} value={stroke.color} onChange={(v) => set({ stroke: { ...stroke, color: v } })} />
          </div>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={`ov-${index}-bg`} className="text-xs">{t("overlayKinds.background")}</Label>
          <Switch id={`ov-${index}-bg`} checked={!!bg} onCheckedChange={(on) => set({ background: on ? { color: "#ff0073", opacity: 1, padding: 24, radius: 999 } : undefined })} />
        </div>
        {bg && (
          <div className="grid grid-cols-2 gap-2">
            <Color label={t("overlayKinds.backgroundColor")} value={bg.color} onChange={(v) => set({ background: { ...bg, color: v } })} />
            <Row id={`ov-${index}-bgo`} label={t("proccfg.overlay.opacity")} value={Math.round(bg.opacity * 100)} min={0} max={100} hint="%" onChange={(v) => set({ background: { ...bg, opacity: v / 100 } })} />
            <Row id={`ov-${index}-bgp`} label={t("overlayKinds.padding")} value={bg.padding} min={0} max={300} hint="px" onChange={(v) => set({ background: { ...bg, padding: v } })} />
            <Row id={`ov-${index}-bgr`} label={t("proccfg.overlay.roundedCorners")} value={bg.radius} min={0} max={1000} hint="px" onChange={(v) => set({ background: { ...bg, radius: v } })} />
          </div>
        )}
      </div>
    </div>
  )
}

export function QrStyleEditor({ index, style: raw, wiredText, onChange }: { index: number; style: OverlayQrStyle | undefined; wiredText?: string; onChange: (style: OverlayQrStyle) => void }) {
  const t = useT()
  const style = { ...DEFAULT_OVERLAY_QR, ...(raw ?? {}) }
  const set = (patch: Partial<OverlayQrStyle>) => onChange({ ...style, ...patch })
  const fromInput = !!style.fromInput
  const shown = fromInput ? (wiredText ?? "") : style.text
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-[#ff0073]/50 bg-[#ff0073]/5 p-2 space-y-1">
        <div className="flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-[#ff0073]" aria-hidden />
          <Label htmlFor={`ov-${index}-qr`} className="text-xs font-medium">{t("overlayKinds.qrLinkTitle")}</Label>
          {isOpenableLink(shown) && (
            <a href={shown.trim()} target="_blank" rel="noreferrer noopener" className="ms-auto text-muted-foreground hover:text-[#ff0073]" aria-label={t("overlayKinds.qrOpen")} title={t("overlayKinds.qrOpen")}>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden />
            </a>
          )}
        </div>
        {fromInput ? (
          <div id={`ov-${index}-qr`} tabIndex={-1} className="min-h-8 rounded-md border border-dashed border-border/70 bg-background/60 px-2 py-1.5 text-xs">
            {wiredText ? (
              <span className="break-all">{wiredText}</span>
            ) : (
              <span className="text-muted-foreground">{t("overlayKinds.qrFromWorkflowEmpty")}</span>
            )}
          </div>
        ) : (
          <Input id={`ov-${index}-qr`} value={style.text} maxLength={2000} placeholder="https://" aria-label={t("overlayKinds.qrPayload")} onChange={(e) => set({ text: e.target.value })} />
        )}
        <div className="flex items-center justify-between pt-1">
          <Label htmlFor={`ov-${index}-qrwf`} className="text-[11px]">{t("overlayKinds.qrFromWorkflow")}</Label>
          <Switch id={`ov-${index}-qrwf`} checked={fromInput} onCheckedChange={(on) => set({ fromInput: on || undefined })} />
        </div>
        <p className="text-[10px] text-muted-foreground">{fromInput ? t("overlayKinds.qrFromWorkflowHint") : t("overlayKinds.qrLinkHint")}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 items-end">
        <Color label={t("overlayKinds.qrColor")} value={style.color} onChange={(v) => set({ color: v })} />
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor={`ov-${index}-qrbg`} className="text-xs">{t("overlayKinds.qrBackground")}</Label>
            <Switch id={`ov-${index}-qrbg`} checked={!!style.background} onCheckedChange={(on) => set({ background: on ? "#ffffff" : undefined })} />
          </div>
          {style.background && <Input type="color" value={style.background} onChange={(e) => set({ background: e.target.value })} />}
        </div>
      </div>
      <Row id={`ov-${index}-qrm`} label={t("overlayKinds.qrMargin")} value={style.margin} min={0} max={8} onChange={(v) => set({ margin: v })} />
    </div>
  )
}

export function ShapeStyleEditor({ index, style: raw, onChange }: { index: number; style: OverlayShapeStyle | undefined; onChange: (style: OverlayShapeStyle) => void }) {
  const t = useT()
  const style = { ...DEFAULT_OVERLAY_SHAPE, ...(raw ?? {}) }
  const set = (patch: Partial<OverlayShapeStyle>) => onChange({ ...style, ...patch })
  const stroke = style.stroke
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs">{t("overlayKinds.shape")}</Label>
        <div role="radiogroup" aria-label={t("overlayKinds.shape")} className="mt-1 grid grid-cols-4 gap-1">
          {OVERLAY_SHAPES.map((s) => {
            const on = style.shape === s
            const name = t(`overlayKinds.shape.${s}` as never)
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={name}
                title={name}
                className={`h-9 rounded-md border flex items-center justify-center transition-colors ${on ? "border-[#ff0073] text-[#ff0073] bg-[#ff0073]/10" : "border-border/70 text-foreground/70 hover:border-[#ff0073]/60 hover:text-foreground"}`}
                onClick={() => set({ shape: s })}
              >
                <ShapeGlyph shape={s} />
              </button>
            )
          })}
        </div>
      </div>
      <Color label={t("overlayKinds.fill")} value={style.color} onChange={(v) => set({ color: v })} />
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={`ov-${index}-sstroke`} className="text-xs">{t("overlayKinds.outline")}</Label>
          <Switch id={`ov-${index}-sstroke`} checked={!!stroke} onCheckedChange={(on) => set({ stroke: on ? { width: 4, color: "#ffffff" } : undefined })} />
        </div>
        {stroke && (
          <div className="grid grid-cols-2 gap-2">
            <Row id={`ov-${index}-ssw`} label={t("overlayKinds.outlineWidth")} value={stroke.width} min={0} max={50} hint="px" onChange={(v) => set({ stroke: { ...stroke, width: v } })} />
            <Color label={t("overlayKinds.outlineColor")} value={stroke.color} onChange={(v) => set({ stroke: { ...stroke, color: v } })} />
          </div>
        )}
      </div>
    </div>
  )
}

export function ImageEffectsEditor({ index, effects: raw, onChange }: { index: number; effects: OverlayImageEffects | undefined; onChange: (effects: OverlayImageEffects | undefined) => void }) {
  const t = useT()
  const effects = raw ?? {}
  const set = (patch: Partial<OverlayImageEffects>) => {
    const next = { ...effects, ...patch }
    const empty = !next.mask && !next.feather && !next.stroke && !next.glow
    onChange(empty ? undefined : next)
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">{t("overlayKinds.mask")}</Label>
          <Select value={effects.mask ?? "none"} onValueChange={(v) => set({ mask: v === "circle" ? "circle" : undefined })}>
            <SelectTrigger aria-label={t("overlayKinds.mask")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("overlayKinds.maskNone")}</SelectItem>
              <SelectItem value="circle">{t("overlayKinds.maskCircle")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Row id={`ov-${index}-feather`} label={t("overlayKinds.feather")} value={effects.feather ?? 0} min={0} max={500} hint="px" onChange={(v) => set({ feather: v > 0 ? v : undefined })} />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={`ov-${index}-istroke`} className="text-xs">{t("overlayKinds.outline")}</Label>
          <Switch id={`ov-${index}-istroke`} checked={!!effects.stroke} onCheckedChange={(on) => set({ stroke: on ? { width: 6, color: "#ffffff" } : undefined })} />
        </div>
        {effects.stroke && (
          <div className="grid grid-cols-2 gap-2">
            <Row id={`ov-${index}-isw`} label={t("overlayKinds.outlineWidth")} value={effects.stroke.width} min={0} max={50} hint="px" onChange={(v) => set({ stroke: { ...effects.stroke!, width: v } })} />
            <Color label={t("overlayKinds.outlineColor")} value={effects.stroke.color} onChange={(v) => set({ stroke: { ...effects.stroke!, color: v } })} />
          </div>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={`ov-${index}-glow`} className="text-xs">{t("overlayKinds.glow")}</Label>
          <Switch id={`ov-${index}-glow`} checked={!!effects.glow} onCheckedChange={(on) => set({ glow: on ? { blur: 24, color: "#ff0073", opacity: 0.8 } : undefined })} />
        </div>
        {effects.glow && (
          <div className="grid grid-cols-2 gap-2">
            <Row id={`ov-${index}-gb`} label={t("proccfg.overlay.shadowBlur")} value={effects.glow.blur} min={0} max={200} hint="px" onChange={(v) => set({ glow: { ...effects.glow!, blur: v } })} />
            <Row id={`ov-${index}-go`} label={t("proccfg.overlay.opacity")} value={Math.round(effects.glow.opacity * 100)} min={0} max={100} hint="%" onChange={(v) => set({ glow: { ...effects.glow!, opacity: v / 100 } })} />
            <Color label={t("overlayKinds.glowColor")} value={effects.glow.color} onChange={(v) => set({ glow: { ...effects.glow!, color: v } })} />
          </div>
        )}
      </div>
    </div>
  )
}
