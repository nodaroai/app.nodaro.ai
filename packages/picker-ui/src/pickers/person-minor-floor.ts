"use client"

import { useEffect } from "react"
import { applyMinorAgeFloorToPickerValues, isMinorAge, type PersonValue } from "@nodaro/prompts"

/**
 * Whether the person is a minor — and, when so, clears every pick a minor
 * must not carry. Same predicate (isMinorAge) as the tile hiding, and the SAME
 * stripping logic as every other minor-age-floor consumer — routed through
 * `applyMinorAgeFloorToPickerValues` (single source of truth for which ids get
 * dropped). A stale flagged pick is cleared the moment the age flips to a minor
 * (including on mount, if the initial value already carries one), so the
 * client never assembles — or pictures — a flagged pick for a minor. Both
 * Person views (Detailed and Compact) run it.
 */
export function useMinorAgeFloor(value: PersonValue, onChange: (patch: Partial<PersonValue>) => void): boolean {
  const minor = isMinorAge(value)
  useEffect(() => {
    if (!minor) return
    const floored = applyMinorAgeFloorToPickerValues({ person: value }).person
    if (floored === value) return
    const patch: Record<string, unknown> = {}
    const keys = new Set([...Object.keys(value), ...Object.keys(floored)])
    for (const key of keys) {
      const before = (value as Record<string, unknown>)[key]
      const after = (floored as Record<string, unknown>)[key]
      const changed = Array.isArray(before) && Array.isArray(after)
        ? before.length !== after.length || before.some((x, i) => x !== after[i])
        : before !== after
      if (changed) patch[key] = after
    }
    if (Object.keys(patch).length > 0) onChange(patch as Partial<PersonValue>)
  }, [minor, value, onChange])
  return minor
}
