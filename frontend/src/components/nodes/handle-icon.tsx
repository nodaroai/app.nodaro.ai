"use client"

import { memo } from "react"
import type { ReactNode } from "react"

const COLOR_MAP = {
  cyan: { bg: "bg-[#38BDF8]", shadow: "shadow-sky-500/30" },
  pink: { bg: "bg-[#ff0073]", shadow: "shadow-pink-500/30" },
  indigo: { bg: "bg-[#818CF8]", shadow: "shadow-indigo-500/30" },
  steel: { bg: "bg-[#475569]", shadow: "shadow-slate-500/30" },
  green: { bg: "bg-[#22c55e]", shadow: "shadow-green-500/30" },
  red: { bg: "bg-[#ef4444]", shadow: "shadow-red-500/30" },
  orange: { bg: "bg-orange-400", shadow: "shadow-orange-500/30" },
  purple: { bg: "bg-purple-400", shadow: "shadow-purple-500/30" },
  emerald: { bg: "bg-emerald-400", shadow: "shadow-emerald-500/30" },
} as const

interface HandleIconProps {
  readonly icon: ReactNode
  readonly color?: keyof typeof COLOR_MAP
  readonly side?: "left" | "right"
  readonly top?: string
  readonly label?: string
  readonly children?: ReactNode
}

function HandleIconComponent({ icon, color = "cyan", side = "right", top = "50%", label, children }: HandleIconProps) {
  const { bg, shadow } = COLOR_MAP[color]
  return (
    <div
      className={`absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full ${bg} shadow-lg ${shadow}`}
      style={{ top, [side]: '-29px', transform: 'translateY(-50%)' }}
    >
      <span className="[&>svg]:w-3.5 [&>svg]:h-3.5 text-white flex items-center justify-center">{icon}</span>
      {label && (
        <span
          className="absolute text-[10px] leading-none text-muted-foreground whitespace-nowrap pointer-events-none select-none overflow-hidden text-ellipsis"
          style={{
            [side === "right" ? "left" : "right"]: "32px",
            top: "50%",
            transform: "translateY(-50%)",
            maxWidth: "110px",
          }}
          title={label}
        >
          {label}
        </span>
      )}
      {children}
    </div>
  )
}

export const HandleIcon = memo(HandleIconComponent)
