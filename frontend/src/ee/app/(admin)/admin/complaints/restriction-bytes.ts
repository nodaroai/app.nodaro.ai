import type { CaseRestriction, RestrictionBytesPhase } from "@/ee/hooks/queries/use-admin-complaints-queries"

/**
 * Where a restriction's bytes are, in words, from its record (backend
 * lib/content-restriction-bytes.ts `bytesSettled`, read the same way): the
 * phase its side calls for (the move while it stands, the move back once
 * lifted), every key done or skipped, and the edge purged — or not purgeable
 * on this deployment. Anything else is left to do, and `settled` is false.
 *
 * `actionable` says whether finishing it now can change anything: a key that
 * waits because another restriction still covers it (`deferred`) moves back
 * only when that one is lifted, so a record whose only remainder is waiting
 * offers no action.
 */
export interface BytesSummary {
  readonly settled: boolean
  readonly actionable: boolean
  readonly text: string
}

const DONE = new Set(["moved", "restored", "skipped"])

export function restrictionBytesSummary(r: CaseRestriction): BytesSummary {
  const lifted = Boolean(r.liftedAt)
  const phase: RestrictionBytesPhase | undefined = lifted ? r.bytes?.lift : r.bytes?.restrict
  if (!phase) return { settled: false, actionable: true, text: lifted ? "Files: not yet moved back" : "Files: not yet moved to evidence" }
  const keys = [...new Set(r.r2Keys)]
  const left = keys.filter((k) => !DONE.has(phase.keys[k]?.state ?? ""))
  const deferred = left.filter((k) => phase.keys[k]?.state === "deferred").length
  const failed = left.length - deferred
  const purgeFailed = phase.purge.status === "failed"
  const parts = [
    ...(left.length === 0 ? [lifted ? "Files back at their address" : "Files moved to evidence"] : []),
    ...(failed > 0 ? [`${failed} file${failed === 1 ? "" : "s"} not ${lifted ? "moved back" : "moved"} yet`] : []),
    ...(deferred > 0 ? [`${deferred} waiting: another restriction still covers ${deferred === 1 ? "it" : "them"}`] : []),
    ...(purgeFailed ? ["the edge did not drop its copies"] : []),
    ...(phase.purge.status === "not_configured" ? ["edge purge not configured here"] : []),
  ]
  return { settled: left.length === 0 && !purgeFailed, actionable: failed > 0 || purgeFailed, text: parts.join(" · ") }
}
