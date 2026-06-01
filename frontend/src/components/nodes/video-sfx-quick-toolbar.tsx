"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useStore } from "@xyflow/react"
import { Copy, Music2 } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useUpstreamVideoDuration } from "@/hooks/use-upstream-video-duration"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { NODE_VISUAL_SCALE_FLOOR } from "@/lib/zoom-floor"
import type { VideoSfxNodeData } from "@/types/nodes"

interface VideoSfxQuickToolbarProps {
  readonly nodeId: string
  readonly data: VideoSfxNodeData
  readonly isRunning: boolean
  /** Fires whenever a select / popover inside the toolbar opens or closes.
   *  The parent uses this to keep the toolbar visible while a dropdown is
   *  active (the dropdown items render in a portal outside the node's
   *  hover area, which would otherwise trigger NodeToolbar's hide). */
  readonly onAnyOpenChange?: (open: boolean) => void
}

/** Duration-bucketed credit keys — mirrors `BUCKETS` in
 *  `backend/src/routes/video-sfx.ts`. The frontend re-derives the key from
 *  the upstream video's reported duration so the Run-button cost matches
 *  what the route will actually charge once ffprobe measures the real file.
 *  ffprobe is authoritative; this is best-effort UI accuracy only. */
const BUCKET_KEYS = [
  { upTo: 8,   key: "replicate-mmaudio:8s" },
  { upTo: 15,  key: "replicate-mmaudio:15s" },
  { upTo: 30,  key: "replicate-mmaudio:30s" },
  { upTo: 60,  key: "replicate-mmaudio:60s" },
  { upTo: 120, key: "replicate-mmaudio:120s" },
  { upTo: 300, key: "replicate-mmaudio:300s" },
] as const

/** When no upstream is wired yet (or duration unknown), fall back to the
 *  cheapest bucket — the Run button still renders a number, but the user
 *  knows it's a floor: longer clips will bill higher. The route's preHandler
 *  rejects > 300s up front so the 300s key is a hard ceiling. */
function bucketKeyForDuration(duration: number | null): string {
  if (duration == null || duration <= 0) return "replicate-mmaudio:8s"
  return BUCKET_KEYS.find((b) => duration <= b.upTo)?.key ?? "replicate-mmaudio:300s"
}

/**
 * Hover-revealed toolbar that sits below a Video SFX node
 * (`topToolbarContent` position). The video-sfx node has a single
 * fixed model (Replicate MMAudio — `provider` is a literal type), so the
 * model selector collapses to a static pill. The only inline lever is
 * `versions` (1-4 takes per run); everything else (prompt, negative,
 * CFG, steps, seed) lives in the full config panel.
 *
 * Credit display is duration-dependent: we walk the upstream video edge,
 * read the producer's reported duration, map it to the matching bucket key
 * (`replicate-mmaudio:8s` … `replicate-mmaudio:300s` — same buckets as
 * `bucketKeyFor` in `backend/src/routes/video-sfx.ts`), look up the BASE
 * credits via `useModelCredits()`, and multiply by `versions`. Without the
 * bucket lookup the button would show 1cr regardless of input length —
 * the bare `replicate-mmaudio` key resolves to the 8s bucket fallback.
 *
 * Note: this is best-effort UI accuracy. The route's `probeDurationPreHandler`
 * ffprobes the resolved file at execute time and uses THAT for the actual
 * reservation, so a wrong-by-one-bucket display here is corrected up front
 * before any credits are spent (and refunded if the actual was lower).
 */
export function VideoSfxQuickToolbar({
  nodeId,
  data,
  isRunning,
  onAnyOpenChange,
}: VideoSfxQuickToolbarProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)

  // Walk to the upstream video producer (handle "video") and derive the
  // bucket key. `useUpstreamVideoDuration` returns null when no edge,
  // no source node, or no recognised duration field — in which case the
  // bucket key falls back to `:8s` and the Run button shows the floor cost.
  const upstreamDuration = useUpstreamVideoDuration(nodeId, "video")
  const creditModelId = bucketKeyForDuration(upstreamDuration)
  const baseCredits = useModelCredits(creditModelId, 1)
  const versions = Math.min(Math.max(1, data.versions ?? 1), 4)
  const credits = baseCredits * versions

  // NodeToolbar renders at fixed DOM scale (its portal sits outside the
  // React Flow zoom transform), so its visual size doesn't track zoom by
  // default. We want the toolbar to grow when the user zooms in (matches
  // the node's growth) while staying readable when zoomed out — so apply
  // `scale(max(MIN, zoom))`. transformOrigin top-center keeps the toolbar
  // anchored to the node's bottom edge as it scales.
  const zoom = useStore((s) => s.transform[2])
  const toolbarScale = Math.max(NODE_VISUAL_SCALE_FLOOR, zoom)
  const toolbarTransform = {
    transform: `scale(${toolbarScale})`,
    transformOrigin: "50% 0%",
  } as const

  // Open-state tracking: increment on each select/popover open, decrement
  // on close. While count > 0 we report `open=true` upward so the parent
  // can pin the NodeToolbar visible past the cursor leaving the node
  // (Radix Select items render in a portal outside the node's hover
  // boundary — without this the bar disappears mid-pick).
  //
  // Closes are deferred to the next macrotask so that clicking directly
  // from one open dropdown's trigger onto another's trigger keeps the
  // count net positive. Without the defer, the close → open sequence
  // produces two separate renders (count 1 → 0 → 1); the intermediate
  // 0 fires the useEffect with `open=false`, the parent unpins the
  // NodeToolbar, and since the cursor sits over the portaled menu
  // (outside the node's hover boundary) the toolbar disappears mid-pick.
  //
  // The video-sfx toolbar currently has a single Select, so the
  // close→open swap can't happen between two dropdowns inside this
  // toolbar — but we keep the pattern for symmetry with the other quick
  // toolbars and forward-compatibility (future MMAudio variants would add
  // a Model dropdown alongside Versions, restoring the swap risk).
  const [openCount, setOpenCount] = useState(0)
  const pendingCloseRef = useRef<number | null>(null)
  useEffect(() => {
    onAnyOpenChange?.(openCount > 0)
  }, [openCount, onAnyOpenChange])
  useEffect(() => () => {
    if (pendingCloseRef.current !== null) {
      clearTimeout(pendingCloseRef.current)
    }
  }, [])
  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      setOpenCount((c) => c + 1)
    } else {
      pendingCloseRef.current = window.setTimeout(() => {
        pendingCloseRef.current = null
        setOpenCount((c) => Math.max(0, c - 1))
      }, 0)
    }
  }, [])

  const handleVersionsChange = (value: string) => {
    const n = parseInt(value, 10)
    updateNodeData(nodeId, { versions: Number.isFinite(n) ? Math.min(Math.max(1, n), 4) : 1 })
  }

  // Ghost select trigger — no border, no background by default, subtle
  // hover only. Icon prefix + value + small chevron. `!` modifiers beat
  // shadcn's data-[size]:* attribute defaults. Light + dark mode variants:
  // light mode is dark text on a near-transparent base with a faint hover;
  // dark mode is light text on the same. Matches the other quick toolbars
  // so the editor's hover-bar aesthetic stays uniform across node types.
  const ghostTriggerClass =
    "!h-6 !px-1.5 !gap-1 !border-0 !bg-transparent text-[10px] " +
    "text-neutral-900/85 hover:!bg-black/10 dark:text-white/85 dark:hover:!bg-white/10 " +
    "rounded-md min-w-0 w-auto whitespace-nowrap [&_svg]:!size-3 [&_svg]:opacity-70 " +
    "[&[data-state=open]]:bg-black/10 dark:[&[data-state=open]]:bg-white/10"

  // Container colors — bright translucent surface in light mode, dark
  // translucent in dark mode. Matches the rest of the editor's surface
  // hierarchy.
  const containerClass =
    "flex items-center px-1.5 py-1 backdrop-blur-sm rounded-xl border " +
    "bg-white/85 border-black/10 text-neutral-900 " +
    "node-menu-surface dark:border-white/10 dark:text-white"

  return (
    <div
      className={`${containerClass} gap-0.5`}
      style={toolbarTransform}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Provider pill — Replicate MMAudio is the only supported model.
          Renders as a static chip (not a dropdown) so the visual rhythm
          matches other quick toolbars without misleading the user into
          thinking they can switch providers here. Reserved as a slot so
          future MMAudio variants can join without disrupting the layout. */}
      <span
        className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] whitespace-nowrap text-neutral-900/85 dark:text-white/85"
        title="MMAudio (Replicate)"
      >
        <Music2 className="w-3 h-3 opacity-70" />
        MMAudio
      </span>

      {/* Versions (×1–×4): how many distinct SFX takes to generate per run.
          Linear credit multiplier — applied client-side here, mirrored by
          `creditGuard.computeCredits` on the route via `bucketBaseCreditsFor
          × versions`. */}
      <Select value={String(versions)} onValueChange={handleVersionsChange} onOpenChange={handleOpenChange}>
        <SelectTrigger className={ghostTriggerClass} title="Versions per run">
          <Copy className="opacity-70" />
          <SelectValue>× {versions}</SelectValue>
        </SelectTrigger>
        <SelectContent className="node-menu-surface">
          {[1, 2, 3, 4].map((n) => (
            <SelectItem key={n} value={String(n)} className="text-xs">
              × {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <PinkDot />

      {/* Run button — credits already include the upstream-duration bucket
          and the versions multiplier. RunNodeButton's own fanOut/repeat
          math is a no-op here because `video-sfx` is NOT in
          REPEATABLE_NODE_TYPES (it uses `versions`, not `repeatCount`),
          so multiplying versions into `credits` ourselves is correct and
          doesn't double-count. */}
      <RunNodeButton
        nodeId={nodeId}
        credits={credits}
        isRunning={isRunning}
        onRun={(nid) => runSingleNode?.(nid)}
      />
    </div>
  )
}

/** 4px brand-pink dot used as a quiet visual divider between settings and
 *  the Run CTA. Replaces the explicit vertical hairline — keeps the eye
 *  moving rightward while planting the accent color near the action.
 *  Mirrors the same helper in generate-image-quick-toolbar / generate-video-
 *  quick-toolbar (local copy keeps each toolbar self-contained). */
function PinkDot() {
  return (
    <span
      aria-hidden
      className="w-1 h-1 rounded-full bg-[#ff0073] mx-1.5 shrink-0"
    />
  )
}
