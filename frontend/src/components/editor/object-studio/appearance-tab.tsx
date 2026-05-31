import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ConcurrentModificationError, generateObject } from "@/lib/api"
import { optimizedImageUrl } from "@/lib/image"
import type { ObjectReferencePhoto } from "@/types/nodes"
import { ReferencePhotosSection } from "./reference-photos-section"
import { UpstreamPickerBanner } from "./upstream-picker-banner"
import { useObjectStudioJobs } from "./use-object-studio-jobs"
import type { ObjectStudioState } from "./use-object-studio"

/**
 * Appearance tab — main image preview, identity form (name + description),
 * Generate button with candidate count (1/2/4), candidates grid with
 * Approve/Discard per card, canonical description display, reference photos.
 *
 * Mirrors location-studio/appearance-tab.tsx with location → object
 * substitution + object-specific deltas:
 *  - At top of tab JSX: UpstreamPickerBanner rendered when
 *    `stagedData.legacyPickerSelection` is non-null (E1 breadcrumb).
 *  - Description placeholder text adjusted for objects.
 *  - Reference photos section: object kinds (front/side/detail/context/
 *    moodBoard/other), no PII consent UI.
 *  - generateObject returns `{ jobId } | { jobIds: string[] }` (E1) — the
 *    appearance tab uses an `"jobIds" in result` type guard branch to feed
 *    both shapes into trackJob.
 *
 * Approval flow:
 *  1. User clicks Generate → ensureSavedBeforeGen() creates the row if needed.
 *  2. POST /v1/generate-object with `count` and (count===1) attachToObjectId.
 *  3. useObjectStudioJobs polls; on completion pushes to local candidates.
 *  4. User clicks Approve → POST /v1/objects/:id/approve-main-image with the
 *     candidateJobId. The route persists source_image_url +
 *     canonical_description.
 *  5. setIsApprovingMainImage(true) during the in-flight call so Generate is
 *     locked out — prevents an "approve then immediately re-generate" race.
 */
interface AppearanceTabProps {
  readonly studio: ObjectStudioState
}

type Candidate = { readonly jobId: string; readonly url: string }

export function AppearanceTab({ studio }: AppearanceTabProps) {
  const data = studio.stagedData
  const [count, setCount] = useState<1 | 2 | 4>(1)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const jobs = useObjectStudioJobs([])

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

  // Guard against the cold-load case — the modal already short-circuits to
  // a placeholder, so by the time AppearanceTab mounts `data` is non-null.
  if (!data) return null

  async function handleGenerate() {
    if (!data) return
    if (studio.isApprovingMainImage) return
    if (!data.objectName.trim()) {
      toast.error("Add an object name first")
      return
    }
    try {
      const objectDbId = await studio.ensureSavedBeforeGen()
      const result = await generateObject({
        name: data.objectName,
        description: data.description || undefined,
        category: data.category,
        style: data.style,
        provider: data.provider,
        count,
        attachToObjectId: count === 1 ? objectDbId : undefined,
      })
      // E1 finding: generateObject returns { jobId } | { jobIds: string[] }
      // depending on count. Type-guard branch covers both shapes.
      const jobIds: ReadonlyArray<string> =
        "jobIds" in result ? result.jobIds : "jobId" in result ? [result.jobId] : []
      if (jobIds.length === 0) {
        toast.error("Backend returned no job ids")
        return
      }
      for (const id of jobIds) {
        jobs.trackJob({ jobId: id, assetType: "main", name: data.objectName })
      }
    } catch {
      // saveStaged + generateObject already toast on failure.
    }
  }

  async function handleApprove(candidateJobId: string) {
    if (!data?.objectDbId) {
      toast.error("Save the object first")
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

  function handleDiscard(candidateJobId: string) {
    setCandidates((prev) => prev.filter((c) => c.jobId !== candidateJobId))
  }

  // Lock approval flow whenever a main-image generation job is in flight.
  // Prevents the "approve candidate A while candidate B is still generating"
  // race even within a single tab. Discard is gated by the same condition.
  const mainImageGenPending = jobs.tracked.some((j) => j.assetType === "main")
  const approveDiscardDisabled = studio.isApprovingMainImage || mainImageGenPending

  const generateDisabled =
    studio.isApprovingMainImage || studio.isSaving || !data.objectName.trim()

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Upstream picker banner (E1 breadcrumb). Only renders when the
          legacyPickerSelection breadcrumb is present (non-null + non-
          undefined). User dismissal sets it to null which suppresses
          re-render; the E1 loadWorkflow migration's `=== undefined` guard
          prevents re-migration on subsequent loads. */}
      {data.legacyPickerSelection && (
        <UpstreamPickerBanner
          selection={data.legacyPickerSelection}
          onDismiss={() => studio.patch({ legacyPickerSelection: null })}
        />
      )}

      {/* Main image preview */}
      <section>
        <h2 className="text-[12px] font-medium text-slate-300 mb-2">Main image</h2>
        {data.sourceImageUrl ? (
          <img
            src={optimizedImageUrl(data.sourceImageUrl, { width: 800 })}
            alt={data.objectName || "Object"}
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
            value={data.objectName || ""}
            onChange={(e) => studio.patch({ objectName: e.target.value })}
            placeholder="e.g. Glowing rune sword"
            className="w-full mt-1 px-3 py-2 text-[12px] bg-[#1a1d27] border border-[#1e293b] rounded text-slate-200 placeholder:text-slate-600"
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Description</span>
          <textarea
            value={data.description || ""}
            onChange={(e) => studio.patch({ description: e.target.value })}
            placeholder="Optional — describe form, material, details"
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
                  src={optimizedImageUrl(c.url, { width: 512 })}
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

      {/* Reference photos — NO piiConsentAt (object-specific delta) */}
      <section>
        <ReferencePhotosSection
          photos={data.referencePhotos ?? []}
          onChange={(photos: ObjectReferencePhoto[]) => studio.patch({ referencePhotos: photos })}
        />
      </section>
    </div>
  )
}
