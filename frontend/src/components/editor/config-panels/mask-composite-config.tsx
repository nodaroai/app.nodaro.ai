"use client"

import {
  MASK_COMPOSITE_AUDIO_SOURCES,
  MASK_COMPOSITE_BACKGROUND_FITS,
  MASK_COMPOSITE_BOUNDS,
  MASK_COMPOSITE_FILLS,
  maskCompositeUsesForeground,
  resolveMaskCompositeSettings,
  type MaskCompositeAudioSource,
  type MaskCompositeBackgroundFit,
  type MaskCompositeFill,
} from "@nodaro/shared/media"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT, type MessageKey } from "@/lib/i18n"
import type { MaskCompositeData } from "@/types/nodes"

/** Option captions, keyed by the shared enums — a new value fails tsc here. */
export const MASK_COMPOSITE_FIT_LABEL_KEYS: Record<MaskCompositeBackgroundFit, MessageKey> = {
  cover: "proccfg.maskCompositeFitCover",
  contain: "proccfg.maskCompositeFitContain",
  stretch: "proccfg.maskCompositeFitStretch",
}

export const MASK_COMPOSITE_FILL_LABEL_KEYS: Record<MaskCompositeFill, MessageKey> = {
  video: "proccfg.maskCompositeFillVideo",
  pixelate: "proccfg.maskCompositeFillPixelate",
  blur: "proccfg.maskCompositeFillBlur",
}

export const MASK_COMPOSITE_AUDIO_LABEL_KEYS: Record<MaskCompositeAudioSource, MessageKey> = {
  foreground: "proccfg.maskCompositeAudioForeground",
  background: "proccfg.maskCompositeAudioBackground",
  mix: "proccfg.maskCompositeAudioMix",
  none: "proccfg.maskCompositeAudioNone",
}

/**
 * Mask Composite settings. Values are read through `resolveMaskCompositeSettings`
 * (the normaliser both engines and the worker call), so a node written straight
 * into workflow JSON shows what it will render. Bounds: `MASK_COMPOSITE_BOUNDS`.
 */
export function MaskCompositeConfig({ data, onUpdate }: { data: MaskCompositeData; onUpdate: (patch: Partial<MaskCompositeData>) => void }) {
  const t = useT()
  const s = resolveMaskCompositeSettings(data)
  const b = MASK_COMPOSITE_BOUNDS
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground px-1">{t("proccfg.maskCompositeDesc")}</p>

      <div>
        <Label>{t("proccfg.maskCompositeFill")}</Label>
        <Select value={s.fill} onValueChange={(v) => onUpdate({ fill: v as MaskCompositeFill })}>
          <SelectTrigger aria-label={t("proccfg.maskCompositeFill")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {MASK_COMPOSITE_FILLS.map((fill) => (
              <SelectItem key={fill} value={fill}>{t(MASK_COMPOSITE_FILL_LABEL_KEYS[fill])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">{t("proccfg.maskCompositeFillHint")}</p>
      </div>

      {s.fill === "pixelate" && (
        <div>
          <Label htmlFor="mask-composite-pixel-size">{t("proccfg.maskCompositePixelSizePct", { n: s.pixelSizePct })}</Label>
          <input
            id="mask-composite-pixel-size"
            type="range"
            min={b.PIXEL_SIZE_PCT_MIN}
            max={b.PIXEL_SIZE_PCT_MAX}
            step={0.05}
            value={s.pixelSizePct}
            onChange={(e) => onUpdate({ pixelSizePct: Math.round(parseFloat(e.target.value) * 100) / 100 })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <p className="text-[10px] text-muted-foreground mt-1">{t("proccfg.maskCompositePixelSizePctHint")}</p>
        </div>
      )}

      {s.fill === "blur" && (
        <div>
          <Label htmlFor="mask-composite-blur-strength">{t("proccfg.maskCompositeBlurStrengthPct", { n: s.blurStrengthPct })}</Label>
          <input
            id="mask-composite-blur-strength"
            type="range"
            min={b.BLUR_STRENGTH_PCT_MIN}
            max={b.BLUR_STRENGTH_PCT_MAX}
            step={0.1}
            value={s.blurStrengthPct}
            onChange={(e) => onUpdate({ blurStrengthPct: Math.round(parseFloat(e.target.value) * 100) / 100 })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <p className="text-[10px] text-muted-foreground mt-1">{t("proccfg.maskCompositeBlurStrengthPctHint")}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="mask-composite-invert"
          checked={s.invertMask}
          onChange={(e) => onUpdate({ invertMask: e.target.checked })}
          className="accent-[#ff0073]"
        />
        <Label htmlFor="mask-composite-invert" className="mb-0">{t("proccfg.maskCompositeInvert")}</Label>
      </div>
      <p className="text-[10px] text-muted-foreground -mt-2">{t("proccfg.maskCompositeInvertHint")}</p>

      <div>
        <Label htmlFor="mask-composite-feather">{t("proccfg.maskCompositeFeather", { n: s.feather })}</Label>
        <input
          id="mask-composite-feather"
          type="range"
          min={b.FEATHER_MIN}
          max={b.FEATHER_MAX}
          step={1}
          value={s.feather}
          onChange={(e) => onUpdate({ feather: parseInt(e.target.value, 10) })}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
        />
        <p className="text-[10px] text-muted-foreground mt-1">{t("proccfg.maskCompositeFeatherHint")}</p>
      </div>

      <div>
        <Label htmlFor="mask-composite-grow">{t("proccfg.maskCompositeGrow", { n: s.grow })}</Label>
        <input
          id="mask-composite-grow"
          type="range"
          min={b.GROW_MIN}
          max={b.GROW_MAX}
          step={1}
          value={s.grow}
          onChange={(e) => onUpdate({ grow: parseInt(e.target.value, 10) })}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
        />
        <p className="text-[10px] text-muted-foreground mt-1">{t("proccfg.maskCompositeGrowHint")}</p>
      </div>

      <div>
        <Label htmlFor="mask-composite-opacity">{t("proccfg.maskCompositeOpacity", { n: Math.round(s.opacity * 100) })}</Label>
        <input
          id="mask-composite-opacity"
          type="range"
          min={Math.round(b.OPACITY_MIN * 100)}
          max={Math.round(b.OPACITY_MAX * 100)}
          step={1}
          value={Math.round(s.opacity * 100)}
          onChange={(e) => onUpdate({ opacity: parseInt(e.target.value, 10) / 100 })}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
        />
        <p className="text-[10px] text-muted-foreground mt-1">{t("proccfg.maskCompositeOpacityHint")}</p>
      </div>

      {/* Pixelate / blur: the background is the frame (nothing to fit) and the only sound — both controls do nothing there. */}
      {maskCompositeUsesForeground(s.fill) && (
        <>
          <div>
            <Label>{t("proccfg.maskCompositeBackgroundFit")}</Label>
            <Select value={s.backgroundFit} onValueChange={(v) => onUpdate({ backgroundFit: v as MaskCompositeBackgroundFit })}>
              <SelectTrigger aria-label={t("proccfg.maskCompositeBackgroundFit")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {MASK_COMPOSITE_BACKGROUND_FITS.map((fit) => (
                  <SelectItem key={fit} value={fit}>{t(MASK_COMPOSITE_FIT_LABEL_KEYS[fit])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>{t("proccfg.maskCompositeAudio")}</Label>
            <Select value={s.audioSource} onValueChange={(v) => onUpdate({ audioSource: v as MaskCompositeAudioSource })}>
              <SelectTrigger aria-label={t("proccfg.maskCompositeAudio")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {MASK_COMPOSITE_AUDIO_SOURCES.map((src) => (
                  <SelectItem key={src} value={src}>{t(MASK_COMPOSITE_AUDIO_LABEL_KEYS[src])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </div>
  )
}
