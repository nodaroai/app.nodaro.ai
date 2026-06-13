import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { approvePortrait, cancelJob, generateCharacter, getJobStatusLean } from "@/lib/api"
import type { CharacterStudioState } from "./use-character-studio"
import type {
  CandidateCount,
  PortraitCandidate,
} from "./portrait-candidate-grid"
import { DEFAULT_IMAGE_MODEL } from "./expressions-tab"

const POLL_MS = 2000

/**
 * Public API returned by {@link usePortraitCandidates}. Drives the portrait
 * grid + approve flow on the Profile page.
 */
export interface PortraitCandidatesApi {
  candidates: PortraitCandidate[]
  previousCandidates: ReadonlyArray<{ jobId: string; url: string; createdAt: string }>
  busy: boolean
  generate: (count: CandidateCount) => Promise<void>
  approve: (jobId: string) => Promise<void>
  cancelCandidate: (jobId: string) => void
}

/**
 * Owns the character portrait multi-candidate state + polling. Lifted to MODAL
 * scope (out of the old `appearance-tab.tsx`/`profile-page.tsx`) so the in-flight
 * candidate spinners + their poll intervals survive Profile↔Appearance page
 * switches — the pages are now separate mounts, so leaving the state on the
 * Profile page meant `stopAllPolls()` fired on every navigation and live
 * spinners were lost on return.
 *
 * The portrait flow is multi-candidate: the user picks a count (1/2/4), kicks off
 * N parallel generate-character jobs, watches them populate a grid, and clicks one
 * to approve as the canonical portrait. Approving cancels the still-running
 * siblings. Each candidate has its own poll interval tracked in `pollRefMap`.
 * Approved portraits land on `state.staged.sourceImageUrl` via the approve-portrait
 * route (the route also returns the LLM-authored `canonicalDescription`).
 */
export function usePortraitCandidates(state: CharacterStudioState): PortraitCandidatesApi {
  const [genBusy, setGenBusy] = useState(false)
  // Multi-candidate portrait state — one entry per in-flight or just-completed
  // generate-character job. Drives <PortraitCandidateGrid>. Seeded from the
  // server's `portraitCandidates` snapshot so spinners reappear when the user
  // re-opens the modal mid-generation (Task 17).
  const [portraitCandidates, setPortraitCandidates] = useState<PortraitCandidate[]>(() =>
    state.initialPortraitCandidates.map((c) => ({
      jobId: c.jobId,
      status: c.status as PortraitCandidate["status"],
      progress: c.progress ?? 0,
      url: c.url,
    })),
  )
  // Previous-approved candidates strip — server-derived: completed-unapproved
  // `generate-character` jobs within the last 7 days (max 5).
  const [previousCandidates, setPreviousCandidates] = useState<
    ReadonlyArray<{ jobId: string; url: string; createdAt: string }>
  >(() => state.initialPreviousCandidates)
  // One poll interval per candidate, keyed by jobId. Cleared individually on
  // settle, all cleared on unmount.
  const pollRefMap = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())
  const s = state.staged
  const portraitProvider = s.provider ?? DEFAULT_IMAGE_MODEL

  // Clear any in-flight polls if the modal unmounts mid-generation. Now that
  // this hook lives at modal scope, this fires on modal close (not page switch).
  useEffect(() => {
    return () => {
      stopAllPolls()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Rehydrate candidates from the server snapshot when the modal opens (or
  // re-opens after backend rehydration). For any pending/running candidate
  // in the seed, attach a poll so the grid completes/fails just like a
  // freshly-kicked-off generation. Skips any jobId we're already polling so
  // we don't double-poll when this effect re-runs.
  useEffect(() => {
    setPortraitCandidates(
      state.initialPortraitCandidates.map((c) => ({
        jobId: c.jobId,
        status: c.status as PortraitCandidate["status"],
        progress: c.progress ?? 0,
        url: c.url,
      })),
    )
    setPreviousCandidates(state.initialPreviousCandidates)
    for (const c of state.initialPortraitCandidates) {
      if (c.status !== "pending" && c.status !== "running") continue
      if (pollRefMap.current.has(c.jobId)) continue
      startPollingCandidate(c.jobId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.initialPortraitCandidates, state.initialPreviousCandidates])

  const stopPollFor = (jobId: string) => {
    const t = pollRefMap.current.get(jobId)
    if (t) {
      clearInterval(t)
      pollRefMap.current.delete(jobId)
    }
  }

  const stopAllPolls = () => {
    for (const t of pollRefMap.current.values()) clearInterval(t)
    pollRefMap.current.clear()
  }

  // Start (and track) the per-candidate poll loop for one generate-character
  // job. Shared by the rehydrate effect (seeded pending/running candidates) and
  // `generatePortrait` (fresh jobs) — identical cadence, terminal-state stop via
  // `stopPollFor`, and double-poll guard semantics. The caller is responsible
  // for the double-poll guard (`pollRefMap.current.has`) where it matters.
  const startPollingCandidate = (jobId: string) => {
    const interval = setInterval(async () => {
      try {
        const job = await getJobStatusLean(jobId)
        setPortraitCandidates((curr) =>
          curr.map((cur) =>
            cur.jobId === jobId
              ? {
                  ...cur,
                  status: job.status as PortraitCandidate["status"],
                  progress: typeof job.progress === "number" ? job.progress : cur.progress,
                  url: (job.output_data as { imageUrl?: string } | undefined)?.imageUrl,
                }
              : cur,
          ),
        )
        if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
          stopPollFor(jobId)
        }
      } catch {
        /* transient — retry next tick */
      }
    }, POLL_MS)
    pollRefMap.current.set(jobId, interval)
  }

  const generatePortrait = async (count: CandidateCount) => {
    // Stop any in-flight polls from a prior generation BEFORE kicking off the
    // next batch — otherwise the about-to-be-replaced candidates keep ticking
    // silently against `getJobStatus` until each old job hits a terminal state.
    // On a stuck provider this leaks intervals and wastes API calls.
    stopAllPolls()
    setGenBusy(true)
    let characterId: string
    try {
      characterId = await state.ensureSaved()
    } catch (e) {
      setGenBusy(false)
      toast.error(e instanceof Error ? e.message : "Could not save character.")
      return
    }
    try {
      const { jobIds } = await generateCharacter({
        name: s.characterName,
        description: s.description,
        gender: s.gender,
        style: s.style,
        baseOutfit: s.baseOutfit,
        sourceImageUrl: s.sourceImageUrl || undefined,
        provider: portraitProvider,
        attachToCharacterId: characterId,
        count,
        seedPrompt: s.seedPrompt,
        // ReadonlyArray<{url, kind: ReferencePhotoKind}> -> Array<{url, kind: <same union>}>
        referencePhotos: s.referencePhotos ? [...s.referencePhotos] : undefined,
        // Forward the character node's 4-pill toggle so the backend's
        // per-asset-type default (portrait = 3:4) can be overridden when the
        // user has explicitly picked a different ratio on the canvas.
        characterNodeAspectRatio: s.defaultAssetAspectRatio,
      })
      setGenBusy(false)
      setPortraitCandidates(
        jobIds.map((jobId) => ({ jobId, status: "pending" as const, progress: 0 })),
      )
      for (const jobId of jobIds) {
        startPollingCandidate(jobId)
      }
    } catch (e) {
      setGenBusy(false)
      toast.error(e instanceof Error ? e.message : "Generation failed.")
    }
  }

  const handleApprove = async (jobId: string) => {
    if (!s.characterDbId) return
    try {
      const result = await approvePortrait(s.characterDbId, jobId)
      state.patch({
        sourceImageUrl: result.portraitUrl,
        canonicalDescription: result.canonicalDescription ?? "",
      })
      // Cancel any pending/running siblings — approval implicitly discards them.
      for (const c of portraitCandidates) {
        if (c.jobId !== jobId && (c.status === "pending" || c.status === "running")) {
          void cancelJob(c.jobId)
          stopPollFor(c.jobId)
        }
      }
      setPortraitCandidates([])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approval failed — retry?")
    }
  }

  const cancelCandidate = (jobId: string) => {
    void cancelJob(jobId)
    stopPollFor(jobId)
  }

  return {
    candidates: portraitCandidates,
    previousCandidates,
    busy: genBusy,
    generate: generatePortrait,
    approve: handleApprove,
    cancelCandidate,
  }
}
