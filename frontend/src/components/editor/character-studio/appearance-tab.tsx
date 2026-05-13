import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { X } from "lucide-react"
import { PLACEHOLDER_CHARACTER_NAME } from "@nodaro/shared"
import { cancelJob, generateCharacter, getJobStatus } from "@/lib/api"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import type { CharacterStudioState } from "./use-character-studio"
import type { CharacterStudioJobs } from "./use-character-studio-jobs"
import { ImageAssetTab, IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from "./expressions-tab"

const ANGLE_PRESETS = ["front", "3/4 left", "left profile", "right profile", "3/4 right", "back"] as const
const LIGHTING_PRESETS = ["daylight", "night", "dramatic"] as const

const POLL_MS = 2000

/**
 * Appearance ("Identity") tab — the character's portrait + base-identity form controls,
 * plus the Angles and Lighting reference-image sub-sections (both reuse `ImageAssetTab`).
 *
 * Portrait results land on `state.staged.sourceImageUrl` (a single string, not an array), so this
 * tab does its own one-off poll of the generate-character job rather than going through
 * `useCharacterStudioJobs` (which is array-asset focused). The interval id is held in a ref so it
 * can be cleared on unmount.
 */
export function AppearanceTab({ state, jobs }: { state: CharacterStudioState; jobs: CharacterStudioJobs }) {
  const [genBusy, setGenBusy] = useState(false)
  // Track the in-flight portrait job so the user can cancel + see progress.
  // Lives outside `useCharacterStudioJobs` because the portrait result writes
  // to a single column (`source_image_url`), not a JSONB array, so the hook's
  // resolved-asset shape doesn't fit.
  const [portraitJob, setPortraitJob] = useState<{ jobId: string; progress: number } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const s = state.staged
  const portraitProvider = s.provider ?? DEFAULT_IMAGE_MODEL
  const portraitCost = useModelCredits(portraitProvider, 0)

  // clear any in-flight poll if the modal/tab unmounts mid-generation
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const cancelPortrait = async () => {
    if (!portraitJob) return
    const { jobId } = portraitJob
    // Stop polling + clear UI state immediately for snappy cancel.
    stopPoll()
    setPortraitJob(null)
    setGenBusy(false)
    try {
      await cancelJob(jobId)
    } catch {
      // Best-effort — if the worker writes the result anyway, the next refetch picks it up.
    }
  }

  const generatePortrait = async () => {
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
      const { jobId } = await generateCharacter({
        name: s.characterName,
        description: s.description,
        gender: s.gender,
        style: s.style,
        baseOutfit: s.baseOutfit,
        sourceImageUrl: s.sourceImageUrl || undefined,
        provider: portraitProvider,
        attachToCharacterId: characterId,
      })
      setPortraitJob({ jobId, progress: 0 })
      // one-off poll — settle on completed / failed / cancelled
      stopPoll()
      pollRef.current = setInterval(async () => {
        try {
          const job = await getJobStatus(jobId)
          if (job.status === "completed") {
            stopPoll()
            setGenBusy(false)
            setPortraitJob(null)
            const url = (job.output_data as { imageUrl?: string } | undefined)?.imageUrl
            // Worker has already written this to characters.source_image_url
            // via setCharacterPortrait — the local patch here is just for
            // instant UX before the next refetch.
            if (url) state.patch({ sourceImageUrl: url })
          } else if (job.status === "failed" || job.status === "cancelled") {
            stopPoll()
            setGenBusy(false)
            setPortraitJob(null)
          } else if (typeof job.progress === "number") {
            setPortraitJob((cur) => (cur ? { ...cur, progress: job.progress } : cur))
          }
        } catch {
          /* transient — retry next tick */
        }
      }, POLL_MS)
    } catch {
      setGenBusy(false)
      setPortraitJob(null)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      <div className="space-y-2.5">
        <div className="text-[9px] uppercase tracking-wide text-slate-500">Portrait</div>
        {s.sourceImageUrl ? (
          <img
            src={s.sourceImageUrl}
            alt="portrait"
            className="w-40 h-52 object-cover rounded-md border border-[#334155]"
          />
        ) : (
          <div className="w-40 h-52 rounded-md border border-dashed border-[#334155] flex items-center justify-center text-[10px] text-slate-500">
            no portrait
          </div>
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
        {portraitJob ? (
          <div className="flex items-center gap-2 max-w-sm">
            <div className="flex-1 h-7 bg-[#13161f] border border-[#3b82f644] rounded overflow-hidden relative">
              {/* progress bar */}
              <div
                className="absolute inset-y-0 left-0 bg-[#3b82f6]/30 transition-all"
                style={{ width: `${Math.max(0, Math.min(100, portraitJob.progress))}%` }}
              />
              <div className="relative h-full flex items-center justify-center text-[10px] text-[#93c5fd] tabular-nums">
                Generating portrait… {Math.round(portraitJob.progress)}%
              </div>
            </div>
            <button
              type="button"
              onClick={cancelPortrait}
              title="Cancel portrait generation"
              className="h-7 w-7 flex items-center justify-center bg-[#1e293b] hover:bg-red-500/70 rounded text-slate-300 hover:text-white transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            disabled={genBusy}
            onClick={generatePortrait}
            className="text-[10px] bg-[#3b82f6] text-white rounded px-3 py-1.5 disabled:opacity-40"
          >
            {`Generate Portrait${portraitCost > 0 ? ` (${portraitCost} CR)` : ""}`}
          </button>
        )}
      </div>

      <div className="border-t border-[#1e293b] pt-4">
        <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-2">Reference Views</div>
        <ImageAssetTab
          state={state}
          jobs={jobs}
          assetType="angles"
          arrayField="angles"
          presets={ANGLE_PRESETS}
          title="Angles"
          description="front, 3/4, profile (L/R), and back reference views"
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
