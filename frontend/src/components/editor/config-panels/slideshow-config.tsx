"use client"

/**
 * Slideshow config — per the design sheet: perImageDuration is DISABLED (with
 * a "no audio" tag) while an audio track is wired (the audio is the ruler);
 * the transition TYPE comes from the wired transition parameter node (only
 * its duration lives here); motion adds `alternate` (flips zoom in/out per
 * slide); the rest mirrors Still to Video. padColor stays disabled-not-hidden
 * until fit=contain. The OUTPUT footer shows length · frames · slides.
 */
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { useT, tx } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useProbedAudioDuration, formatClipLength } from "@/hooks/use-probed-audio-duration"
import type { ConfigProps } from "./types"
import type { SlideshowData } from "@/types/nodes"

type Motion = SlideshowData["motion"]

// Function, not a const: a module-level table built with `tx()` at load time
// would freeze on the boot locale (see EFFORT_LABELS in reasoning-effort-select).
function MOTION_OPTIONS(): ReadonlyArray<{ value: Motion; label: string; glyph: string }> {
  return [
    { value: "none", label: tx("pubDialog.noneOption"), glyph: "—" },
    { value: "zoom-in", label: tx("cfgext.slideZoomIn"), glyph: "+" },
    { value: "zoom-out", label: tx("cfgext.slideZoomOut"), glyph: "−" },
    { value: "ken-burns", label: tx("cfgext.slideKenBurns"), glyph: "⤡" },
    { value: "alternate", label: tx("cfgext.slideAlternate"), glyph: "+−" },
  ]
}

const RESOLUTION_OPTIONS = ["720p", "1080p", "4K"] as const
const FPS_OPTIONS = [24, 30] as const
const ASPECT_OPTIONS: ReadonlyArray<{ value: SlideshowData["aspectRatio"]; w: number; h: number }> = [
  { value: "16:9", w: 20, h: 11 },
  { value: "9:16", w: 11, h: 18 },
  { value: "1:1", w: 15, h: 15 },
  { value: "4:3", w: 18, h: 14 },
]

/** Mirrors the worker's intensity→rate mapping (1 → +0.0002/f … 10 → +0.0015/f). */
function intensityRateLabel(intensity: number): string {
  const i = Math.min(10, Math.max(1, intensity))
  const rate = 0.0002 + ((i - 1) * (0.0015 - 0.0002)) / 9
  return `zoom+${rate.toFixed(4)}/f`
}

function SegmentedControl<T extends string | number>({ options, value, onChange, ariaLabel }: {
  readonly options: ReadonlyArray<T>
  readonly value: T
  readonly onChange: (v: T) => void
  readonly ariaLabel: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-1 p-0.5 rounded-lg bg-muted/50 border border-border">
      {options.map((opt) => (
        <button
          key={String(opt)}
          type="button"
          role="radio"
          aria-checked={value === opt}
          onClick={() => onChange(opt)}
          className={cn(
            "flex-1 h-7 rounded-md text-xs transition-colors",
            value === opt ? "bg-background text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {String(opt)}
        </button>
      ))}
    </div>
  )
}

export function SlideshowConfig({ data, onUpdate, sources }: ConfigProps<SlideshowData>) {
  const t = useT()
  const motion = data.motion ?? "none"
  const intensity = data.intensity ?? 3
  const fit = data.fit ?? "cover"
  const fps = data.fps ?? 30
  const motionEnabled = motion !== "none"

  const audioUrl = sources.find((s) => s.targetHandle === "audio")?.value || undefined
  const hasAudio = !!audioUrl
  const audioDuration = useProbedAudioDuration(audioUrl)
  const transitionPick = sources.find((s) => s.type === "transition")?.value || undefined
  const slideCount = data.lastSlideCount

  const totalSeconds = audioDuration ?? (slideCount ? slideCount * (data.perImageDuration ?? 3) : undefined)

  return (
    <div className="flex flex-col gap-4">
      {/* perImageDuration — the ruler ONLY when no audio is wired */}
      <div className={cn("flex flex-col gap-2", hasAudio && "opacity-40 pointer-events-none")}>
        <div className="flex items-center gap-2">
          <Label htmlFor="slideshow-per-image">{t("cfgext.slidePerImage")}</Label>
          <span className="px-1.5 py-0.5 rounded bg-muted text-[9px] font-mono text-muted-foreground">{t("cfgext.slideNoAudioTag")}</span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            id="slideshow-per-image"
            type="number"
            min={0.5}
            max={60}
            step={0.5}
            className="w-24 h-8"
            value={data.perImageDuration ?? 3}
            onChange={(e) => onUpdate({ perImageDuration: Math.min(60, Math.max(0.5, parseFloat(e.target.value) || 3)) })}
            disabled={hasAudio}
          />
          <span className="text-[11px] text-muted-foreground">{t("cfgext.slideSecPerSlide")}{hasAudio ? t("cfgext.slideAudioSetsLength") : ""}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="slideshow-transition-duration">{t("proccfg.transition")}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="slideshow-transition-duration"
            type="number"
            min={0}
            max={5}
            step={0.1}
            className="w-24 h-8"
            value={data.transitionDuration ?? 0.5}
            onChange={(e) => onUpdate({ transitionDuration: Math.min(5, Math.max(0, parseFloat(e.target.value) || 0)) })}
          />
          <span className="text-[11px] text-muted-foreground">{t("cfgext.slideSec")}</span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-snug">
          {t("proccfg.transition")} <span className="text-foreground font-mono">{transitionPick ?? "cut"}</span>{" "}
          {transitionPick ? t("cfgext.slideTransitionFromNode") : t("cfgext.slideTransitionWireHint")}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Label>{t("field.motion")}</Label>
          <span className="text-[10px] text-muted-foreground">{t("cfgext.slidePerSlide")}</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {MOTION_OPTIONS().map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={motion === opt.value}
              onClick={() => onUpdate({ motion: opt.value })}
              className={cn(
                "flex flex-col items-center gap-1 px-1.5 py-2 rounded-lg border text-[10.5px] transition-colors",
                motion === opt.value
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60",
              )}
            >
              <span className="flex items-center justify-center w-8 h-5 rounded border border-current/40 text-xs leading-none">{opt.glyph}</span>
              {opt.label}
            </button>
          ))}
        </div>
        {motion === "alternate" && (
          <p className="text-[10px] text-muted-foreground">{t("cfgext.slideAlternateHint")}</p>
        )}
      </div>

      <div className={cn("flex flex-col gap-2", !motionEnabled && "opacity-40 pointer-events-none")}>
        <div className="flex items-baseline justify-between">
          <Label>{t("paramcfg.intensity")}</Label>
          <span className="text-[11px] font-mono text-foreground">
            {intensity} <span className="text-muted-foreground">· {intensityRateLabel(intensity)}</span>
          </span>
        </div>
        <div className="flex items-center gap-1" role="slider" aria-label={t("paramcfg.intensity")} aria-valuemin={1} aria-valuemax={10} aria-valuenow={intensity}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((step) => (
            <button
              key={step}
              type="button"
              aria-label={t("cfgext.slideIntensityStep", { step })}
              onClick={() => onUpdate({ intensity: step })}
              className={cn(
                "flex-1 h-5 rounded transition-colors",
                step <= intensity ? "bg-primary" : "bg-muted hover:bg-muted-foreground/30",
              )}
            />
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground"><span>{t("cfgext.slideSubtle")}</span><span>{t("cfgext.slideStrong")}</span></div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("field.resolution")}</Label>
        <SegmentedControl options={RESOLUTION_OPTIONS} value={data.resolution ?? "1080p"} onChange={(v) => onUpdate({ resolution: v })} ariaLabel={t("field.resolution")} />
      </div>

      <div className="flex gap-3">
        <div className="flex-[1.6] flex flex-col gap-2">
          <Label>{t("field.aspectRatio")}</Label>
          <div className="grid grid-cols-4 gap-1.5">
            {ASPECT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={(data.aspectRatio ?? "16:9") === opt.value}
                onClick={() => onUpdate({ aspectRatio: opt.value })}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 h-11 rounded-lg border transition-colors",
                  (data.aspectRatio ?? "16:9") === opt.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60",
                )}
              >
                <span className="rounded-[2px] border border-current" style={{ width: opt.w, height: opt.h }} />
                <span className="text-[9px] font-mono">{opt.value}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 flex flex-col gap-2">
          <Label>FPS</Label>
          <SegmentedControl options={FPS_OPTIONS} value={fps} onChange={(v) => onUpdate({ fps: v })} ariaLabel="FPS" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("cfgext.slideFit")}</Label>
        <div className="flex gap-2">
          {([
            { value: "cover", label: "cover", hint: t("cfgext.slideFitCoverHint") },
            { value: "contain", label: "contain", hint: t("cfgext.slideFitContainHint") },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={fit === opt.value}
              onClick={() => onUpdate({ fit: opt.value })}
              className={cn(
                "flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg border text-start transition-colors",
                fit === opt.value ? "border-primary bg-primary/10" : "border-border bg-muted/30 hover:bg-muted/60",
              )}
            >
              <span className={cn("w-6 h-4 rounded-[3px] shrink-0", opt.value === "cover" ? "bg-primary" : "border border-current flex items-center justify-center")}>
                {opt.value === "contain" && <span className="block w-2 h-3 rounded-[1px] bg-muted-foreground" />}
              </span>
              <span className="flex flex-col">
                <span className={cn("text-xs", fit === opt.value ? "text-foreground" : "text-muted-foreground")}>{opt.label}</span>
                <span className="text-[9px] text-muted-foreground">{opt.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={cn("flex flex-col gap-2", fit !== "contain" && "opacity-40 pointer-events-none")}>
        <div className="flex items-center gap-2">
          <Label htmlFor="slideshow-pad-color">{t("proccfg.padColor")}</Label>
          <span className="px-1.5 py-0.5 rounded bg-muted text-[9px] font-mono text-muted-foreground">fit = contain</span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            id="slideshow-pad-color"
            type="color"
            className="w-10 h-8 p-0.5 cursor-pointer"
            value={data.padColor ?? "#000000"}
            onChange={(e) => onUpdate({ padColor: e.target.value })}
            disabled={fit !== "contain"}
          />
          <span className="text-[11px] font-mono text-muted-foreground">{data.padColor ?? "#000000"}</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-border">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] tracking-wider text-muted-foreground">{t("cfgext.slideOutput")}</span>
          <span className="text-xs font-mono text-foreground">
            {totalSeconds !== undefined
              ? <>{formatClipLength(totalSeconds)} <span className="text-muted-foreground">· {t("cfgext.slideFramesCount", { count: Math.ceil(totalSeconds * fps) })}{slideCount ? ` · ${t("cfgext.slideSlidesCount", { count: slideCount })}` : ""}</span></>
              : hasAudio ? "…" : t("cfgext.slideLengthFromImages")}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground text-end max-w-[140px] leading-snug">
          {hasAudio ? t("cfgext.slideLengthFollowsAudio") : t("cfgext.slideNoAudioSilent")}
        </span>
      </div>
    </div>
  )
}
