"use client"
import { Slider } from "@/components/ui/slider"
import { useCallback } from "react"

interface SpanRangeSliderProps {
  /** Source video duration in seconds (from loadedmetadata — display only). */
  videoDuration: number
  spanStart: number
  spanEnd: number
  onChange: (next: { spanStart: number; spanEnd: number }) => void
  className?: string
}

const MIN_SPAN = 4 // Seedance-2 minimum segment length
const STEP = 0.1

export function SpanRangeSlider({ videoDuration, spanStart, spanEnd, onChange, className }: SpanRangeSliderProps) {
  const handleChange = useCallback(
    (next: number[]) => {
      const [nextStart, nextEnd] = next
      if (nextEnd - nextStart < MIN_SPAN) {
        if (nextStart !== spanStart) {
          const start = Math.max(0, Math.min(nextStart, videoDuration - MIN_SPAN))
          onChange({ spanStart: start, spanEnd: start + MIN_SPAN })
        } else {
          onChange({ spanStart, spanEnd: Math.min(videoDuration, spanStart + MIN_SPAN) })
        }
        return
      }
      onChange({ spanStart: Math.max(0, nextStart), spanEnd: nextEnd })
    },
    [spanStart, videoDuration, onChange],
  )

  return (
    <div className={className}>
      <Slider
        value={[spanStart, spanEnd]}
        min={0}
        max={Math.max(videoDuration, MIN_SPAN)}
        step={STEP}
        minStepsBetweenThumbs={Math.ceil(MIN_SPAN / STEP)}
        onValueChange={handleChange}
        aria-label="Replace span"
      />
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>From: {spanStart.toFixed(1)}s</span>
        <span>Span: {(spanEnd - spanStart).toFixed(1)}s</span>
        <span>To: {spanEnd.toFixed(1)}s</span>
      </div>
    </div>
  )
}
