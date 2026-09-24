import { useState } from "react"
import { formatCreditUnits } from "@/lib/credit-units"
import { optimizedImageUrl } from "@/lib/image"
import { X } from "lucide-react"
import { useMediaAspectRatio } from "../studio-shell/use-media-aspect"
import { useT } from "@/lib/i18n"

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
  const t = useT()
  const [count, setCount] = useState<CandidateCount>(1)
  const totalCost = cost * count
  const generateLabel =
    count === 1
      ? t("studio.generateWithCost", { cost: formatCreditUnits(totalCost) })
      : t("studio.generateCountWithCost", { n: count, cost: formatCreditUnits(totalCost) })

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-wide text-slate-500">{t("cfgext.reduceTabCandidates")}</span>
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
          className="ms-auto text-[10px] bg-[#3b82f6] text-white rounded px-3 py-1.5 disabled:opacity-40"
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
  const t = useT()
  const done = candidate.status === "completed" && candidate.url
  // Size to the candidate's real aspect (portraits default 3:4 but the node's
  // aspect override may make them 9:16/16:9) so they aren't cropped.
  const { ratio } = useMediaAspectRatio(done && candidate.url ? candidate.url : "", "image", 0.75)
  return (
    <div className="relative rounded-md overflow-hidden bg-[#13161f] border border-[#334155]" style={{ aspectRatio: ratio }}>
      {done ? (
        <button
          type="button"
          aria-label={t("studio.approveCandidateAria", { id: candidate.jobId })}
          onClick={onApprove}
          className="block w-full h-full"
        >
          <img src={optimizedImageUrl(candidate.url)} alt={t("studio.candidateAltId", { id: candidate.jobId })} className="w-full h-full object-cover object-top" />
          <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] py-1 text-center">
            {t("studio.clickToApprove")}
          </div>
        </button>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center">
          {candidate.status === "failed" ? (
            <span className="text-red-400 text-[10px]">{t("studio.failedLower")}</span>
          ) : candidate.status === "cancelled" ? (
            <span className="text-slate-500 text-[10px]">{t("studio.cancelledLower")}</span>
          ) : (
            <>
              <div className="text-[10px] text-slate-400 mb-1">{candidate.status}</div>
              <div className="text-[10px] text-slate-300">{Math.round(candidate.progress ?? 0)}%</div>
            </>
          )}
          {(candidate.status === "pending" || candidate.status === "running") && (
            <button
              type="button"
              aria-label={t("studio.cancelCandidate")}
              onClick={onCancel}
              className="absolute top-1 end-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
