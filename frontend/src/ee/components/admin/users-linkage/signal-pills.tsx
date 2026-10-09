import type { MouseEvent } from "react"
import { AXES, AXIS_LABELS, PILL_CHARS, type ActiveTarget, type LinkageUser, type UsersById } from "./types"
import { isPillHot } from "./linkage-model"
import { axisVar, ON_TIER } from "./linkage-styles"

/**
 * The Signals cell: one pill per key the account claimed with, in the axis's
 * colour. Pointing at a pill lights every row holding that key; leaving it
 * hands the pointer back to the row, which is still under the cursor.
 * Clicking a pill pins the key so the admin can move the mouse away — and
 * must not open the row, so the click stops here.
 */
export function SignalPills({
  userId,
  user,
  users,
  active,
  onActive,
  onPin,
}: {
  readonly userId: string
  readonly user: LinkageUser
  readonly users: UsersById
  readonly active: ActiveTarget | null
  readonly onActive: (target: ActiveTarget | null) => void
  readonly onPin: (target: ActiveTarget) => void
}) {
  const signals = user.signals
  if (!signals) return null

  return (
    <div className="flex gap-1">
      {AXES.map((axis) => {
        const signal = signals[axis]
        if (!signal) return null
        const target: ActiveTarget = { type: "key", axis, token: signal.token }
        const hot = isPillHot(active, userId, axis, signal.token, users)
        return (
          <button
            key={axis}
            type="button"
            title={`${AXIS_LABELS[axis]} ${signal.token} · ${signal.count} ${signal.count === 1 ? "account" : "accounts"}`}
            className="cursor-default rounded-[5px] border px-1.5 py-0.5 font-mono text-[11px] leading-none transition-colors"
            style={{
              borderColor: axisVar(axis),
              color: hot ? ON_TIER : axisVar(axis),
              background: hot ? axisVar(axis) : "transparent",
            }}
            onMouseEnter={() => onActive(target)}
            onMouseLeave={() => onActive({ type: "account", userId })}
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              onPin(target)
            }}
          >
            {signal.token.slice(0, PILL_CHARS)}
          </button>
        )
      })}
    </div>
  )
}
