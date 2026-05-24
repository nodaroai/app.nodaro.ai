"use client"

import { memo } from "react"
import type { ReactNode } from "react"
import { Handle, Position } from "@xyflow/react"
import { Type, Image as ImageIcon, Film, Music } from "lucide-react"
import type { AggregateableType } from "@nodaro/shared"
import { AGGREGATE_HANDLE_COLORS } from "./handle-colors"

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

interface AggregateHandleIconProps {
  readonly id: string
  readonly type: AggregateableType
  readonly top: string
}

// Icon per aggregate type, resolved at render time (not module scope) so that
// the lucide-react bindings are only dereferenced when this component actually
// renders — partial lucide mocks in unrelated node tests transitively import
// this module and would otherwise throw on missing icon exports.
function aggregateIcon(type: AggregateableType): ReactNode {
  switch (type) {
    case "text":
      return <Type />
    case "image":
      return <ImageIcon />
    case "video":
      return <Film />
    case "audio":
      return <Music />
  }
}

interface AggregateHandleVisualProps {
  readonly type: AggregateableType
  readonly top: string
  readonly side?: "left" | "right"
}

// Visual-only colored circle for an aggregate-typed handle (NO <Handle>). Use
// this when the functional React Flow <Handle> is rendered elsewhere — e.g. via
// BaseNode's `handles` array — so the circle and the hit-target don't conflict.
// The circle keeps the exact per-type AGGREGATE_HANDLE_COLORS so the
// text/image/video/audio color stays consistent with edges + minimap.
function AggregateHandleVisualComponent({ type, top, side = "right" }: AggregateHandleVisualProps) {
  return (
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full shadow-lg"
      style={{ top, [side]: "-29px", transform: "translateY(-50%)", backgroundColor: AGGREGATE_HANDLE_COLORS[type] }}
    >
      <span className="[&>svg]:w-3.5 [&>svg]:h-3.5 text-white flex items-center justify-center">
        {aggregateIcon(type)}
      </span>
    </div>
  )
}

export const AggregateHandleVisual = memo(AggregateHandleVisualComponent)

// Source handle for the Group typed-output handles, styled to match the
// standard node handle look: a transparent 28px React Flow <Handle> hit-target
// with the colored icon circle overlaid at the right edge. Composes the
// visual-only circle above with its own functional <Handle> (Group does not
// use BaseNode, so it owns the handle itself).
function AggregateHandleIconComponent({ id, type, top }: AggregateHandleIconProps) {
  return (
    <>
      <Handle
        id={id}
        type="source"
        position={Position.Right}
        isConnectable
        aria-label={id}
        className="!w-7 !h-7 !bg-transparent !border-0 touch-manipulation"
        style={{ top, right: "-29px", transform: "translateY(-50%)", zIndex: 30 }}
      />
      <AggregateHandleVisual type={type} top={top} side="right" />
    </>
  )
}

export const AggregateHandleIcon = memo(AggregateHandleIconComponent)
