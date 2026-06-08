import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  OBJECT_MOTION_PROVIDERS,
  type ObjectMotionProvider,
} from "@nodaro/shared"
import { generateCreatureMotion } from "@/lib/api"
import { useCreatureStudioJobs } from "./use-creature-studio-jobs"
import type { CreatureStudioState } from "./use-creature-studio"
import type { ObjectAssetItem, CreatureNodeData } from "@/types/nodes"

/**
 * MotionTab — the 5th and final Creature Studio tab. Produces motion clips
 * via the i2v provider chain (Kling family + Wan family + Seedance +
 * BytedanceLite), always anchored to the approved main image.
 *
 * Mirrors the object-studio MotionTab precedent with object → creature
 * substitution + creature-specific deltas:
 *  - generateCreatureMotion (not generateObjectMotion); attach field is
 *    `attachToCreatureId`.
 *  - Creature-appropriate motion presets (walk/run/idle/etc.) rather than
 *    the object's product-showcase set (rotate-360/hover/etc.).
 *  - Reuses OBJECT_MOTION_PROVIDERS (8 providers, default kling-turbo) — the
 *    i2v provider chain is shared across the entity studios; there is no
 *    creature-specific provider list.
 *  - Default aspect ratio "1:1" (resolved server-side identically to object).
 *  - data.motionClips is the bucket on CreatureNodeData.
 *  - attachToColumn is implicit server-side ("motion_clips") — the route sets
 *    it internally so callers don't supply it.
 *
 * Source frame requirement: every i2v call needs a source image. When
 * `sourceImageUrl` is empty we disable every interactive control, show a
 * banner, and tooltip each disabled chip so the user understands why.
 *
 * Save-before-gen: `studio.ensureSavedBeforeGen()` resolves the creatures
 * row id (saving on first generate when absent) before the API call so the
 * auto-attach path never silently no-ops.
 */
const MOTION_PRESETS = [
  "idle-breathing",
  "walk-cycle",
  "run-cycle",
  "head-turn",
  "tail-wag",
  "pounce",
  "stretch",
  "roar",
  "fly-loop",
] as const

type AspectRatio = "1:1" | "3:4" | "16:9" | "9:16"
const ASPECT_RATIOS: ReadonlyArray<AspectRatio> = ["1:1", "3:4", "16:9", "9:16"]

interface MotionTabProps {
  readonly studio: CreatureStudioState
}

export function MotionTab({ studio }: MotionTabProps) {
  const data = studio.stagedData
  const [customPrompt, setCustomPrompt] = useState("")
  const [provider, setProvider] = useState<ObjectMotionProvider>("kling-turbo")
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1")
  const jobs = useCreatureStudioJobs([])

  useEffect(() => {
    jobs.onFailed((jobId) => {
      toast.error(`Motion generation ${jobId.slice(0, 8)}… failed`)
    })
  }, [jobs.onFailed])

  if (!data) return null

  const items: ReadonlyArray<ObjectAssetItem> = data.motionClips ?? []
  const noSourceImage = !data.sourceImageUrl
  const disabled = studio.isApprovingMainImage || noSourceImage

  async function fireGen(motionPrompt: string): Promise<void> {
    if (!data) return
    if (!data.sourceImageUrl) {
      toast.error("Approve a main image first")
      return
    }
    try {
      const creatureDbId = await studio.ensureSavedBeforeGen()
      const trimmed = motionPrompt.slice(0, 200)
      const result = await generateCreatureMotion({
        motionPrompt,
        sourceImageUrl: data.sourceImageUrl,
        provider,
        aspectRatio,
        name: data.creatureName || "Creature",
        category: data.category,
        style: data.style,
        canonicalDescription: data.canonicalDescription || undefined,
        attachToCreatureId: creatureDbId,
        attachName: trimmed,
      })
      jobs.trackJob({
        jobId: result.jobId,
        assetType: "motion_clips",
        name: trimmed,
      })
    } catch {
      // ensureSavedBeforeGen / generateCreatureMotion already toast on failure.
    }
  }

  async function handlePresetClick(motionPrompt: string): Promise<void> {
    if (disabled) return
    await fireGen(motionPrompt)
  }

  async function handleGenerateAll(): Promise<void> {
    if (disabled) return
    const existingNames = new Set(items.map((i) => i.name.toLowerCase()))
    const missing = MOTION_PRESETS.filter((p) => !existingNames.has(p.toLowerCase()))
    if (missing.length === 0) {
      toast.info("All presets already generated")
      return
    }
    if (missing.length >= 4) {
      if (!window.confirm(`This will queue ${missing.length} motion generation jobs.`)) return
    }
    for (const variant of missing) {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential
      await fireGen(variant)
    }
  }

  async function handleCustom(): Promise<void> {
    if (disabled) return
    const trimmed = customPrompt.trim()
    if (!trimmed) return
    if (trimmed.length > 2000) {
      toast.error("Custom motion prompt is too long (max 2000 chars)")
      return
    }
    await fireGen(trimmed)
    setCustomPrompt("")
  }

  function handleRemove(idx: number): void {
    const next = items.filter((_, i) => i !== idx)
    studio.patch({ motionClips: next } as Partial<CreatureNodeData>)
  }

  const trackedMotions = jobs.tracked.filter((j) => j.assetType === "motion_clips")
  const customDisabled = disabled || !customPrompt.trim()
  const presetTooltip = noSourceImage ? "Approve a main image first" : undefined

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-[12px] font-medium text-slate-300">🎬 Motion Clips</h2>
        <button
          type="button"
          onClick={handleGenerateAll}
          disabled={disabled}
          title={presetTooltip}
          className="px-3 py-1 text-[11px] rounded bg-[#1a1d27] hover:bg-[#1e293b] border border-[#1e293b] text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Generate All
        </button>
      </div>

      {noSourceImage && (
        <div
          role="note"
          className="bg-[#1a1d27] border border-[#1e293b] text-slate-300 p-3 rounded text-[11px]"
        >
          Approve a main image first — motion generation needs a source frame.
        </div>
      )}

      {/* Asset grid — video cards + in-flight placeholders */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {items.map((item, idx) => (
          <div
            key={`${item.url}-${idx}`}
            data-testid={`creature-motion-card-${idx}`}
            className="relative group aspect-square border border-[#1e293b] rounded overflow-hidden bg-[#0e1117]"
          >
            <video
              src={item.url}
              preload="metadata"
              controls
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] px-1.5 py-0.5 pointer-events-none">
              {item.name}
            </div>
            <button
              type="button"
              onClick={() => handleRemove(idx)}
              aria-label={`Remove ${item.name}`}
              className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-black/80"
            >
              Remove
            </button>
          </div>
        ))}
        {trackedMotions.map((j) => (
          <div
            key={j.jobId}
            className="aspect-square border border-[#1e293b] rounded bg-[#0e1117] flex items-center justify-center text-[11px] text-slate-400"
          >
            Generating {j.name}…
          </div>
        ))}
        {items.length === 0 && trackedMotions.length === 0 && (
          <div className="col-span-full text-center text-[11px] text-slate-500 py-8 border border-dashed border-[#1e293b] rounded">
            No motion clips yet — pick a preset below or enter a custom motion prompt.
          </div>
        )}
      </div>

      {/* Provider + aspect-ratio picker */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="creature-motion-provider" className="text-[12px] text-slate-300">
            Provider:
          </label>
          <select
            id="creature-motion-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as ObjectMotionProvider)}
            disabled={disabled}
            className="px-2 py-1 text-[12px] bg-[#1a1d27] border border-[#1e293b] rounded text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {OBJECT_MOTION_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="creature-motion-aspect" className="text-[12px] text-slate-300">
            Aspect ratio:
          </label>
          <select
            id="creature-motion-aspect"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
            disabled={disabled}
            className="px-2 py-1 text-[12px] bg-[#1a1d27] border border-[#1e293b] rounded text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {ASPECT_RATIOS.map((ar) => (
              <option key={ar} value={ar}>
                {ar}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Preset chips */}
      <div className="flex flex-wrap gap-2">
        {MOTION_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handlePresetClick(p)}
            disabled={disabled}
            title={presetTooltip}
            className="px-3 py-1 text-[11px] rounded bg-[#1a1d27] hover:bg-[#1e293b] border border-[#1e293b] text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {p}
          </button>
        ))}
      </div>

      {/* Custom prompt */}
      <div className="flex gap-2">
        <input
          type="text"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Custom motion prompt (free-form)"
          disabled={disabled}
          title={presetTooltip}
          className="flex-1 px-3 py-2 text-[12px] bg-[#1a1d27] border border-[#1e293b] rounded text-slate-200 placeholder:text-slate-600 disabled:opacity-40"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void handleCustom()
            }
          }}
        />
        <button
          type="button"
          onClick={() => {
            void handleCustom()
          }}
          disabled={customDisabled}
          title={presetTooltip}
          className="px-4 py-2 text-[12px] rounded bg-[#ff0073] hover:bg-[#ff0073]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
        >
          Generate
        </button>
      </div>
    </div>
  )
}
