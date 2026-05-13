import { useCallback } from "react"
import { CHARACTER_MOTION_PROVIDERS } from "@nodaro/shared"
import { generateCharacterMotion } from "@/lib/api"
import type { CharacterStudioState } from "./use-character-studio"
import type { CharacterStudioJobs } from "./use-character-studio-jobs"
import { AssetCard } from "./asset-card"
import { GenerationBar } from "./generation-bar"

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
export function MotionsTab({ state, jobs }: { state: CharacterStudioState; jobs: CharacterStudioJobs }) {
  const hasPortrait = Boolean(state.staged.sourceImageUrl)
  const items = state.staged.motions
  const pendingForType = Array.from(jobs.pending.entries()).filter(([, m]) => m.assetType === "motions")

  const handleGenerate = useCallback(
    async (text: string, _isPreset: boolean, model: string) => {
      if (!state.staged.sourceImageUrl) return
      const { jobId } = await generateCharacterMotion({
        motionPrompt: text,
        sourceImageUrl: state.staged.sourceImageUrl,
        provider: model,
        name: state.staged.characterName,
        description: state.staged.description,
        gender: state.staged.gender,
        style: state.staged.style,
        baseOutfit: state.staged.baseOutfit,
      })
      jobs.track(jobId, "motions", text)
    },
    [state, jobs],
  )

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
        {!hasPortrait && (
          <div className="text-[11px] text-slate-500 mb-3">Generate a portrait in the Appearance tab first.</div>
        )}
        <div className="grid grid-cols-5 gap-2.5">
          {items.map((item, idx) => (
            <AssetCard
              key={`${item.url}-${idx}`}
              item={item}
              isVideo
              onDelete={() => state.patch({ motions: items.filter((_, i) => i !== idx) })}
              onRename={(newName) =>
                state.patch({ motions: items.map((it, i) => (i === idx ? { ...it, name: newName } : it)) })
              }
            />
          ))}
          {pendingForType.map(([jobId, m]) => (
            <div key={jobId} className="rounded-md overflow-hidden bg-[#1a1d27] border border-[#f59e0b33]">
              <div className="aspect-[3/4] flex items-center justify-center bg-gradient-to-br from-[#241e10] to-[#2a2410]">
                <div className="w-5 h-5 border-2 border-[#f59e0b] border-t-transparent rounded-full animate-spin" />
              </div>
              <div className="px-2 py-1.5 text-[10px] text-[#f59e0b] truncate">{m.name}…</div>
            </div>
          ))}
        </div>
      </div>
      <GenerationBar
        presets={MOTION_PRESETS}
        models={CHARACTER_MOTION_PROVIDERS}
        defaultModel="kling"
        disabled={!hasPortrait}
        disabledHint="Generate a portrait first."
        customPlaceholder='Custom motion: e.g. "walking confidently toward camera"'
        onGenerate={handleGenerate}
      />
    </div>
  )
}
