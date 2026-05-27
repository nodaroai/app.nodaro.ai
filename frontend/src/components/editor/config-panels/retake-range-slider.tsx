"use client"
import { Slider } from "@/components/ui/slider"
import { useCallback } from "react"

interface RetakeRangeSliderProps {
  /** Total video duration in seconds. */
  videoDuration: number
  /** Current retake start time in seconds. */
  startTime: number
  /** Current retake duration in seconds (min 2). */
  duration: number
  /** Callback when either thumb moves; receives the new [start, duration] pair. */
  onChange: (next: { startTime: number; duration: number }) => void
  /** Optional className for the outer container. */
  className?: string
}

const MIN_DURATION = 2 // LTX retake minimum
const STEP = 0.1

export function RetakeRangeSlider({
  videoDuration,
  startTime,
  duration,
  onChange,
  className,
}: RetakeRangeSliderProps) {
  const end = startTime + duration
  const handleChange = useCallback(
    (next: number[]) => {
      const [nextStart, nextEnd] = next
      if (nextEnd - nextStart < MIN_DURATION) {
        if (nextStart !== startTime) {
          onChange({ startTime: Math.max(0, nextStart), duration: MIN_DURATION })
        } else {
          onChange({ startTime, duration: MIN_DURATION })
        }
        return
      }
      onChange({ startTime: Math.max(0, nextStart), duration: nextEnd - nextStart })
    },
    [startTime, onChange],
  )

  return (
    <div className={className}>
      <Slider
        value={[startTime, end]}
        min={0}
        max={Math.max(videoDuration, MIN_DURATION)}
        step={STEP}
        minStepsBetweenThumbs={Math.ceil(MIN_DURATION / STEP)}
        onValueChange={handleChange}
        aria-label="Retake time window"
      />
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>Start: {startTime.toFixed(1)}s</span>
        <span>Duration: {duration.toFixed(1)}s</span>
        <span>End: {end.toFixed(1)}s</span>
      </div>
    </div>
  )
}
