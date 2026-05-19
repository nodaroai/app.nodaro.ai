import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ConcurrentModificationError, generateLocation } from "@/lib/api"
import type { LocationReferencePhoto } from "@/types/nodes"
import { ReferencePhotosSection } from "./reference-photos-section"
import { useLocationStudioJobs } from "./use-location-studio-jobs"
import type { LocationStudioState } from "./use-location-studio"

/**
 * Appearance tab — main image preview, identity form (name + description),
 * Generate button with candidate count (1/2/4), candidates grid with
 * Approve/Discard per card, canonical description display, reference photos.
 *
 * Approval flow:
 *  1. User clicks Generate → ensureSavedBeforeGen() creates the row if needed.
 *  2. POST /v1/generate-location with `count` and (count===1) attachToLocationId.
 *  3. useLocationStudioJobs polls; on completion pushes to local candidates.
 *  4. User clicks Approve → POST /v1/locations/:id/approve-main-image with the
 *     candidateJobId. The route persists source_image_url + canonical_description.
 *  5. setIsApprovingMainImage(true) during the in-flight call so Generate is
 *     locked out — prevents an "approve then immediately re-generate" race.
 *
 * Discard is purely client-side: drops the candidate card without telling the
 * backend. The completed asset is still in `assets` (R2 + DB jobs.output_data)
 * if the user wants it back — cleanup-cron eventually purges unowned ones.
 */
interface AppearanceTabProps {
  readonly studio: LocationStudioState
}

type Candidate = { readonly jobId: string; readonly url: string }

export function AppearanceTab({ studio }: AppearanceTabProps) {
  const data = studio.stagedData
  const [count, setCount] = useState<1 | 2 | 4>(1)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const jobs = useLocationStudioJobs([])

  // Wire onResolved once — push completed candidates into the grid. The hook
  // keeps the callback in a ref so the polling effect doesn't restart on
  // re-renders. `jobs.onResolved` / `jobs.onFailed` are stable (useCallback
  // with `[]` in `use-location-studio-jobs.ts`), so `[]` here would be safe
  // but ESLint exhaustive-deps still wants them listed — pass them explicitly
  // so the rule is satisfied without disabling.
  useEffect(() => {
    jobs.onResolved((j) => {
      if (j.assetType !== "main") return
      setCandidates((prev) => (prev.some((c) => c.jobId === j.jobId) ? prev : [...prev, { jobId: j.jobId, url: j.url }]))
    })
    jobs.onFailed((jobId) => {
      toast.error(`Candidate ${jobId.slice(0, 8)}… failed`)
    })
  }, [jobs.onResolved, jobs.onFailed])

  // Guard against the cold-load case — the modal already short-circuits to
  // a placeholder, so by the time AppearanceTab mounts `data` is non-null.
  if (!data) return null

  async function handleGenerate() {
    if (!data) return
    if (studio.isApprovingMainImage) return
    if (!data.locationName.trim()) {
      toast.error("Add a location name first")
      return
    }
    try {
      // Q-8: if there's no DB row yet, save first so the worker has a target
      // for attachToLocationId. count===1 is the only path that attaches —
      // multi-candidate batches are always "show me 4, I'll approve one."
      const locationDbId = await studio.ensureSavedBeforeGen()
      const result = await generateLocation({
        name: data.locationName,
        description: data.description || undefined,
        category: data.category,
        style: data.style,
        provider: data.provider,
        count,
        attachToLocationId: count === 1 ? locationDbId : undefined,
      })
      const jobIds: ReadonlyArray<string> = result.jobIds ?? (result.jobId ? [result.jobId] : [])
      if (jobIds.length === 0) {
        toast.error("Backend returned no job ids")
        return
      }
      for (const id of jobIds) {
        jobs.trackJob({ jobId: id, assetType: "main", name: data.locationName })
      }
    } catch {
      // saveStaged + generateLocation already toast on failure.
    }
  }

  async function handleApprove(candidateJobId: string) {
    if (!data?.locationDbId) {
      toast.error("Save the location first")
      return
    }
    studio.setIsApprovingMainImage(true)
    try {
      // Studio hook owns the network + 409 recovery so the codepath
      // mirrors save. On 409 the hook already toasted + re-staged; we
      // just bail out of the success branch.
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

  function handleDiscard(candidateJobId: string) {
    setCandidates((prev) => prev.filter((c) => c.jobId !== candidateJobId))
  }

  // Phase 2 #9: lock approval flow whenever a main-image generation job is in
  // flight. This prevents the "approve candidate A while candidate B is still
  // generating" race even within a single tab — the user can only approve
  // once every main-image job has resolved or failed (jobs hook drops them
  // from `tracked` on terminal status). Discard is gated by the same
  // condition so the user can't drop a card under an in-flight gen either.
  const mainImageGenPending = jobs.tracked.some((j) => j.assetType === "main")
  const approveDiscardDisabled = studio.isApprovingMainImage || mainImageGenPending

  const generateDisabled =
    studio.isApprovingMainImage || studio.isSaving || !data.locationName.trim()

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Main image preview */}
      <section>
        <h2 className="text-[12px] font-medium text-slate-300 mb-2">Main image</h2>
        {data.sourceImageUrl ? (
          <img
            src={data.sourceImageUrl}
            alt={data.locationName || "Location"}
            loading="lazy"
            className="w-full max-h-[400px] object-cover rounded border border-[#1e293b]"
          />
        ) : (
          <div className="aspect-video bg-[#1a1d27] rounded border border-[#1e293b] flex items-center justify-center text-[11px] text-slate-500">
            No main image yet — generate candidates below
          </div>
        )}
      </section>

      {/* Identity form */}
      <section className="space-y-3">
        <h2 className="text-[12px] font-medium text-slate-300">Identity</h2>
        <label className="block">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Name</span>
          <input
            type="text"
            value={data.locationName || ""}
            onChange={(e) => studio.patch({ locationName: e.target.value })}
            placeholder="e.g. Cafe Roma at golden hour"
            className="w-full mt-1 px-3 py-2 text-[12px] bg-[#1a1d27] border border-[#1e293b] rounded text-slate-200 placeholder:text-slate-600"
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Description</span>
          <textarea
            value={data.description || ""}
            onChange={(e) => studio.patch({ description: e.target.value })}
            placeholder="Optional — describe atmosphere, vibe, key details"
            rows={3}
            className="w-full mt-1 px-3 py-2 text-[12px] bg-[#1a1d27] border border-[#1e293b] rounded text-slate-200 placeholder:text-slate-600 resize-y"
          />
        </label>
      </section>

      {/* Generate */}
      <section>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-400">Candidates:</span>
          <div className="flex gap-1" role="group" aria-label="Candidate count">
            {([1, 2, 4] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                aria-pressed={count === n}
                className={
                  count === n
                    ? "px-3 py-1.5 text-[11px] rounded bg-[#22d3ee] text-slate-900 font-medium"
                    : "px-3 py-1.5 text-[11px] rounded bg-[#1a1d27] text-slate-400 hover:text-slate-200 border border-[#1e293b]"
                }
              >
                {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generateDisabled}
            className="ml-auto px-4 py-1.5 text-[12px] rounded bg-[#ff0073] hover:bg-[#ff0073]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
          >
            Generate
          </button>
        </div>
        {jobs.tracked.length > 0 && (
          <div className="mt-2 text-[10px] text-slate-500">
            Generating {jobs.tracked.length} candidate{jobs.tracked.length === 1 ? "" : "s"}…
          </div>
        )}
      </section>

      {/* Candidates grid */}
      {candidates.length > 0 && (
        <section>
          <h2 className="text-[12px] font-medium text-slate-300 mb-2">Candidates</h2>
          <div className="grid grid-cols-2 gap-3">
            {candidates.map((c) => (
              <div key={c.jobId} className="border border-[#1e293b] rounded p-2 bg-[#0e1117]">
                <img
                  src={c.url}
                  alt="candidate"
                  loading="lazy"
                  className="w-full aspect-square object-cover rounded"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => handleApprove(c.jobId)}
                    disabled={approveDiscardDisabled}
                    title={
                      mainImageGenPending
                        ? "Wait for in-flight candidate generations to finish"
                        : undefined
                    }
                    className="flex-1 text-[11px] px-2 py-1 rounded bg-[#22d3ee] hover:bg-[#22d3ee]/90 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-medium"
                  >
                    {studio.isApprovingMainImage ? "Approving…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDiscard(c.jobId)}
                    disabled={approveDiscardDisabled}
                    title={
                      mainImageGenPending
                        ? "Wait for in-flight candidate generations to finish"
                        : undefined
                    }
                    className="text-[11px] px-2 py-1 rounded bg-[#1a1d27] hover:bg-[#1e293b] disabled:opacity-40 disabled:cursor-not-allowed text-slate-400"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Canonical description (LLM-authored, read-only display) */}
      {data.canonicalDescription && (
        <section className="text-[11px] bg-[#0e1117] border border-[#1e293b] p-3 rounded">
          <div className="font-medium text-slate-300 mb-1">Canonical description</div>
          <div className="text-slate-400 italic">{data.canonicalDescription}</div>
          <div className="text-[9px] text-slate-600 mt-1">Auto-generated when you approved the main image.</div>
        </section>
      )}

      {/* Reference photos */}
      <section>
        <ReferencePhotosSection
          photos={data.referencePhotos ?? []}
          onChange={(photos: LocationReferencePhoto[]) => studio.patch({ referencePhotos: photos })}
        />
      </section>
    </div>
  )
}
