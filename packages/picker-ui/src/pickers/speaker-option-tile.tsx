"use client"

import { forwardRef, useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react"
import { cn } from "../lib/cn"
import "../previews/speaker-view.css"

/** One choice of a Speaker View picker. The host computes `disabled` and
 *  `reason` from the node's rules and hands over finished, localized text. */
export interface SpeakerPickerOption {
  readonly id: string
  readonly label: string
  /** The choice is ruled out for this edit or aspect. */
  readonly disabled?: boolean
  /** Why it is ruled out — shown on hover (the title) and on keyboard focus
   *  (a visible caption under the tile), and read aloud. */
  readonly reason?: string
}

interface SpeakerOptionTileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onSelect" | "role" | "title" | "children"> {
  readonly role: "radio" | "checkbox"
  readonly label: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly reason?: string
  readonly onSelect: () => void
  readonly children?: ReactNode
  readonly haspopup?: boolean
}

/**
 * A tile that can be ruled out. A ruled-out tile is `aria-disabled`, not
 * `disabled`: it stays in the tab order, so keyboard focus and a screen reader
 * can read WHY it is unavailable (the title on hover, a visible caption while
 * it holds focus, `aria-describedby` for assistive technology) — never a dead
 * grey box. It does not fire `onSelect`.
 */
export const SpeakerOptionTile = forwardRef<HTMLButtonElement, SpeakerOptionTileProps>(function SpeakerOptionTile(
  { role, label, checked, disabled, reason, onSelect, children, haspopup, onClick, onFocus, onBlur, onKeyDown, ...rest },
  ref,
) {
  const reasonId = useId()
  // The caption follows focus (a tooltip must not hide from a keyboard user)
  // and Escape dismisses it without moving focus.
  const [focused, setFocused] = useState(false)
  const showReason = !!disabled && !!reason && focused
  return (
    <div className="stv-cell">
      <button
        {...rest}
        ref={ref}
        type="button"
        role={role}
        aria-checked={checked}
        aria-disabled={disabled ? true : undefined}
        aria-haspopup={haspopup ? "dialog" : undefined}
        aria-describedby={disabled && reason ? reasonId : undefined}
        title={disabled && reason ? reason : undefined}
        data-selected={checked}
        data-disabled={disabled ? true : undefined}
        onFocus={(e) => { onFocus?.(e); setFocused(true) }}
        onBlur={(e) => { onBlur?.(e); setFocused(false) }}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.key === "Escape" && focused) setFocused(false)
        }}
        onClick={(e) => {
          onClick?.(e)
          if (!disabled) onSelect()
        }}
        className="stv-tile"
      >
        {children}
        <span className="stv-tile-label">{label}</span>
      </button>
      {disabled && reason && <span id={reasonId} className="sr-only">{reason}</span>}
      {showReason && <span aria-hidden="true" data-testid="stv-reason-caption" className="stv-reason-caption">{reason}</span>}
    </div>
  )
})
