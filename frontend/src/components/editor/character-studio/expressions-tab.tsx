import { useCallback, useState } from "react"
import { toast } from "sonner"
import { generateCharacterAsset, modifyImage } from "@/lib/api"
import type { CharacterStudioState } from "./use-character-studio"
import type { CharacterStudioJobs } from "./use-character-studio-jobs"
import { AssetCard } from "./asset-card"
import { GenerationBar } from "./generation-bar"

// Curated top-tier image models for character work. Drop budget/older options — the studio is
// opinionated about quality and these all produce high-fidelity character output by default.
export const IMAGE_MODELS = ["nano-banana-pro", "nano-banana-2", "gpt-image-2", "seedream"] as const
export const DEFAULT_IMAGE_MODEL: (typeof IMAGE_MODELS)[number] = "nano-banana-pro"

const EXPRESSION_PRESETS = [
  "neutral",
  "smile",
  "angry",
  "surprised",
  "sad",
  "talking",
  "laughing",
  "disgusted",
  "fearful",
  "smirk",
  "crying",
] as const

// Reusable image-asset grid + generation bar. Used by Expressions, Poses, and (compactly) the
// Appearance tab's Angles + Lighting sub-sections. Hence assetType/arrayField span all 4 image types.
export type ImageAssetType = "expressions" | "poses" | "angles" | "lighting"
export type ImageArrayField = "expressions" | "poses" | "angles" | "lightingVariations"

// Map the frontend `arrayField` (CharacterNodeData camelCase) to the DB column
// the worker writes to. Only `lightingVariations` differs from its column name
// (`lighting_variations`); the others are 1:1.
const ARRAY_FIELD_TO_COLUMN: Record<ImageArrayField, "expressions" | "poses" | "angles" | "lighting_variations"> = {
  expressions: "expressions",
  poses: "poses",
  angles: "angles",
  lightingVariations: "lighting_variations",
}

export function ImageAssetTab({
  state,
  jobs,
  assetType,
  arrayField,
  presets,
  title,
  description,
  onImport,
}: {
  state: CharacterStudioState
  jobs: CharacterStudioJobs
  assetType: ImageAssetType
  arrayField: ImageArrayField
  presets: readonly string[]
  title: string
  description: string
  /** optional Import handler — opens the gallery picker; see Task 14 Step 1b */
  onImport?: () => void
}) {
  const items = (state.staged[arrayField] as { name: string; url: string }[]) ?? []
  const pendingForType = Array.from(jobs.pending.entries()).filter(([, m]) => m.assetType === assetType)
  // Track the currently-selected model so AssetCards and regen handlers use the same cost basis
  // as whatever the user picked in the GenerationBar.
  const [currentModel, setCurrentModel] = useState<string>(DEFAULT_IMAGE_MODEL)
  const presetSet = new Set(presets.map((p) => p.toLowerCase()))
  const attachToColumn = ARRAY_FIELD_TO_COLUMN[arrayField]

  const handleGenerate = useCallback(
    async (text: string, isPreset: boolean, model: string) => {
      // Lazy-create the character row on first generation so the worker has a
      // target for auto-attach. If the user hasn't given the character a name
      // yet, ensureSaved throws — surface as a toast and bail.
      let characterId: string
      try {
        characterId = await state.ensureSaved()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save character.")
        return
      }
      const attachName = isPreset ? text : text.substring(0, 100)
      const { jobId } = await generateCharacterAsset({
        assetType: isPreset ? assetType : "custom",
        variant: isPreset ? text : text.substring(0, 100),
        userPrompt: isPreset ? undefined : text,
        name: state.staged.characterName,
        description: state.staged.description,
        gender: state.staged.gender,
        style: state.staged.style,
        baseOutfit: state.staged.baseOutfit,
        sourceImageUrl: state.staged.sourceImageUrl || undefined,
        provider: model,
        attachToCharacterId: characterId,
        attachToColumn,
        attachName,
      })
      jobs.track(jobId, assetType, attachName)
    },
    [state, jobs, assetType, attachToColumn],
  )

  const handleGenerateAll = useCallback(async () => {
    const existing = new Set(items.map((i) => i.name.toLowerCase()))
    const missing = presets.filter((p) => !existing.has(p.toLowerCase()))
    if (missing.length >= 4 && !window.confirm(`This will generate ${missing.length} ${title.toLowerCase()}. Continue?`)) return
    for (const p of missing) {
      // fire sequentially so the credit guard isn't slammed; await the request, not the job
      await handleGenerate(p, true, currentModel)
    }
  }, [items, presets, handleGenerate, currentModel, title])

  const handleRefine = useCallback(
    async (idx: number, refinementPrompt: string, mode: "replace" | "add") => {
      const asset = items[idx]
      let characterId: string
      try {
        characterId = await state.ensureSaved()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save character.")
        return
      }
      const trackName = mode === "replace" ? asset.name : `${asset.name} (v)`
      if (mode === "replace") {
        // Remove the old card immediately; the worker auto-attach will land
        // the new image as a fresh entry on the row.
        state.patch({ [arrayField]: items.filter((_, i) => i !== idx) } as never)
      }
      const { jobId } = await modifyImage(
        asset.url,
        refinementPrompt,
        currentModel,
        undefined,
        state.staged.sourceImageUrl ? [state.staged.sourceImageUrl] : undefined,
        {
          attachToCharacterId: characterId,
          attachToColumn,
          attachName: trackName,
        },
      )
      jobs.track(jobId, assetType, trackName)
    },
    [items, state, jobs, assetType, arrayField, currentModel, attachToColumn],
  )

  const handleRegenerate = useCallback(
    async (idx: number, mode: "replace" | "add") => {
      const asset = items[idx]
      const isPreset = presetSet.has(asset.name.toLowerCase())
      let characterId: string
      try {
        characterId = await state.ensureSaved()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save character.")
        return
      }
      // "replace" deletes the old card immediately; the new generation lands as a fresh card on
      // completion. "add" leaves the old one in place and appends with a "(v)" suffix.
      if (mode === "replace") {
        state.patch({ [arrayField]: items.filter((_, i) => i !== idx) } as never)
      }
      const trackName = mode === "replace" ? asset.name : `${asset.name} (v)`
      const { jobId } = await generateCharacterAsset({
        assetType: isPreset ? assetType : "custom",
        variant: isPreset ? asset.name : asset.name.substring(0, 100),
        userPrompt: isPreset ? undefined : asset.name,
        name: state.staged.characterName,
        description: state.staged.description,
        gender: state.staged.gender,
        style: state.staged.style,
        baseOutfit: state.staged.baseOutfit,
        sourceImageUrl: state.staged.sourceImageUrl || undefined,
        provider: currentModel,
        attachToCharacterId: characterId,
        attachToColumn,
        attachName: trackName,
      })
      jobs.track(jobId, assetType, trackName)
    },
    [items, state, jobs, assetType, arrayField, currentModel, presetSet, attachToColumn],
  )

  const existingNames = new Set(items.map((i) => i.name.toLowerCase()))
  const missingCount = presets.filter((p) => !existingNames.has(p.toLowerCase())).length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4.5 pt-3 pb-2 border-b border-[#1e293b] flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-200">{title}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{description}</div>
        </div>
        {onImport && (
          <button onClick={onImport} className="text-[10px] bg-[#1e293b] rounded px-2.5 py-1 text-slate-400">
            ↑ Import
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3.5">
        <div className="grid grid-cols-5 gap-2.5">
          {items.map((item, idx) => (
            <AssetCard
              key={`${item.url}-${idx}`}
              item={item}
              costModel={currentModel}
              onDelete={() => state.patch({ [arrayField]: items.filter((_, i) => i !== idx) } as never)}
              onRefine={(p, mode) => handleRefine(idx, p, mode)}
              onRegenerate={(mode) => handleRegenerate(idx, mode)}
              onRename={(newName) =>
                state.patch({ [arrayField]: items.map((it, i) => (i === idx ? { ...it, name: newName } : it)) } as never)
              }
            />
          ))}
          {pendingForType.map(([jobId, m]) => (
            <div key={jobId} className="rounded-md overflow-hidden bg-[#1a1d27] border border-[#3b82f633]">
              <div className="aspect-[3/4] flex items-center justify-center bg-gradient-to-br from-[#1a2035] to-[#1e2845]">
                <div className="w-5 h-5 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
              </div>
              <div className="px-2 py-1.5 text-[10px] text-[#3b82f6] truncate">{m.name}…</div>
            </div>
          ))}
          <button
            className="rounded-md border border-dashed border-[#334155] aspect-[3/4] flex items-center justify-center text-slate-500 text-xl"
            onClick={() => {
              const p = window.prompt(`New ${title.toLowerCase()} prompt:`)
              if (p) handleGenerate(p, false, currentModel)
            }}
          >
            +
          </button>
        </div>
      </div>
      <GenerationBar
        presets={presets}
        models={IMAGE_MODELS}
        defaultModel={DEFAULT_IMAGE_MODEL}
        customPlaceholder={`Custom ${title.toLowerCase()}: e.g. "winking with a raised eyebrow, playful"`}
        onGenerate={handleGenerate}
        onGenerateAll={handleGenerateAll}
        generateAllCount={missingCount}
        onModelChange={setCurrentModel}
      />
    </div>
  )
}

export function ExpressionsTab({ state, jobs }: { state: CharacterStudioState; jobs: CharacterStudioJobs }) {
  return (
    <ImageAssetTab
      state={state}
      jobs={jobs}
      assetType="expressions"
      arrayField="expressions"
      presets={EXPRESSION_PRESETS}
      title="Expressions"
      description="Emotion and facial expression reference images"
      onImport={() => {
        const url = window.prompt("Paste an image URL to import as an expression:")?.trim()
        if (url) state.patch({ expressions: [...state.staged.expressions, { name: "imported", url }] })
      }}
    />
  )
}
