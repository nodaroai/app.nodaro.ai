import { useState } from "react"
import { X } from "lucide-react"

export type CandidateCount = 1 | 2 | 4

export interface PortraitCandidate {
  readonly jobId: string
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled"
  readonly progress?: number
  readonly url?: string
}

interface PortraitCandidateGridProps {
  readonly characterId: string
  readonly candidates: ReadonlyArray<PortraitCandidate>
  readonly onGenerate: (count: CandidateCount) => void
  readonly onApprove: (jobId: string) => void
  readonly onCancelCandidate: (jobId: string) => void
  readonly cost: number
  readonly busy?: boolean
}

const COUNTS: ReadonlyArray<CandidateCount> = [1, 2, 4]

export function PortraitCandidateGrid({
  candidates,
  onGenerate,
  onApprove,
  onCancelCandidate,
  cost,
  busy,
}: PortraitCandidateGridProps) {
  const [count, setCount] = useState<CandidateCount>(1)
  const totalCost = cost * count
  const generateLabel = count === 1 ? `Generate · ${totalCost} CR` : `Generate ${count} · ${totalCost} CR`

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-wide text-slate-500">Candidates</span>
        <div className="flex gap-1">
          {COUNTS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={count === c}
              onClick={() => setCount(c)}
              className={`text-[10px] h-6 w-7 rounded-md ${
                count === c
                  ? "bg-[#3b82f6] text-white"
                  : "bg-[#1e293b] text-slate-300 hover:bg-[#253245]"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onGenerate(count)}
          className="ml-auto text-[10px] bg-[#3b82f6] text-white rounded px-3 py-1.5 disabled:opacity-40"
        >
          {generateLabel}
        </button>
      </div>
      {candidates.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {candidates.map((c) => (
            <CandidateCard
              key={c.jobId}
              candidate={c}
              onApprove={() => onApprove(c.jobId)}
              onCancel={() => onCancelCandidate(c.jobId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CandidateCard({
  candidate,
  onApprove,
  onCancel,
}: {
  candidate: PortraitCandidate
  onApprove: () => void
  onCancel: () => void
}) {
  const done = candidate.status === "completed" && candidate.url
  return (
    <div className="relative rounded-md overflow-hidden bg-[#13161f] border border-[#334155] aspect-[3/4]">
      {done ? (
        <button
          type="button"
          aria-label={`Approve candidate ${candidate.jobId}`}
          onClick={onApprove}
          className="block w-full h-full"
        >
          <img src={candidate.url} alt={`candidate ${candidate.jobId}`} className="w-full h-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] py-1 text-center">
            Click to approve
          </div>
        </button>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center">
          {candidate.status === "failed" ? (
            <span className="text-red-400 text-[10px]">failed</span>
          ) : candidate.status === "cancelled" ? (
            <span className="text-slate-500 text-[10px]">cancelled</span>
          ) : (
            <>
              <div className="text-[10px] text-slate-400 mb-1">{candidate.status}</div>
              <div className="text-[10px] text-slate-300">{Math.round(candidate.progress ?? 0)}%</div>
            </>
          )}
          {(candidate.status === "pending" || candidate.status === "running") && (
            <button
              type="button"
              aria-label="Cancel candidate"
              onClick={onCancel}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
