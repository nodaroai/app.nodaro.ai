"use client"

import { useEffect, useRef, useState, type ComponentProps } from "react"
import { Input } from "@/components/ui/input"

interface ClampedNumberInputProps
  extends Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange" | "min" | "max" | "step"> {
  /** Stored value. `undefined` renders an empty field (pair with `allowEmpty`). */
  readonly value: number | undefined
  /**
   * Fires ONLY when the user leaves the field (blur) or presses Enter — never
   * per keystroke — with the typed value clamped into `[min, max]` (and rounded
   * when `step` is a whole number). Receives `undefined` only when `allowEmpty`
   * is set and the field was cleared. Not called when the value is unchanged.
   */
  readonly onCommit: (next: number | undefined) => void
  readonly min?: number
  readonly max?: number
  readonly step?: number
  /** A blank field commits `undefined` (the "auto" sentinel) instead of
   *  restoring the stored value. */
  readonly allowEmpty?: boolean
}

/** Plain decimal text, optionally signed: what the field reads as a number. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

/** The number typed, or `undefined` for text that is no plain decimal ("1e", "0x10", "Infinity"). */
export function readTypedNumber(text: string): number | undefined {
  const trimmed = text.trim()
  return DECIMAL.test(trimmed) ? Number(trimmed) : undefined
}

/**
 * A bounded numeric input that clamps on COMMIT, not on every keystroke.
 *
 * Clamping inside `onChange` looks harmless but makes any bound above 9
 * untypeable: with `min=4`, typing "12" starts with "1", which is clamped to
 * "4" before the "2" can land — the user literally cannot enter a two-digit
 * value (Generate Video Pro duration, reported 2026-09-16). This keeps a local
 * draft while the field is focused, validates once on blur / Enter, restores
 * the stored value on Escape or garbage input, and adopts an externally changed
 * value (a slider next to it, a preset, a mapping) only while NOT focused so a
 * concurrent write can't erase what the user is typing.
 *
 * It is a text field with the spinbutton role (its bounds as `aria-valuemin` /
 * `aria-valuemax`, ArrowUp / ArrowDown step it), not `type="number"`: a number
 * field reports half-typed text such as "1e" as an EMPTY value, which
 * `allowEmpty` would then commit as a clear. Only plain decimal text is read
 * (`readTypedNumber`): "1e", "0x10" or "Infinity" restore the stored value.
 */
export function ClampedNumberInput({
  value,
  onCommit,
  min,
  max,
  step = 1,
  allowEmpty = false,
  onFocus,
  onBlur,
  onKeyDown,
  ...inputProps
}: ClampedNumberInputProps) {
  const toDraft = (v: number | undefined) => (v === undefined ? "" : String(v))
  const [draft, setDraft] = useState(() => toDraft(value))
  const focusedRef = useRef(false)
  const skipBlurCommitRef = useRef(false)

  useEffect(() => {
    if (focusedRef.current) return
    setDraft(toDraft(value))
  }, [value])

  const clamp = (n: number): number => {
    let out = n
    if (Number.isInteger(step)) out = Math.round(out)
    if (min !== undefined) out = Math.max(min, out)
    if (max !== undefined) out = Math.min(max, out)
    return out
  }

  const commit = () => {
    focusedRef.current = false
    const trimmed = draft.trim()
    if (trimmed === "") {
      if (allowEmpty) {
        if (value !== undefined) onCommit(undefined)
        return
      }
      setDraft(toDraft(value))
      return
    }
    const parsed = readTypedNumber(trimmed)
    if (parsed === undefined) {
      setDraft(toDraft(value))
      return
    }
    const next = clamp(parsed)
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  return (
    <Input
      type="text"
      inputMode={Number.isInteger(step) && (min === undefined || min >= 0) ? "numeric" : "decimal"}
      role="spinbutton"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      value={draft}
      onFocus={(e) => {
        focusedRef.current = true
        skipBlurCommitRef.current = false
        onFocus?.(e)
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        onBlur?.(e)
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false
          return
        }
        commit()
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          // Step from what is typed (else the stored value), within the bounds.
          e.preventDefault()
          const from = readTypedNumber(draft) ?? value ?? min ?? 0
          setDraft(String(Number(clamp(from + (e.key === "ArrowUp" ? step : -step)).toFixed(10))))
        } else if (e.key === "Enter") {
          e.preventDefault()
          skipBlurCommitRef.current = true
          commit()
          e.currentTarget.blur()
        } else if (e.key === "Escape") {
          e.preventDefault()
          skipBlurCommitRef.current = true
          focusedRef.current = false
          setDraft(toDraft(value))
          e.currentTarget.blur()
        }
      }}
      {...inputProps}
    />
  )
}
