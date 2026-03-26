import React from "react"
import { Eye } from "lucide-react"
import { toast } from "sonner"

export type OutputStatus = "idle" | "waiting" | "running" | "completed" | "failed"

export interface GalleryOutputProps {
  results: string[]
  status: OutputStatus
  iterationTotal?: number
  iterationCompleted?: number
  onOpenMedia?: (url: string) => void
}

export type MediaType = "image" | "video" | "audio" | "text"

export interface OutputCardActions {
  onEdit?: (nodeId: string, type: Exclude<MediaType, "text">, url: string) => void
  onHide?: (nodeId: string) => void
  onUnhide?: (nodeId: string) => void
  /** When true, this card is hidden but temporarily revealed — show "Unhide" button */
  isRevealed?: boolean
}

export function IterationProgress({ status, iterationTotal, iterationCompleted }: { status: OutputStatus; iterationTotal?: number; iterationCompleted?: number }) {
  if ((status !== "running" && status !== "waiting") || iterationTotal == null) return null
  return (
    <div className="text-xs text-muted-foreground mb-2">
      {iterationCompleted ?? 0}/{iterationTotal} generated
    </div>
  )
}

const STATUS_COLORS: Record<string, string> = {
  waiting: "bg-amber-500/10 text-amber-500 border border-amber-500/20",
  running: "bg-blue-500/10 text-blue-500 border border-blue-500/20",
  completed: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
  failed: "bg-red-500/10 text-red-500 border border-red-500/20",
}

export function StatusBadge({ status }: { status: OutputStatus }) {
  if (status === "idle") return null
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${STATUS_COLORS[status] ?? ""}`}>
      {status}
    </span>
  )
}

export function copyUrl(url: string) {
  navigator.clipboard.writeText(url)
  toast.success("URL copied")
}

export function downloadFile(url: string, filename: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.target = "_blank"
  a.click()
}

/** Animated shimmer loading placeholder */
export function ShimmerPlaceholder({ className = "", height = "h-48" }: { className?: string; height?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-lg ${height} bg-muted/50 animate-pulse ${className}`} />
  )
}

/** Toolbar button used in hover overlays (stays dark since it overlays media) */
export const GlassButton = React.forwardRef<
  HTMLButtonElement,
  {
    onClick?: (e: React.MouseEvent) => void
    children: React.ReactNode
    title?: string
  }
>(({ onClick, children, title, ...rest }, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(e)
      }}
      title={title}
      className="flex items-center justify-center w-9 h-9 rounded-lg bg-black/50 hover:bg-black/70 text-white transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[#ff0073] focus-visible:outline-none"
      {...rest}
    >
      {children}
    </button>
  )
})
GlassButton.displayName = "GlassButton"

/** Clean card wrapper used by all presentation cards */
export function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`bg-transparent rounded-xl transition-all duration-300 ${className}`}
    >
      {children}
    </div>
  )
}

/** Pre-bind action callbacks for a specific node + media type, resolving the guarded patterns once. */
export function resolveCardActions(
  actions: OutputCardActions | undefined,
  nodeId: string | undefined,
  mediaType: Exclude<MediaType, "text">,
  url: string | undefined,
): { onEdit?: () => void; onHide?: () => void; onUnhide?: () => void; isRevealed: boolean } {
  if (!actions || !nodeId) return { isRevealed: false }
  return {
    onEdit: actions.onEdit && url ? () => actions.onEdit!(nodeId, mediaType, url) : undefined,
    onHide: actions.onHide ? () => actions.onHide!(nodeId) : undefined,
    onUnhide: actions.onUnhide ? () => actions.onUnhide!(nodeId) : undefined,
    isRevealed: !!actions.isRevealed,
  }
}

/** Pre-bind text-only actions (no edit support). */
export function resolveTextCardActions(
  actions: OutputCardActions | undefined,
  nodeId: string | undefined,
): { onHide?: () => void; onUnhide?: () => void; isRevealed: boolean } {
  if (!actions || !nodeId) return { isRevealed: false }
  return {
    onHide: actions.onHide ? () => actions.onHide!(nodeId) : undefined,
    onUnhide: actions.onUnhide ? () => actions.onUnhide!(nodeId) : undefined,
    isRevealed: !!actions.isRevealed,
  }
}

export function UnhideBanner({ onUnhide }: { onUnhide: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onUnhide() }}
      className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium
        bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors
        border-t border-amber-500/20 rounded-b-xl"
    >
      <Eye className="w-3.5 h-3.5" />
      Unhide
    </button>
  )
}
