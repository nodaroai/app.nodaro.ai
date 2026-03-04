import { toast } from "sonner"

export type OutputStatus = "idle" | "running" | "completed" | "failed"

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  completed: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
  failed: "bg-red-500/20 text-red-400 border border-red-500/30",
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

const SHIMMER_GRADIENT_STYLE = {
  background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)",
} as const

/** Animated shimmer loading placeholder */
export function ShimmerPlaceholder({ className = "", height = "h-48" }: { className?: string; height?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-lg ${height} bg-white/[0.03] ${className}`}>
      <div
        className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite]"
        style={SHIMMER_GRADIENT_STYLE}
      />
    </div>
  )
}

/** Glass toolbar button used in hover overlays */
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
      className="flex items-center justify-center w-9 h-9 rounded-lg bg-black/40 backdrop-blur-sm hover:bg-black/60 text-white/80 hover:text-white transition-all duration-200"
    >
      {children}
    </button>
  )
}

/** Frosted glass card wrapper used by all presentation cards */
export function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`bg-white/[0.05] backdrop-blur-md border border-white/10 rounded-xl shadow-2xl p-4 transition-all duration-300 ${className}`}
    >
      {children}
    </div>
  )
}
