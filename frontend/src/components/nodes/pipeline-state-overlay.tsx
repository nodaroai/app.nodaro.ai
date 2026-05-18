"use client"

import type { PipelineState } from "@nodaro/shared"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface Props {
  readonly state: PipelineState | undefined
  readonly isStale?: boolean
}

interface StateMeta {
  borderColor: string
  iconBg: string
  icon: string
  label: string
}

/**
 * Phase 1B.4 — visual cue overlay for `pipeline_entity_nodes.pipeline_state`.
 *
 * Mounts as a non-interactive `absolute inset-0` overlay inside the entity
 * node's outermost `relative` container, so it sits flush with the node card
 * regardless of category-specific layout/sizing. The corner badges are the
 * only interactive elements (Radix Tooltip triggers).
 *
 * Behavior:
 * - `pipeline_owned_running` — gray pulsing border + ⚙ chip (cog)
 * - `pipeline_owned_awaiting_approval` — amber border + ⏸ chip
 * - `pipeline_owned_approved` — soft blue border + ✓ chip
 * - `pipeline_orphaned` (or undefined) — no border / chip; renders nothing
 *   unless `isStale` is true, in which case only the "stale" pill renders.
 *
 * `isStale` adds an orange "stale" pill in the bottom-right corner. Driven by
 * `entity:stale` SSE events from `@nodaro/shared/pipeline-state-types`.
 */
const STATE_META: Record<PipelineState, StateMeta> = {
  pipeline_owned_running: {
    borderColor: "ring-2 ring-zinc-400 animate-pulse",
    iconBg: "bg-zinc-500",
    icon: "⚙",
    label: "Pipeline generating — config locked",
  },
  pipeline_owned_awaiting_approval: {
    borderColor: "ring-2 ring-amber-400",
    iconBg: "bg-amber-500",
    icon: "⏸",
    label: "Awaiting your approval",
  },
  pipeline_owned_approved: {
    borderColor: "ring-1 ring-blue-300",
    iconBg: "bg-blue-500",
    icon: "✓",
    label: "Approved — downstream regen needed if edited",
  },
  pipeline_orphaned: {
    borderColor: "",
    iconBg: "bg-zinc-300",
    icon: "",
    label: "User-owned (forked)",
  },
}

export function PipelineStateOverlay({ state, isStale = false }: Props) {
  // Renders nothing when the entity is orphaned (or unmanaged) AND not stale —
  // the canvas should look identical to a plain user-created node.
  const isManagedVisible = !!state && state !== "pipeline_orphaned"
  if (!isManagedVisible && !isStale) return null
  const meta: StateMeta | null = state ? STATE_META[state] : null

  // `<Tooltip>` (shadcn wrapper) already provides its own TooltipProvider —
  // mounting another one per entity node is redundant context overhead.
  return (
    <div
      className={`absolute inset-0 pointer-events-none rounded ${meta?.borderColor ?? ""}`}
      data-testid="pipeline-state-overlay"
    >
      {meta?.icon && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`absolute -top-1 -right-1 w-5 h-5 rounded-full ${meta.iconBg} text-white text-xs flex items-center justify-center pointer-events-auto z-10`}
              data-testid="pipeline-state-icon"
            >
              {meta.icon}
            </div>
          </TooltipTrigger>
          <TooltipContent>{meta.label}</TooltipContent>
        </Tooltip>
      )}
      {isStale && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="absolute -bottom-1 -right-1 px-1.5 h-4 rounded-full bg-orange-500 text-white text-[10px] leading-none flex items-center pointer-events-auto z-10"
              data-testid="pipeline-state-stale-pill"
            >
              stale
            </div>
          </TooltipTrigger>
          <TooltipContent>
            An upstream entity changed — this node may need regenerating
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
