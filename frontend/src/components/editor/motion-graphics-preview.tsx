import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp, Eye, EyeOff, Shapes } from "lucide-react"
import { Button } from "@/components/ui/button"

interface MGElement {
  id: string
  type: string
  [key: string]: unknown
}

interface MotionGraphicsPreviewProps {
  motionPlan: Record<string, unknown>
  fps: number
  onUpdate: (updated: Record<string, unknown>) => void
  onRegenerate?: () => void
  isGenerating?: boolean
}

const ELEMENT_LABELS: Record<string, string> = {
  shape: "Shape",
  text: "Text",
  "svg-path": "SVG Path",
}

function ElementEditor({
  element,
  onChange,
}: {
  element: MGElement
  onChange: (updated: MGElement) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const label = ELEMENT_LABELS[element.type] ?? element.type
  const displayName = element.id || label

  return (
    <div className="border border-[var(--border-primary)] rounded-md overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Shapes className="w-3 h-3 text-[#ff0073]" />
          <span className="font-medium truncate">{displayName}</span>
          <span className="text-[10px] text-muted-foreground">({label})</span>
        </div>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <SliderField label="X" value={element.x as number ?? 0} min={0} max={1920} step={1} onChange={(v) => onChange({ ...element, x: v })} />
            <SliderField label="Y" value={element.y as number ?? 0} min={0} max={1080} step={1} onChange={(v) => onChange({ ...element, y: v })} />
          </div>
          {element.type === "shape" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <SliderField label="Width" value={element.width as number ?? 100} min={1} max={1920} step={1} onChange={(v) => onChange({ ...element, width: v })} />
                <SliderField label="Height" value={element.height as number ?? 100} min={1} max={1080} step={1} onChange={(v) => onChange({ ...element, height: v })} />
              </div>
              {element.fill && (
                <ColorField label="Fill" value={element.fill as string} onChange={(v) => onChange({ ...element, fill: v })} />
              )}
            </>
          )}
          {element.type === "text" && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">Text</span>
                <input
                  type="text"
                  value={element.text as string ?? ""}
                  onChange={(e) => onChange({ ...element, text: e.target.value })}
                  className="h-7 px-2 text-xs rounded border border-[var(--border-primary)] bg-transparent"
                />
              </div>
              <SliderField label="Font Size" value={element.fontSize as number ?? 42} min={8} max={200} step={1} onChange={(v) => onChange({ ...element, fontSize: v })} />
              <ColorField label="Color" value={element.color as string ?? "#ffffff"} onChange={(v) => onChange({ ...element, color: v })} />
            </>
          )}
          {element.type === "svg-path" && (
            <>
              <ColorField label="Stroke" value={element.stroke as string ?? "#ffffff"} onChange={(v) => onChange({ ...element, stroke: v })} />
              <SliderField label="Stroke Width" value={element.strokeWidth as number ?? 2} min={0.5} max={10} step={0.5} onChange={(v) => onChange({ ...element, strokeWidth: v })} />
            </>
          )}
          {/* Animation timing */}
          <div className="mt-1 pt-1 border-t border-[var(--border-primary)]">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Animation</span>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">Type</span>
                <span className="text-[10px] font-medium">{(element.animation as Record<string, unknown>)?.type as string ?? "none"}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">Start</span>
                <span className="text-[10px] font-medium">{(element.animation as Record<string, unknown>)?.startFrame as number ?? 0}f</span>
              </div>
            </div>
          </div>
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
        <span className="text-[10px] font-mono text-muted-foreground">{value.toFixed(step >= 1 ? 0 : Math.max(1, -Math.floor(Math.log10(step))))}</span>
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

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-10">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-6 rounded border border-[var(--border-primary)] cursor-pointer"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 px-1.5 text-[10px] font-mono rounded border border-[var(--border-primary)] bg-transparent flex-1"
      />
    </div>
  )
}

export function MotionGraphicsPreview({
  motionPlan,
  fps,
  onUpdate,
  onRegenerate,
  isGenerating,
}: MotionGraphicsPreviewProps) {
  const [allElements, setAllElements] = useState<MGElement[]>(() => (motionPlan.elements as MGElement[]) ?? [])
  const [disabledElements, setDisabledElements] = useState<Set<number>>(new Set())
  const lastPlanRef = useRef<unknown>(motionPlan)

  // Reset when motionPlan changes externally (e.g., regeneration)
  useEffect(() => {
    if (motionPlan !== lastPlanRef.current && disabledElements.size === 0) {
      setAllElements((motionPlan.elements as MGElement[]) ?? [])
      lastPlanRef.current = motionPlan
    }
  }, [motionPlan, disabledElements.size])

  function handleElementChange(index: number, updated: MGElement) {
    const newAll = allElements.map((e, i) => (i === index ? updated : e))
    setAllElements(newAll)
    const enabled = newAll.filter((_, i) => !disabledElements.has(i))
    onUpdate({ ...motionPlan, elements: enabled })
  }

  function toggleElement(index: number) {
    const next = new Set(disabledElements)
    if (next.has(index)) {
      next.delete(index)
    } else {
      next.add(index)
    }
    setDisabledElements(next)
    const enabled = allElements.filter((_, i) => !next.has(i))
    onUpdate({ ...motionPlan, elements: enabled })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-primary)]">
          Elements ({allElements.length})
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
        {allElements.map((element, i) => (
          <div key={element.id || i} className="flex items-start gap-1">
            <button
              type="button"
              className="mt-2 shrink-0"
              onClick={() => toggleElement(i)}
              title={disabledElements.has(i) ? "Enable element" : "Disable element"}
            >
              {disabledElements.has(i) ? (
                <EyeOff className="w-3 h-3 text-muted-foreground/50" />
              ) : (
                <Eye className="w-3 h-3 text-[#ff0073]" />
              )}
            </button>
            <div className={`flex-1 ${disabledElements.has(i) ? "opacity-40" : ""}`}>
              <ElementEditor
                element={element}
                onChange={(updated) => handleElementChange(i, updated)}
              />
            </div>
          </div>
        ))}
      </div>

      {motionPlan.exitAnimation != null && (
        <div className="mt-1 px-2 py-1.5 rounded border border-[var(--border-primary)] text-xs">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Exit Animation</span>
          <div className="text-[10px] mt-0.5">
            {String((motionPlan.exitAnimation as Record<string, unknown>).type ?? "none")} at frame{" "}
            {String((motionPlan.exitAnimation as Record<string, unknown>).startFrame ?? 0)}
          </div>
        </div>
      )}
    </div>
  )
}
