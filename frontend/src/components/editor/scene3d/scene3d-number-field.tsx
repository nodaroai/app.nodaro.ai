"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { VECTOR_AXES, type VectorAxis } from "@/lib/scene3d/edit-operations"
import type { Vec3 } from "@/lib/scene3d/plan-view"

/**
 * A numeric field that COMMITS on blur or Enter, not on every keystroke.
 *
 * Every commit mints a new immutable scene revision, so a per-keystroke commit
 * would turn typing "12.5" into four revisions (1, 12, 12., 12.5) and bury the
 * user's real history. Escape restores the stored value.
 */
export function Scene3DNumberField({
  value,
  onCommit,
  step = 0.1,
  disabled,
  ariaLabel,
}: {
  value: number
  onCommit: (next: number) => void
  step?: number
  disabled?: boolean
  ariaLabel: string
}) {
  const [draft, setDraft] = useState(() => String(value))
  const focusedRef = useRef(false)
  const skipBlurCommitRef = useRef(false)

  // Adopt an externally-changed value (a restore, an arriving LLM revision) —
  // but NOT while the user is typing in this field. A job landing mid-keystroke
  // would otherwise erase what they were entering.
  useEffect(() => {
    if (focusedRef.current) return
    setDraft(String(value))
  }, [value])

  const commit = () => {
    focusedRef.current = false
    const parsed = Number.parseFloat(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    if (parsed !== value) onCommit(parsed)
  }

  return (
    <Input
      type="number"
      step={step}
      aria-label={ariaLabel}
      disabled={disabled}
      value={draft}
      onFocus={() => { focusedRef.current = true; skipBlurCommitRef.current = false }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false
          return
        }
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          skipBlurCommitRef.current = true
          commit()
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === "Escape") {
          e.preventDefault()
          skipBlurCommitRef.current = true
          focusedRef.current = false
          setDraft(String(value))
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className="h-7 text-[11px] px-1.5"
    />
  )
}

/** X / Y / Z row for one vector channel. */
export function Scene3DVectorRow({
  label,
  vector,
  onCommitAxis,
  step = 0.1,
  disabled,
  namePrefix,
  labelSuffix,
}: {
  label: string
  vector: Vec3
  onCommitAxis: (axis: VectorAxis, next: number) => void
  step?: number
  disabled?: boolean
  namePrefix: string
  /** Where this row's commit will land (base value vs keyframe at the playhead). */
  labelSuffix?: ReactNode
}) {
  return (
    <div className="grid grid-cols-[52px_1fr_1fr_1fr] items-center gap-1">
      <span className="text-[10px] text-muted-foreground flex flex-col leading-tight">
        <span>{label}</span>
        {labelSuffix}
      </span>
      {VECTOR_AXES.map((axis, i) => (
        <Scene3DNumberField
          key={axis}
          value={vector[i]}
          step={step}
          disabled={disabled}
          ariaLabel={`${namePrefix} ${label} ${axis.toUpperCase()}`}
          onCommit={(next) => onCommitAxis(axis, next)}
        />
      ))}
    </div>
  )
}
