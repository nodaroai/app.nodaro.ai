import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronUp, Eye, EyeOff, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Effect {
  type: string
  [key: string]: unknown
}

interface TextOverlay {
  text: string
  startFrame: number
  durationInFrames: number
  position: string
  fontSize: number
  fontFamily?: string
  color: string
  animation?: string
}

interface AfterEffectsPreviewProps {
  effectPlan: Record<string, unknown>
  fps: number
  onUpdate: (updated: Record<string, unknown>) => void
  onRegenerate?: () => void
  isGenerating?: boolean
}

const EFFECT_LABELS: Record<string, string> = {
  "color-grade": "Color Grade",
  vignette: "Vignette",
  "film-grain": "Film Grain",
  "noise-overlay": "Noise Overlay",
  letterbox: "Letterbox",
  "motion-blur": "Motion Blur",
  "animated-blur": "Animated Blur",
  trail: "Trail",
}

function EffectEditor({
  effect,
  onChange,
}: {
  effect: Effect
  onChange: (updated: Effect) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const label = EFFECT_LABELS[effect.type] ?? effect.type

  return (
    <div className="border border-[var(--border-primary)] rounded-md overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Wand2 className="w-3 h-3 text-[#ff0073]" />
          <span className="font-medium">{label}</span>
        </div>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          {effect.type === "color-grade" && (
            <>
              <SliderField label="Brightness" value={effect.brightness as number ?? 1} min={0.5} max={2} step={0.05} onChange={(v) => onChange({ ...effect, brightness: v })} />
              <SliderField label="Contrast" value={effect.contrast as number ?? 1} min={0.5} max={2} step={0.05} onChange={(v) => onChange({ ...effect, contrast: v })} />
              <SliderField label="Saturation" value={effect.saturation as number ?? 1} min={0} max={3} step={0.05} onChange={(v) => onChange({ ...effect, saturation: v })} />
              <SliderField label="Temperature" value={effect.temperature as number ?? 0} min={-100} max={100} step={1} onChange={(v) => onChange({ ...effect, temperature: v })} />
            </>
          )}
          {effect.type === "vignette" && (
            <>
              <SliderField label="Intensity" value={effect.intensity as number ?? 0.5} min={0} max={1} step={0.05} onChange={(v) => onChange({ ...effect, intensity: v })} />
              <SliderField label="Radius" value={effect.radius as number ?? 0.7} min={0.2} max={1} step={0.05} onChange={(v) => onChange({ ...effect, radius: v })} />
            </>
          )}
          {effect.type === "film-grain" && (
            <>
              <SliderField label="Intensity" value={effect.intensity as number ?? 0.3} min={0} max={1} step={0.05} onChange={(v) => onChange({ ...effect, intensity: v })} />
              <SliderField label="Size" value={effect.size as number ?? 2} min={1} max={4} step={0.1} onChange={(v) => onChange({ ...effect, size: v })} />
            </>
          )}
          {effect.type === "noise-overlay" && (
            <>
              <SliderField label="Opacity" value={effect.opacity as number ?? 0.1} min={0} max={0.5} step={0.01} onChange={(v) => onChange({ ...effect, opacity: v })} />
              <SliderField label="Scale" value={effect.scale as number ?? 0.005} min={0.001} max={0.01} step={0.001} onChange={(v) => onChange({ ...effect, scale: v })} />
            </>
          )}
          {effect.type === "letterbox" && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground">Aspect Ratio</span>
              <Select
                value={String(effect.ratio ?? 2.35)}
                onValueChange={(v) => onChange({ ...effect, ratio: parseFloat(v) })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2.35">2.35:1 (Cinemascope)</SelectItem>
                  <SelectItem value="2.39">2.39:1 (Anamorphic)</SelectItem>
                  <SelectItem value="1.85">1.85:1 (Widescreen)</SelectItem>
                  <SelectItem value="2.76">2.76:1 (Ultra Panavision)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {effect.type === "motion-blur" && (
            <>
              <SliderField label="Shutter Angle" value={effect.shutterAngle as number ?? 180} min={0} max={360} step={1} onChange={(v) => onChange({ ...effect, shutterAngle: v })} />
              <SliderField label="Samples" value={effect.samples as number ?? 10} min={1} max={16} step={1} onChange={(v) => onChange({ ...effect, samples: v })} />
            </>
          )}
          {effect.type === "animated-blur" && (
            <>
              <SliderField label="Start Blur" value={effect.startBlur as number ?? 20} min={0} max={50} step={1} onChange={(v) => onChange({ ...effect, startBlur: v })} />
              <SliderField label="End Blur" value={effect.endBlur as number ?? 0} min={0} max={50} step={1} onChange={(v) => onChange({ ...effect, endBlur: v })} />
              <SliderField label="Start Frame" value={effect.startFrame as number ?? 0} min={0} max={600} step={1} onChange={(v) => onChange({ ...effect, startFrame: v })} />
              <SliderField label="Duration (frames)" value={effect.durationFrames as number ?? 60} min={1} max={300} step={1} onChange={(v) => onChange({ ...effect, durationFrames: v })} />
            </>
          )}
          {effect.type === "trail" && (
            <>
              <SliderField label="Layers" value={effect.layers as number ?? 3} min={1} max={10} step={1} onChange={(v) => onChange({ ...effect, layers: v })} />
              <SliderField label="Lag (frames)" value={effect.lagInFrames as number ?? 1.5} min={0.5} max={5} step={0.5} onChange={(v) => onChange({ ...effect, lagInFrames: v })} />
              <SliderField label="Opacity" value={effect.trailOpacity as number ?? 0.4} min={0} max={1} step={0.05} onChange={(v) => onChange({ ...effect, trailOpacity: v })} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] font-mono text-muted-foreground">{value.toFixed(step >= 1 ? 0 : Math.max(2, -Math.floor(Math.log10(step))))}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[#ff0073]"
      />
    </div>
  )
}

export function AfterEffectsPreview({
  effectPlan,
  fps,
  onUpdate,
  onRegenerate,
  isGenerating,
}: AfterEffectsPreviewProps) {
  // Track all effects (including disabled) separately from the plan
  const [allEffects, setAllEffects] = useState<Effect[]>(() => (effectPlan.effects as Effect[]) ?? [])
  const textOverlays = useMemo(() => (effectPlan.textOverlays as TextOverlay[]) ?? [], [effectPlan])
  const [disabledEffects, setDisabledEffects] = useState<Set<number>>(new Set())
  const lastPlanIdRef = useRef<unknown>(effectPlan)

  // Reset when effectPlan changes externally (e.g., regeneration)
  useEffect(() => {
    if (effectPlan !== lastPlanIdRef.current && disabledEffects.size === 0) {
      setAllEffects((effectPlan.effects as Effect[]) ?? [])
      lastPlanIdRef.current = effectPlan
    }
  }, [effectPlan, disabledEffects.size])

  function handleEffectChange(index: number, updated: Effect) {
    const newAllEffects = allEffects.map((e, i) => (i === index ? updated : e))
    setAllEffects(newAllEffects)
    const enabledEffects = newAllEffects.filter((_, i) => !disabledEffects.has(i))
    onUpdate({ ...effectPlan, effects: enabledEffects })
  }

  function toggleEffect(index: number) {
    const next = new Set(disabledEffects)
    if (next.has(index)) {
      next.delete(index)
    } else {
      next.add(index)
    }
    setDisabledEffects(next)
    const enabledEffects = allEffects.filter((_, i) => !next.has(i))
    onUpdate({ ...effectPlan, effects: enabledEffects })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-primary)]">
          Effect Plan ({allEffects.length} effects)
        </span>
        {onRegenerate && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={onRegenerate}
            disabled={isGenerating}
          >
            Regenerate
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {allEffects.map((effect, i) => (
          <div key={i} className="flex items-start gap-1">
            <button
              type="button"
              className="mt-2 shrink-0"
              onClick={() => toggleEffect(i)}
              title={disabledEffects.has(i) ? "Enable effect" : "Disable effect"}
            >
              {disabledEffects.has(i) ? (
                <EyeOff className="w-3 h-3 text-muted-foreground/50" />
              ) : (
                <Eye className="w-3 h-3 text-[#ff0073]" />
              )}
            </button>
            <div className={`flex-1 ${disabledEffects.has(i) ? "opacity-40" : ""}`}>
              <EffectEditor
                effect={effect}
                onChange={(updated) => handleEffectChange(i, updated)}
              />
            </div>
          </div>
        ))}
      </div>

      {textOverlays.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-2">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Text Overlays
          </span>
          {textOverlays.map((overlay, i) => (
            <div
              key={i}
              className="px-2 py-1.5 rounded border border-[var(--border-primary)] text-xs"
            >
              <div className="font-medium truncate">{overlay.text}</div>
              <div className="text-[10px] text-muted-foreground">
                {overlay.position} &middot; {overlay.fontSize}px &middot;{" "}
                {(overlay.startFrame / fps).toFixed(1)}s–
                {((overlay.startFrame + overlay.durationInFrames) / fps).toFixed(1)}s
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
