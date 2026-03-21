import { toast } from "sonner"

export type OutputStatus = "idle" | "waiting" | "running" | "completed" | "failed"

export interface GalleryOutputProps {
  results: string[]
  status: OutputStatus
  iterationTotal?: number
  iterationCompleted?: number
  onOpenMedia?: (url: string) => void
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
export function GlassButton({
  onClick,
  children,
  title,
}: {
  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      title={title}
      className="flex items-center justify-center w-9 h-9 rounded-lg bg-black/50 hover:bg-black/70 text-white transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[#ff0073] focus-visible:outline-none"
    >
      {children}
    </button>
  )
}

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
      className={`bg-transparent border border-border/50 rounded-xl p-3 sm:p-4 transition-all duration-300 min-w-[280px] ${className}`}
    >
      {children}
    </div>
  )
}
