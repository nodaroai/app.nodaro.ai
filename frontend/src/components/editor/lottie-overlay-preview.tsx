import { useEffect, useRef, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Overlay {
  id: string
  src: string
  startFrame: number
  durationInFrames: number
  position: { x: number; y: number; width: number; height: number }
  opacity: number
  playbackRate: number
  loop: boolean
  [key: string]: unknown
}

interface LottieOverlayPreviewProps {
  overlayPlan: Record<string, unknown>
  fps: number
  onUpdate: (updated: Record<string, unknown>) => void
  onRegenerate?: () => void
  isGenerating?: boolean
}

function OverlayCard({
  overlay,
  fps,
  onChange,
}: {
  overlay: Overlay
  fps: number
  onChange: (updated: Overlay) => void
}) {
  const filename = overlay.src.split("/").pop()?.slice(0, 20) ?? overlay.src.slice(0, 20)
  const startSec = (overlay.startFrame / fps).toFixed(1)
  const endSec = ((overlay.startFrame + overlay.durationInFrames) / fps).toFixed(1)

  return (
    <div className="border border-[var(--border-primary)] rounded-md p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium truncate" title={overlay.src}>
          {filename}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
          {startSec}s – {endSec}s
        </span>
      </div>

      <div className="text-[10px] text-muted-foreground">
        Position: ({overlay.position.x.toFixed(0)}%, {overlay.position.y.toFixed(0)}%) – {overlay.position.width.toFixed(0)}×{overlay.position.height.toFixed(0)}%
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Opacity</span>
            <span className="text-[10px] font-mono text-muted-foreground">{overlay.opacity.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={overlay.opacity}
            onChange={(e) => onChange({ ...overlay, opacity: parseFloat(e.target.value) })}
            className="w-full accent-[#ff0073]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Playback Rate</span>
            <span className="text-[10px] font-mono text-muted-foreground">{overlay.playbackRate.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.1}
            value={overlay.playbackRate}
            onChange={(e) => onChange({ ...overlay, playbackRate: parseFloat(e.target.value) })}
            className="w-full accent-[#ff0073]"
          />
        </div>

        <label className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={overlay.loop}
            onChange={(e) => onChange({ ...overlay, loop: e.target.checked })}
            className="accent-[#ff0073]"
          />
          Loop animation
        </label>
      </div>
    </div>
  )
}

export function LottieOverlayPreview({
  overlayPlan,
  fps,
  onUpdate,
  onRegenerate,
  isGenerating,
}: LottieOverlayPreviewProps) {
  const [allOverlays, setAllOverlays] = useState<Overlay[]>(
    () => (overlayPlan.overlays as Overlay[]) ?? [],
  )
  const [disabledOverlays, setDisabledOverlays] = useState<Set<number>>(new Set())
  const lastPlanRef = useRef<unknown>(overlayPlan)

  // Reset when overlayPlan changes externally (e.g., regeneration)
  useEffect(() => {
    if (overlayPlan !== lastPlanRef.current && disabledOverlays.size === 0) {
      setAllOverlays((overlayPlan.overlays as Overlay[]) ?? [])
      lastPlanRef.current = overlayPlan
    }
  }, [overlayPlan, disabledOverlays.size])

  function handleOverlayChange(index: number, updated: Overlay) {
    const newAllOverlays = allOverlays.map((o, i) => (i === index ? updated : o))
    setAllOverlays(newAllOverlays)
    const enabledOverlays = newAllOverlays.filter((_, i) => !disabledOverlays.has(i))
    onUpdate({ ...overlayPlan, overlays: enabledOverlays })
  }

  function toggleOverlay(index: number) {
    const next = new Set(disabledOverlays)
    if (next.has(index)) {
      next.delete(index)
    } else {
      next.add(index)
    }
    setDisabledOverlays(next)
    const enabledOverlays = allOverlays.filter((_, i) => !next.has(i))
    onUpdate({ ...overlayPlan, overlays: enabledOverlays })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-primary)]">
          Overlay Plan ({allOverlays.length} overlays)
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
        {allOverlays.map((overlay, i) => (
          <div key={overlay.id ?? i} className="flex items-start gap-1">
            <button
              type="button"
              className="mt-3 shrink-0"
              onClick={() => toggleOverlay(i)}
              title={disabledOverlays.has(i) ? "Enable overlay" : "Disable overlay"}
            >
              {disabledOverlays.has(i) ? (
                <EyeOff className="w-3 h-3 text-muted-foreground/50" />
              ) : (
                <Eye className="w-3 h-3 text-[#ff0073]" />
              )}
            </button>
            <div className={`flex-1 ${disabledOverlays.has(i) ? "opacity-40" : ""}`}>
              <OverlayCard
                overlay={overlay}
                fps={fps}
                onChange={(updated) => handleOverlayChange(i, updated)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
