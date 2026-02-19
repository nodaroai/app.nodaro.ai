import { useEffect, useRef, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"

interface TextObject {
  id: string
  type: "3d-text"
  text: string
  font: string
  size: number
  depth: number
  material: { type: string; color: string; metalness?: number; roughness?: number; emissiveIntensity?: number }
  position: [number, number, number]
  animation: { type: string; axis?: string; startFrame: number; durationFrames: number; easing?: string }
  [key: string]: unknown
}

interface ParticleObject {
  id: string
  type: "particle-system"
  count: number
  size: number
  color: string
  spread: [number, number, number]
  speed: number
  opacity: number
  [key: string]: unknown
}

type TitleObject = TextObject | ParticleObject

interface ThreeDTitlePreviewProps {
  titlePlan: Record<string, unknown>
  fps: number
  onUpdate: (updated: Record<string, unknown>) => void
  onRegenerate?: () => void
  isGenerating?: boolean
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (v: number) => void
}) {
  const precision = step >= 1 ? 0 : Math.max(2, -Math.floor(Math.log10(step)))
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] font-mono text-muted-foreground">{value.toFixed(precision)}{suffix ?? ""}</span>
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

function TextObjectCard({ object, fps, onChange }: { object: TextObject; fps: number; onChange: (updated: TextObject) => void }) {
  const startSec = (object.animation.startFrame / fps).toFixed(1)
  const endSec = ((object.animation.startFrame + object.animation.durationFrames) / fps).toFixed(1)

  return (
    <div className="border border-[var(--border-primary)] rounded-md p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium truncate">{object.text}</span>
        <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
          {startSec}s – {endSec}s
        </span>
      </div>

      <div className="text-[10px] text-muted-foreground flex items-center gap-2">
        <span className="capitalize">{object.material.type}</span>
        <span className="inline-block w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: object.material.color }} />
        <span>{object.font}</span>
        <span className="capitalize">{object.animation.type}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <SliderField label="Size" value={object.size} min={0.1} max={5} step={0.1} onChange={(v) => onChange({ ...object, size: v })} />
        <SliderField label="Depth" value={object.depth} min={0.01} max={2} step={0.01} onChange={(v) => onChange({ ...object, depth: v })} />
      </div>
    </div>
  )
}

function ParticleObjectCard({ object, onChange }: { object: ParticleObject; onChange: (updated: ParticleObject) => void }) {
  return (
    <div className="border border-[var(--border-primary)] rounded-md p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Particles</span>
        <span className="text-[10px] text-muted-foreground">{object.count} particles</span>
      </div>

      <div className="text-[10px] text-muted-foreground flex items-center gap-2">
        <span className="inline-block w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: object.color }} />
        <span>Speed: {object.speed.toFixed(1)}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <SliderField label="Size" value={object.size} min={0.01} max={0.5} step={0.01} onChange={(v) => onChange({ ...object, size: v })} />
        <SliderField label="Speed" value={object.speed} min={0} max={10} step={0.1} onChange={(v) => onChange({ ...object, speed: v })} />
        <SliderField label="Opacity" value={object.opacity} min={0} max={1} step={0.05} onChange={(v) => onChange({ ...object, opacity: v })} />
      </div>
    </div>
  )
}

export function ThreeDTitlePreview({
  titlePlan,
  fps,
  onUpdate,
  onRegenerate,
  isGenerating,
}: ThreeDTitlePreviewProps) {
  const [allObjects, setAllObjects] = useState<TitleObject[]>(
    () => (titlePlan.objects as TitleObject[]) ?? [],
  )
  const [disabledObjects, setDisabledObjects] = useState<Set<number>>(new Set())
  const lastPlanRef = useRef<unknown>(titlePlan)

  // Reset when titlePlan changes externally (e.g., regeneration)
  useEffect(() => {
    if (titlePlan !== lastPlanRef.current && disabledObjects.size === 0) {
      setAllObjects((titlePlan.objects as TitleObject[]) ?? [])
      lastPlanRef.current = titlePlan
    }
  }, [titlePlan, disabledObjects.size])

  function handleObjectChange(index: number, updated: TitleObject) {
    const newAllObjects = allObjects.map((o, i) => (i === index ? updated : o))
    setAllObjects(newAllObjects)
    const enabledObjects = newAllObjects.filter((_, i) => !disabledObjects.has(i))
    onUpdate({ ...titlePlan, objects: enabledObjects })
  }

  function toggleObject(index: number) {
    const next = new Set(disabledObjects)
    if (next.has(index)) {
      next.delete(index)
    } else {
      next.add(index)
    }
    setDisabledObjects(next)
    const enabledObjects = allObjects.filter((_, i) => !next.has(i))
    onUpdate({ ...titlePlan, objects: enabledObjects })
  }

  const camera = titlePlan.camera as Record<string, unknown> | undefined
  const cameraAnim = camera?.animation as Record<string, unknown> | undefined

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-primary)]">
          Title Plan ({allObjects.length} objects)
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

      {/* Camera info */}
      {camera && (
        <div className="text-[10px] text-muted-foreground border border-[var(--border-primary)] rounded-md p-2 flex flex-col gap-0.5">
          <span>Camera FOV: {camera.fov as number}</span>
          {cameraAnim && <span>Animation: {cameraAnim.type as string}</span>}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {allObjects.map((obj, i) => (
          <div key={obj.id ?? i} className="flex items-start gap-1">
            <button
              type="button"
              className="mt-3 shrink-0"
              onClick={() => toggleObject(i)}
              title={disabledObjects.has(i) ? "Enable object" : "Disable object"}
            >
              {disabledObjects.has(i) ? (
                <EyeOff className="w-3 h-3 text-muted-foreground/50" />
              ) : (
                <Eye className="w-3 h-3 text-[#ff0073]" />
              )}
            </button>
            <div className={`flex-1 ${disabledObjects.has(i) ? "opacity-40" : ""}`}>
              {obj.type === "3d-text" ? (
                <TextObjectCard
                  object={obj as TextObject}
                  fps={fps}
                  onChange={(updated) => handleObjectChange(i, updated)}
                />
              ) : (
                <ParticleObjectCard
                  object={obj as ParticleObject}
                  onChange={(updated) => handleObjectChange(i, updated)}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
