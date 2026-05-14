import { useCallback, useState } from "react"
import { toast } from "sonner"
import { CHARACTER_MOTION_PROVIDERS } from "@nodaro/shared"
import { generateCharacterMotion } from "@/lib/api"
import type { CharacterStudioState } from "./use-character-studio"
import type { CharacterStudioJobs } from "./use-character-studio-jobs"
import { AssetCard } from "./asset-card"
import { GenerationBar } from "./generation-bar"
import { PendingCard } from "./pending-card"

const MOTION_PRESETS = [
  "walking",
  "running",
  "waving",
  "sitting down",
  "fighting stance",
  "jumping",
  "turning around",
  "dancing",
  "talking gesture",
] as const

const DEFAULT_MOTION_PROVIDER: (typeof CHARACTER_MOTION_PROVIDERS)[number] = "kling"

/**
 * Motions tab — short i2v video clips generated from the staged portrait.
 *
 * Mirrors the Expressions/Poses tabs (5-column AssetCard grid + spinner cards + a GenerationBar)
 * with three differences:
 *  - cards render with `isVideo` (video thumbnail + ▶ overlay) and get NO `onRefine` (video
 *    refinement is Phase 2);
 *  - the model picker uses `CHARACTER_MOTION_PROVIDERS` (i2v providers) instead of image models;
 *  - generation requires an existing portrait — when `sourceImageUrl` is empty the GenerationBar
 *    is disabled and the tab shows a note pointing back to the Appearance tab. No "Generate All"
 *    (each motion is a video credit cost).
 *
 * `onRename` makes each card's name label inline-editable, matching the Expressions/Poses tabs.
 */
export function MotionsTab({
  state,
  jobs,
  onSwitchToAppearance,
}: {
  state: CharacterStudioState
  jobs: CharacterStudioJobs
  onSwitchToAppearance?: () => void
}) {
  const hasPortrait = Boolean(state.staged.sourceImageUrl)
  const items = state.staged.motions
  const pendingForType = Array.from(jobs.pending.entries()).filter(([, m]) => m.assetType === "motions")
  const [currentModel, setCurrentModel] = useState<string>(DEFAULT_MOTION_PROVIDER)

  const handleGenerate = useCallback(
    async (text: string, _isPreset: boolean, model: string) => {
      if (!state.staged.sourceImageUrl) return
      let characterId: string
      try {
        characterId = await state.ensureSaved()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save character.")
        return
      }
      const { jobId } = await generateCharacterMotion({
        motionPrompt: text,
        sourceImageUrl: state.staged.sourceImageUrl,
        provider: model,
        name: state.staged.characterName,
        description: state.staged.description,
        gender: state.staged.gender,
        style: state.staged.style,
        baseOutfit: state.staged.baseOutfit,
        attachToCharacterId: characterId,
        attachName: text,
      })
      jobs.track(jobId, "motions", text)
    },
    [state, jobs],
  )

  const handleRegenerate = useCallback(
    async (idx: number, mode: "replace" | "add") => {
      if (!state.staged.sourceImageUrl) return
      const asset = items[idx]
      let characterId: string
      try {
        characterId = await state.ensureSaved()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save character.")
        return
      }
      if (mode === "replace") {
        state.patch({ motions: items.filter((_, i) => i !== idx) })
      }
      const trackName = mode === "replace" ? asset.name : `${asset.name} (v)`
      const { jobId } = await generateCharacterMotion({
        motionPrompt: asset.name,
        sourceImageUrl: state.staged.sourceImageUrl,
        provider: currentModel,
        name: state.staged.characterName,
        description: state.staged.description,
        gender: state.staged.gender,
        style: state.staged.style,
        baseOutfit: state.staged.baseOutfit,
        attachToCharacterId: characterId,
        attachName: trackName,
      })
      jobs.track(jobId, "motions", trackName)
    },
    [items, state, jobs, currentModel],
  )

  // Portrait-required gate (PR 2 Task 18). Motions has its own UI (no shared ImageAssetTab) so
  // the gate is duplicated here. The CTA replaces the entire tab body when the modal wires a
  // switch callback and the portrait is missing.
  if (!hasPortrait && onSwitchToAppearance) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-3 py-6 text-center">
        <div className="text-[11px] text-amber-300 mb-2">
          Generate a portrait first to enable asset generations.
        </div>
        <button
          type="button"
          onClick={onSwitchToAppearance}
          className="text-[10px] bg-[#3b82f6] text-white rounded px-3 py-1.5"
        >
          Open Appearance tab
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4.5 pt-3 pb-2 border-b border-[#1e293b] flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-200">Motions</div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Short video clips generated from the portrait (Kling / Wan i2v)
          </div>
        </div>
        <button
          onClick={() => {
            const url = window.prompt("Paste a video URL to import as a motion clip:")?.trim()
            if (url) state.patch({ motions: [...state.staged.motions, { name: "imported", url }] })
          }}
          className="text-[10px] bg-[#1e293b] rounded px-2.5 py-1 text-slate-400"
        >
          ↑ Import
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3.5">
        <div className="grid grid-cols-5 gap-2.5">
          {items.map((item, idx) => (
            <AssetCard
              key={`${item.url}-${idx}`}
              item={item}
              isVideo
              costModel={currentModel}
              onDelete={() => state.patch({ motions: items.filter((_, i) => i !== idx) })}
              onRegenerate={hasPortrait ? (mode) => handleRegenerate(idx, mode) : undefined}
              onRename={(newName) =>
                state.patch({ motions: items.map((it, i) => (i === idx ? { ...it, name: newName } : it)) })
              }
            />
          ))}
          {pendingForType.map(([jobId, m]) => (
            <PendingCard
              key={jobId}
              jobId={jobId}
              name={m.name}
              progress={m.progress}
              theme="motion"
              onCancel={jobs.cancel}
            />
          ))}
        </div>
      </div>
      <GenerationBar
        presets={MOTION_PRESETS}
        models={CHARACTER_MOTION_PROVIDERS}
        defaultModel={DEFAULT_MOTION_PROVIDER}
        disabled={!hasPortrait}
        disabledHint="Generate a portrait first."
        customPlaceholder='Custom motion: e.g. "walking confidently toward camera"'
        onGenerate={handleGenerate}
        onModelChange={setCurrentModel}
      />
    </div>
  )
}
