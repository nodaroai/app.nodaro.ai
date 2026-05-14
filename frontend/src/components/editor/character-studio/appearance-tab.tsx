import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Link as LinkIcon, Maximize2 } from "lucide-react"
import { PLACEHOLDER_CHARACTER_NAME } from "@nodaro/shared"
import { approvePortrait, cancelJob, generateCharacter, getJobStatus } from "@/lib/api"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { copyToClipboard } from "@/lib/utils"
import { MultiImageLightbox } from "@/components/ui/multi-image-lightbox"
import type { CharacterStudioState } from "./use-character-studio"
import type { CharacterStudioJobs } from "./use-character-studio-jobs"
import { ImageAssetTab, IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from "./expressions-tab"
import { ReferencePhotosBlock } from "./reference-photos-block"
import { ReferenceCascadeBanner } from "./reference-cascade-banner"
import {
  PortraitCandidateGrid,
  type CandidateCount,
  type PortraitCandidate,
} from "./portrait-candidate-grid"
import { PreviousCandidatesStrip } from "./previous-candidates-strip"
import { CanonicalDescriptionExpander } from "./canonical-description-expander"
import { PersonPickerExpander } from "./person-picker-expander"
import { SeedPromptTextarea } from "./seed-prompt-textarea"

// Head angles drop "back" (back-of-head is rarely useful as a likeness ref);
// body angles keep all 6 since back-body views matter for character sheets.
const HEAD_ANGLE_PRESETS = ["front", "3/4 left", "left profile", "right profile", "3/4 right"] as const
const BODY_ANGLE_PRESETS = ["front", "3/4 left", "left profile", "right profile", "3/4 right", "back"] as const
const LIGHTING_PRESETS = ["daylight", "night", "dramatic"] as const

const POLL_MS = 2000

/**
 * Appearance ("Identity") tab — the character's portrait + base-identity form controls,
 * plus the Angles and Lighting reference-image sub-sections (both reuse `ImageAssetTab`).
 *
 * The portrait flow is multi-candidate: the user picks a count (1/2/4), kicks off N parallel
 * generate-character jobs, watches them populate a grid, and clicks one to approve as the
 * canonical portrait. Approving cancels the still-running siblings. Each candidate has its
 * own poll interval tracked in `pollRefMap`. Approved portraits land on
 * `state.staged.sourceImageUrl` via the approve-portrait route (the route also returns the
 * LLM-authored `canonicalDescription` for the expander below).
 */
export function AppearanceTab({ state, jobs }: { state: CharacterStudioState; jobs: CharacterStudioJobs }) {
  const [genBusy, setGenBusy] = useState(false)
  const [portraitLightboxOpen, setPortraitLightboxOpen] = useState(false)
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
  const portraitCost = useModelCredits(portraitProvider, 0)

  // Clear any in-flight polls if the modal/tab unmounts mid-generation.
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
      const jobId = c.jobId
      const interval = setInterval(async () => {
        try {
          const job = await getJobStatus(jobId)
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
      })
      setGenBusy(false)
      setPortraitCandidates(
        jobIds.map((jobId) => ({ jobId, status: "pending" as const, progress: 0 })),
      )
      for (const jobId of jobIds) {
        const interval = setInterval(async () => {
          try {
            const job = await getJobStatus(jobId)
            setPortraitCandidates((curr) =>
              curr.map((c) =>
                c.jobId === jobId
                  ? {
                      ...c,
                      status: job.status as PortraitCandidate["status"],
                      progress: typeof job.progress === "number" ? job.progress : c.progress,
                      url: (job.output_data as { imageUrl?: string } | undefined)?.imageUrl,
                    }
                  : c,
              ),
            )
            if (
              job.status === "completed" ||
              job.status === "failed" ||
              job.status === "cancelled"
            ) {
              stopPollFor(jobId)
            }
          } catch {
            /* transient — retry next tick */
          }
        }, POLL_MS)
        pollRefMap.current.set(jobId, interval)
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

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      <ReferencePhotosBlock
        photos={s.referencePhotos ?? []}
        onChange={(next) => state.patch({ referencePhotos: next })}
      />
      <ReferenceCascadeBanner
        visible={false /* TODO Task 7+: derive from referencePhotos changes after first gen */}
        onDismiss={() => {}}
      />

      <div className="space-y-2.5">
        <div className="text-[9px] uppercase tracking-wide text-slate-500">Portrait</div>
        {s.sourceImageUrl ? (
          <ApprovedPortrait
            url={s.sourceImageUrl}
            onEnlarge={() => setPortraitLightboxOpen(true)}
          />
        ) : (
          <div className="w-40 h-52 rounded-md border border-dashed border-[#334155] flex items-center justify-center text-[10px] text-slate-500">
            generate a portrait below
          </div>
        )}

        <PortraitCandidateGrid
          characterId={s.characterDbId ?? ""}
          candidates={portraitCandidates}
          onGenerate={(count) => void generatePortrait(count)}
          onApprove={(jobId) => void handleApprove(jobId)}
          onCancelCandidate={(jobId) => {
            void cancelJob(jobId)
            stopPollFor(jobId)
          }}
          cost={portraitCost}
          busy={genBusy}
        />

        <PreviousCandidatesStrip
          candidates={previousCandidates}
          onReApprove={(jobId) => void handleApprove(jobId)}
        />

        {s.characterDbId && (
          <CanonicalDescriptionExpander
            characterId={s.characterDbId}
            value={s.canonicalDescription ?? ""}
            onChange={(next) => state.patch({ canonicalDescription: next })}
          />
        )}

        <NameInput
          name={s.characterName}
          onChange={(v) => state.patch({ characterName: v })}
        />
        <textarea
          value={s.description}
          onChange={(e) => state.patch({ description: e.target.value })}
          placeholder="Appearance description"
          rows={3}
          className="block w-full max-w-sm text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        />
        <div className="flex gap-2 max-w-sm">
          <select
            value={s.gender}
            onChange={(e) => state.patch({ gender: e.target.value as typeof s.gender })}
            className="text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
          >
            <option value="male">male</option>
            <option value="female">female</option>
            <option value="other">other</option>
          </select>
          <select
            value={s.style}
            onChange={(e) => state.patch({ style: e.target.value as typeof s.style })}
            className="text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
          >
            <option value="realistic">realistic</option>
            <option value="anime">anime</option>
            <option value="3d-pixar">3d-pixar</option>
            <option value="illustration">illustration</option>
          </select>
        </div>
        <input
          value={s.baseOutfit}
          onChange={(e) => state.patch({ baseOutfit: e.target.value })}
          placeholder="Base outfit"
          className="block w-full max-w-sm text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        />
        <input
          value={s.sourceImageUrl}
          onChange={(e) => state.patch({ sourceImageUrl: e.target.value })}
          placeholder="Reference image URL (optional)"
          className="block w-full max-w-sm text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        />
        <select
          value={portraitProvider}
          onChange={(e) => state.patch({ provider: e.target.value })}
          className="block text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <PersonPickerExpander
          onPromptFragment={(fragment) =>
            state.patch({
              seedPrompt: (s.seedPrompt ?? "").trim()
                ? `${(s.seedPrompt ?? "").trimEnd()}\n${fragment}`
                : fragment,
            })
          }
        />

        <SeedPromptTextarea
          value={s.seedPrompt ?? ""}
          onChange={(next) => state.patch({ seedPrompt: next })}
          suggestContext={{
            referencePhotos: s.referencePhotos,
            gender: s.gender,
            style: s.style,
            baseOutfit: s.baseOutfit,
          }}
        />
      </div>

      <div className="border-t border-[#1e293b] pt-4">
        <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-2">Head / Face Angles</div>
        <ImageAssetTab
          state={state}
          jobs={jobs}
          assetType="headAngles"
          arrayField="angles"
          presets={HEAD_ANGLE_PRESETS}
          title="Head Angles"
          description="head-and-shoulders portraits at different angles"
        />
      </div>
      <div className="border-t border-[#1e293b] pt-4">
        <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-2">Body Angles</div>
        <ImageAssetTab
          state={state}
          jobs={jobs}
          assetType="bodyAngles"
          arrayField="bodyAngles"
          presets={BODY_ANGLE_PRESETS}
          title="Body Angles"
          description="full-body T-pose at different angles"
        />
      </div>
      <div className="border-t border-[#1e293b] pt-4">
        <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-2">Lighting Variations</div>
        <ImageAssetTab
          state={state}
          jobs={jobs}
          assetType="lighting"
          arrayField="lightingVariations"
          presets={LIGHTING_PRESETS}
          title="Lighting"
          description="daylight / night / dramatic"
        />
      </div>
      {/* Portrait lightbox — single-image set. Angles and Lighting render
          their own lightboxes via ImageAssetTab, scoped to each sub-grid. */}
      <MultiImageLightbox
        items={s.sourceImageUrl ? [{ url: s.sourceImageUrl, alt: "Portrait" }] : []}
        startIndex={portraitLightboxOpen && s.sourceImageUrl ? 0 : null}
        onClose={() => setPortraitLightboxOpen(false)}
      />
    </div>
  )
}

/**
 * Approved-portrait tile with hover overlay (Enlarge + Copy URL). Extracted as
 * its own component for clarity now that the portrait section also renders the
 * candidate grid + previous-candidates strip below.
 */
function ApprovedPortrait({ url, onEnlarge }: { url: string; onEnlarge: () => void }) {
  return (
    <div className="relative w-40 h-52 group">
      <img
        src={url}
        alt="portrait"
        className="w-full h-full object-cover rounded-md border border-[#334155]"
      />
      <div className="absolute top-1 left-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          aria-label="Enlarge"
          title="Enlarge"
          className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
          onClick={onEnlarge}
        >
          <Maximize2 className="w-3 h-3" />
        </button>
        <button
          type="button"
          aria-label="Copy URL"
          title="Copy URL"
          className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
          onClick={() => copyToClipboard(url, "URL copied")}
        >
          <LinkIcon className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

/**
 * Name input with a rename cue when the character is using the auto-assigned
 * placeholder. The input renders the placeholder name in dimmed text + shows
 * a "↻ Click to rename" microcopy beneath; once the user starts typing, the
 * field switches to normal styling. The actual value is cleared from the
 * input visually when it matches the placeholder so users see an empty field
 * to type into (the placeholder string remains in state — that's what flows
 * to the DB and prompts).
 */
function NameInput({ name, onChange }: { name: string; onChange: (v: string) => void }) {
  const isPlaceholder = name === PLACEHOLDER_CHARACTER_NAME
  return (
    <div className="space-y-1 max-w-sm">
      <input
        value={isPlaceholder ? "" : name}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isPlaceholder ? `${PLACEHOLDER_CHARACTER_NAME} — click to rename` : "Character name"}
        className={`block w-full text-[11px] bg-[#13161f] border rounded px-2 py-1 text-slate-200 ${
          isPlaceholder ? "border-[#3b82f644] placeholder:text-[#3b82f699]" : "border-[#334155]"
        }`}
      />
      {isPlaceholder && (
        <div className="text-[9px] text-[#3b82f699]">↻ Give your character a name — it'll also clean up the gallery.</div>
      )}
    </div>
  )
}
