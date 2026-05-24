import { Clock } from "lucide-react"
import { optimizedImageUrl } from "@/lib/image"

export interface PreviousCandidate {
  readonly jobId: string
  readonly url: string
  readonly createdAt: string
}

interface PreviousCandidatesStripProps {
  readonly candidates: ReadonlyArray<PreviousCandidate>
  readonly onReApprove: (jobId: string) => void
}

export function PreviousCandidatesStrip({ candidates, onReApprove }: PreviousCandidatesStripProps) {
  if (candidates.length === 0) return null
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-500">
        <Clock className="w-3 h-3" />
        Previous candidates
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {candidates.map((c) => (
          <button
            key={c.jobId}
            type="button"
            aria-label={`Re-approve candidate ${c.jobId}`}
            onClick={() => onReApprove(c.jobId)}
            className="shrink-0 w-14 h-18 rounded-md overflow-hidden border border-[#334155] hover:border-[#3b82f6]/60"
            title={new Date(c.createdAt).toLocaleString()}
          >
            <img src={optimizedImageUrl(c.url)} alt="" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  )
}
