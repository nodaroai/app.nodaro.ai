/**
 * Spinner card rendered for every in-flight generation in the studio grids.
 * Shows a centered spinner, a top-edge progress bar driven by the worker's
 * `setJobProgress` writes, and a ✕ Cancel button that calls
 * `POST /v1/jobs/:id/cancel` via the jobs hook. Color theme passed in so
 * image-asset tabs use blue (#3b82f6) and motion tabs keep their amber tint.
 */
import { X } from "lucide-react"

export type PendingCardTheme = "image" | "motion"

const THEME = {
  image: {
    border: "border-[#3b82f633]",
    bg: "from-[#1a2035] to-[#1e2845]",
    spinner: "border-[#3b82f6]",
    bar: "bg-[#3b82f6]",
    text: "text-[#3b82f6]",
  },
  motion: {
    border: "border-[#f59e0b33]",
    bg: "from-[#241e10] to-[#2a2410]",
    spinner: "border-[#f59e0b]",
    bar: "bg-[#f59e0b]",
    text: "text-[#f59e0b]",
  },
} as const

interface PendingCardProps {
  readonly jobId: string
  readonly name: string
  /** 0–100; the worker writes progress via setJobProgress. */
  readonly progress: number
  readonly theme?: PendingCardTheme
  readonly onCancel: (jobId: string) => void
}

export function PendingCard({ jobId, name, progress, theme = "image", onCancel }: PendingCardProps) {
  const t = THEME[theme]
  const pct = Math.max(0, Math.min(100, progress))
  return (
    <div className={`relative rounded-md overflow-hidden bg-[#1a1d27] border ${t.border} group`}>
      <div className={`aspect-[3/4] flex flex-col items-center justify-center bg-gradient-to-br ${t.bg}`}>
        <div className={`w-5 h-5 border-2 ${t.spinner} border-t-transparent rounded-full animate-spin`} />
        {pct > 0 && (
          <div className={`mt-2 text-[10px] ${t.text} opacity-70 tabular-nums`}>{Math.round(pct)}%</div>
        )}
      </div>
      {/* Top-edge progress bar — width animates as the worker reports progress. */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-black/30">
        <div className={`h-full ${t.bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {/* Cancel button — visible on hover. Calls backend; spinner disappears. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onCancel(jobId)
        }}
        title="Cancel generation"
        className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/40 hover:bg-red-500/70 rounded text-white opacity-0 group-hover:opacity-100 transition"
      >
        <X className="w-3 h-3" />
      </button>
      <div className={`px-2 py-1.5 text-[10px] ${t.text} truncate`}>{name}…</div>
    </div>
  )
}
