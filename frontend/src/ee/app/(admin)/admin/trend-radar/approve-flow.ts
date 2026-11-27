// Approving a candidate, the one way both the candidate page and the gallery's
// viewer do it: with a top post, its clip is downloaded into the draft, so the
// admin confirms the content declaration for that post's link first and the
// confirmation rides into the download. The box starts unticked for every
// candidate.

import { useEffect, useState } from "react"
import type { TrendCandidateApproval, TrendCandidateCard } from "@nodaro/sdk/trend-radar"
import { useApproveCandidate, useRightsDeclaration } from "./use-trend-radar"

/** Whether a candidate can still be opened as a draft trend here. */
export function openForApproval(c: Pick<TrendCandidateCard, "status" | "trendId"> | undefined): boolean {
  return !!c && !(c.status === "approved" && c.trendId) && c.status !== "rejected" && c.status !== "archived"
}

export function useApproveFlow(c: TrendCandidateCard | undefined) {
  const approve = useApproveCandidate()
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const candidateId = c?.id
  // A new candidate starts unticked: a tick is for one post's link only.
  useEffect(() => setRightsConfirmed(false), [candidateId])

  const top = c?.topPost ?? null
  const open = openForApproval(c)
  const declaration = useRightsDeclaration(open && !!top)
  const needsRights = !!top
  const ready = open && (!needsRights || (rightsConfirmed && !!declaration.data))

  const run = (handlers: { onSuccess?: (approval: TrendCandidateApproval) => void; onError?: (e: unknown) => void }) => {
    if (!c || !ready) return
    const confirm = needsRights && top && declaration.data ? { url: top.url, declarationVersion: declaration.data.version } : undefined
    approve.mutate({ id: c.id, ...(confirm ? { confirm } : {}) }, handlers)
  }

  return {
    top,
    open,
    needsRights,
    ready,
    rightsConfirmed,
    setRightsConfirmed,
    declaration: declaration.data,
    declarationError: declaration.error,
    reloadDeclaration: () => void declaration.refetch(),
    pending: approve.isPending,
    run,
  }
}
