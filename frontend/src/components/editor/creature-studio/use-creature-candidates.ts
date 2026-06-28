import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ConcurrentModificationError, generateCreature } from "@/lib/api"
import { useCreatureStudioJobs, type TrackedJob } from "./use-creature-studio-jobs"
import type { CreatureStudioState } from "./use-creature-studio"

/** A completed-but-unapproved main-image candidate shown in the grid. */
export type CreatureCandidate = { readonly jobId: string; readonly url: string }

/**
 * Public API returned by {@link useCreatureCandidates}. Drives the Appearance
 * page's main-image candidate grid + Generate/Approve/Discard flow.
 */
export interface CreatureCandidatesApi {
  /** Completed candidate images awaiting Approve/Discard. */
  candidates: CreatureCandidate[]
  /** In-flight candidate-generation jobs — drives the "Generating N…" status
   *  text and the approve/discard lock. Mirrors the page's old `jobs.tracked`. */
  tracked: ReadonlyArray<TrackedJob>
  /** Kick off `count` (1/2/4) parallel main-image generations. */
  generate: (count: 1 | 2 | 4) => Promise<void>
  /** Approve one candidate as the canonical main image; clears the grid. */
  approve: (candidateJobId: string) => Promise<void>
  /** Drop one candidate from the grid (no API call). */
  discard: (candidateJobId: string) => void
}

/**
 * Owns the creature main-image multi-candidate state + the candidate-generation
 * jobs tracker. Lifted to MODAL scope (out of `pages/appearance-page.tsx`) and
 * provided via `CreatureCandidatesContext` so in-flight candidate jobs + the
 * completed-candidate grid survive Appearance↔other-tab navigation — the pages
 * are separate mounts under `StudioShell`, so leaving this state on the
 * Appearance page meant the jobs tracker unmounted (and its candidates were
 * lost) on every tab switch. Mirrors character's `usePortraitCandidates`.
 *
 * Behavior is byte-identical to the old page-local implementation: the
 * `count === 1` attach-on-completion path, the `{ jobId } | { jobIds }` return
 * shapes, the approving-lock, and the ConcurrentModification recovery are all
 * preserved; only WHERE the state lives changed (page → modal).
 */
export function useCreatureCandidates(studio: CreatureStudioState): CreatureCandidatesApi {
  const [candidates, setCandidates] = useState<CreatureCandidate[]>([])
  const jobs = useCreatureStudioJobs([])

  // Wire onResolved once — push completed candidates into the grid. The hook
  // keeps the callback in a ref so the polling effect doesn't restart on
  // re-renders.
  useEffect(() => {
    jobs.onResolved((j) => {
      if (j.assetType !== "main") return
      setCandidates((prev) =>
        prev.some((c) => c.jobId === j.jobId) ? prev : [...prev, { jobId: j.jobId, url: j.url }],
      )
    })
    jobs.onFailed((jobId) => {
      toast.error(`Candidate ${jobId.slice(0, 8)}… failed`)
    })
  }, [jobs.onResolved, jobs.onFailed])

  async function generate(count: 1 | 2 | 4) {
    const data = studio.stagedData
    if (!data) return
    if (studio.isApprovingMainImage) return
    if (!data.creatureName.trim()) {
      toast.error("Add a creature name first")
      return
    }
    try {
      const creatureDbId = await studio.ensureSavedBeforeGen()
      const result = await generateCreature({
        name: data.creatureName,
        description: data.description || undefined,
        species: data.species || undefined,
        category: data.category,
        style: data.style,
        provider: data.provider,
        count,
        attachToCreatureId: count === 1 ? creatureDbId : undefined,
      })
      // generateCreature returns { jobId } | { jobIds: string[] } depending on
      // count. Type-guard branch covers both shapes.
      const jobIds: ReadonlyArray<string> =
        "jobIds" in result ? result.jobIds : "jobId" in result ? [result.jobId] : []
      if (jobIds.length === 0) {
        toast.error("Backend returned no job ids")
        return
      }
      for (const id of jobIds) {
        jobs.trackJob({ jobId: id, assetType: "main", name: data.creatureName })
      }
    } catch {
      // saveStaged + generateCreature already toast on failure.
    }
  }

  async function approve(candidateJobId: string) {
    const data = studio.stagedData
    if (!data?.creatureDbId) {
      toast.error("Save the creature first")
      return
    }
    studio.setIsApprovingMainImage(true)
    try {
      await studio.approveMainImage(candidateJobId)
      toast.success("Main image approved")
      setCandidates([])
    } catch (e) {
      if (e instanceof ConcurrentModificationError) {
        // Hook toasted + re-staged; just clear the candidates grid because
        // the canonical state may already have a different main image.
        setCandidates([])
      } else {
        toast.error("Approval failed")
      }
    } finally {
      studio.setIsApprovingMainImage(false)
    }
  }

  function discard(candidateJobId: string) {
    setCandidates((prev) => prev.filter((c) => c.jobId !== candidateJobId))
  }

  return { candidates, tracked: jobs.tracked, generate, approve, discard }
}
