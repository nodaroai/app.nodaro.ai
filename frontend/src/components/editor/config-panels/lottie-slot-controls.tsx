"use client"

import { RotateCcw } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  describeSlotControl,
  rgbaArrayToHex,
  hexToRgbaArray,
  humanizeSlotSid,
  type SlotControlDescriptor,
} from "@nodaro/shared"
import type { MotionGraphicsData } from "@/types/nodes"

interface LottieSlotControlsProps {
  /** The motion-graphics lottie-graphic plan (self-contained; slotValues live inside). */
  plan: Record<string, unknown>
  /** Same shape MotionGraphicsConfig passes — a partial node-data patch. */
  onUpdate: (patch: Partial<MotionGraphicsData>) => void
}

export function LottieSlotControls({ plan, onUpdate }: LottieSlotControlsProps) {
  const slots = (plan.slots as Record<string, unknown>) ?? {}
  const slotValues = (plan.slotValues as Record<string, unknown>) ?? {}

  const entries = Object.entries(slots)
    .map(([sid, slot]) => ({ sid, control: describeSlotControl(slot) }))
    .filter((e): e is { sid: string; control: SlotControlDescriptor } => e.control !== null)

  if (entries.length === 0) return null

  // Immutable write: replace the whole slotValues map (§1 single-home rule —
  // the plan owns its slotValues; never mutate the existing plan/slotValues).
  const writeValue = (sid: string, raw: unknown) => {
    onUpdate({
      motionPlan: { ...plan, slotValues: { ...slotValues, [sid]: raw } },
    })
  }

  const resetValue = (sid: string) => {
    const { [sid]: _omit, ...rest } = slotValues
    onUpdate({ motionPlan: { ...plan, slotValues: rest } })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs font-medium text-[var(--text-primary)]">Slots</Label>
        <span className="text-[10px] text-muted-foreground">free edits — no credits</span>
      </div>

      {entries.map(({ sid, control }) => {
        const label = humanizeSlotSid(sid)
        const hasOverride = Object.prototype.hasOwnProperty.call(slotValues, sid)
        const current = hasOverride ? slotValues[sid] : control.value

        return (
          <div key={sid}>
            <div className="mb-1.5 flex items-center justify-between">
              <Label htmlFor={`slot-${sid}`} className="block text-xs">
                {label}
              </Label>
              {hasOverride && (
                <button
                  type="button"
                  onClick={() => resetValue(sid)}
                  className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-[var(--text-primary)]"
                  title={`Reset ${label}`}
                  aria-label={`Reset ${label}`}
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
            </div>
            <SlotControl
              sid={sid}
              control={control}
              current={current}
              onChange={(raw) => writeValue(sid, raw)}
            />
          </div>
        )
      })}
    </div>
  )
}

interface SlotControlProps {
  sid: string
  control: SlotControlDescriptor
  current: unknown
  onChange: (raw: unknown) => void
}

function SlotControl({ sid, control, current, onChange }: SlotControlProps) {
  const id = `slot-${sid}`

  if (control.kind === "color") {
    const rgba = Array.isArray(current) ? (current as number[]) : (control.value as number[])
    const hex = rgbaArrayToHex(rgba)
    return (
      <div className="flex items-center gap-2">
        <input
          type="color"
          id={id}
          aria-label={humanizeSlotSid(sid)}
          // <input type="color"> only accepts #rrggbb; strip any alpha for the
          // swatch. Editing therefore resets a sub-1 alpha to opaque — the
          // native picker has no alpha channel (lottie fills are near-always
          // opaque; alpha editing can land with published-app exposure).
          value={hex.slice(0, 7)}
          onChange={(e) => onChange(hexToRgbaArray(e.target.value))}
          className="h-8 w-12 cursor-pointer rounded border border-[var(--border-primary)] p-0"
        />
        <span className="font-mono text-xs text-muted-foreground">{hex}</span>
      </div>
    )
  }

  if (control.kind === "number") {
    const value = typeof current === "number" ? current : (control.value as number)
    return (
      <Input
        id={id}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className="h-8 text-xs"
      />
    )
  }

  if (control.kind === "point") {
    const point = Array.isArray(current) ? (current as number[]) : (control.value as number[])
    const x = point[0] ?? 0
    const y = point[1] ?? 0
    return (
      <div className="grid grid-cols-2 gap-2">
        <Input
          id={id}
          type="number"
          aria-label={`${humanizeSlotSid(sid)} X`}
          value={x}
          onChange={(e) => onChange([e.target.value === "" ? 0 : Number(e.target.value), y])}
          className="h-8 text-xs"
        />
        <Input
          type="number"
          aria-label={`${humanizeSlotSid(sid)} Y`}
          value={y}
          onChange={(e) => onChange([x, e.target.value === "" ? 0 : Number(e.target.value)])}
          className="h-8 text-xs"
        />
      </div>
    )
  }

  // text
  const value = typeof current === "string" ? current : String(control.value ?? "")
  return (
    <Input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 text-xs"
    />
  )
}
