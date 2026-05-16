import { useCallback, useState } from "react"
import { toast } from "sonner"
import { generateCharacterAsset, modifyImage } from "@/lib/api"
import type { CharacterStudioState } from "./use-character-studio"
import type { CharacterStudioJobs, StudioAssetType } from "./use-character-studio-jobs"
import { AssetCard } from "./asset-card"
import { AssetGenPanel, type AssetGenSubmission } from "./asset-gen-panel"
import { GenerationBar } from "./generation-bar"
import { PendingCard } from "./pending-card"
import { PerVariantRealLifeRefsDrawer } from "./per-variant-refs-drawer"
import { MultiImageLightbox } from "@/components/ui/multi-image-lightbox"
import { injectAssetAsCanvasNode, setCharacterNodeDefaultAsset } from "./inject-helpers"

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
// Appearance tab's Head/Body Angles + Lighting sub-sections. The angles surface was split
// into head + body in migration 118 — `headAngles` writes to the legacy `angles` column
// (now semantically head-and-shoulders) and `bodyAngles` writes to the new `body_angles`
// column with full-body T-pose framing.
export type ImageAssetType =
  | "expressions"
  | "poses"
  | "angles"        // legacy alias (still accepted by the backend route)
  | "headAngles"
  | "bodyAngles"
  | "lighting"
export type ImageArrayField =
  | "expressions"
  | "poses"
  | "angles"
  | "bodyAngles"
  | "lightingVariations"

// Map the frontend `arrayField` (CharacterNodeData camelCase) to the DB column
// the worker writes to. Most are 1:1; `lightingVariations` → `lighting_variations`
// and `bodyAngles` → `body_angles` are the snake_case exceptions.
const ARRAY_FIELD_TO_COLUMN: Record<
  ImageArrayField,
  "expressions" | "poses" | "angles" | "body_angles" | "lighting_variations"
> = {
  expressions: "expressions",
  poses: "poses",
  angles: "angles",
  bodyAngles: "body_angles",
  lightingVariations: "lighting_variations",
}

// Map `arrayField` → `StudioAssetType` for jobs.track. The studio uses the
// arrayField as the canonical "where does this asset live" identity, so the
// tracking type follows that. (The route's prompt-shaping `assetType` is a
// separate concept — see ImageAssetType above.)
const ARRAY_FIELD_TO_TRACKING_TYPE: Record<ImageArrayField, StudioAssetType> = {
  expressions: "expressions",
  poses: "poses",
  angles: "angles",
  bodyAngles: "bodyAngles",
  lightingVariations: "lighting",
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
  onSwitchToAppearance,
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
  /** When provided, the tab gates generation on `sourceImageUrl` and offers a CTA to switch back
   *  to the Appearance tab. Omitted by the Angles + Lighting embeds inside Appearance — those are
   *  already on the Appearance tab and don't need the gate. See PR 2 Task 18. */
  onSwitchToAppearance?: () => void
}) {
  const items = (state.staged[arrayField] as { name: string; url: string }[]) ?? []
  const trackingAssetType = ARRAY_FIELD_TO_TRACKING_TYPE[arrayField]
  const pendingForType = Array.from(jobs.pending.entries()).filter(([, m]) => m.assetType === trackingAssetType)
  // Track the currently-selected model so AssetCards and regen handlers use the same cost basis
  // as whatever the user picked in the GenerationBar.
  const [currentModel, setCurrentModel] = useState<string>(DEFAULT_IMAGE_MODEL)
  // Fullscreen-lightbox index. Null = closed. The arrows on the lightbox cycle
  // through THIS tab's items, so each tab opens an isolated viewer (you don't
  // accidentally arrow from an expression into a pose).
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  // Identity Foundation v2: AssetGenPanel for "Custom prompt" path + per-variant
  // real-life refs drawer. Both are tab-local UI toggles; the actual state
  // (`realLifeRefsByVariant`) lives on the staged character data so it persists
  // across renders and saves.
  const [genPanelOpen, setGenPanelOpen] = useState(false)
  const [refsDrawerOpen, setRefsDrawerOpen] = useState(false)
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
        // Forward the character node's 4-pill toggle so the backend's
        // per-asset-type default can be overridden when the user has picked
        // a different ratio on the canvas.
        characterNodeAspectRatio: state.staged.defaultAssetAspectRatio,
      })
      jobs.track(jobId, trackingAssetType, attachName)
    },
    [state, jobs, assetType, attachToColumn, trackingAssetType],
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
      jobs.track(jobId, trackingAssetType, trackName)
    },
    [items, state, jobs, assetType, arrayField, currentModel, attachToColumn, trackingAssetType],
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
        characterNodeAspectRatio: state.staged.defaultAssetAspectRatio,
      })
      jobs.track(jobId, trackingAssetType, trackName)
    },
    [items, state, jobs, assetType, arrayField, currentModel, presetSet, attachToColumn, trackingAssetType],
  )

  // Custom-prompt generation path (Identity Foundation v2). Routes through
  // generateCharacterAsset with assetType:"custom" so the route uses
  // submission.userPrompt as the variant prompt, plus the optional per-asset
  // `description` and `realLifeRefs` from the AssetGenPanel.
  const fireCustomGen = useCallback(
    async (submission: AssetGenSubmission) => {
      let characterId: string
      try {
        characterId = await state.ensureSaved()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save character.")
        return
      }
      const variant = submission.userPrompt.slice(0, 100) || "custom"
      try {
        const { jobId } = await generateCharacterAsset({
          assetType: "custom",
          variant,
          userPrompt: submission.userPrompt,
          name: state.staged.characterName,
          // Per-asset description from the panel overrides the character-level
          // description for THIS generation only. When empty the backend will
          // ask Claude Sonnet for a draft scoped to the canonical description.
          description: submission.description || state.staged.description,
          gender: state.staged.gender,
          style: state.staged.style,
          baseOutfit: state.staged.baseOutfit,
          sourceImageUrl: state.staged.sourceImageUrl || undefined,
          provider: currentModel,
          attachToCharacterId: characterId,
          attachToColumn,
          attachName: variant,
          realLifeRefs: submission.realLifeRefs,
          characterNodeAspectRatio: state.staged.defaultAssetAspectRatio,
        })
        jobs.track(jobId, trackingAssetType, variant)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Generation failed.")
      }
    },
    [state, jobs, assetType, currentModel, attachToColumn, trackingAssetType],
  )

  const existingNames = new Set(items.map((i) => i.name.toLowerCase()))
  const missingCount = presets.filter((p) => !existingNames.has(p.toLowerCase())).length

  // Portrait-required gate (PR 2 Task 18). Only applies when the parent has wired a switch
  // callback — the Angles + Lighting embeds inside the Appearance tab omit it so they keep
  // working without a portrait (they're contextually part of the Appearance flow).
  if (!state.staged.sourceImageUrl && onSwitchToAppearance) {
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
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <div className="px-4.5 pt-3 pb-2 border-b border-[#1e293b] flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-200">{title}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{description}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setGenPanelOpen(true)}
            className="text-[10px] bg-[#1e293b] rounded px-2.5 py-1 text-slate-300"
          >
            Custom prompt
          </button>
          <button
            type="button"
            onClick={() => setRefsDrawerOpen(true)}
            className="text-[10px] bg-[#1e293b] rounded px-2.5 py-1 text-slate-300"
          >
            Real-life refs
          </button>
          {onImport && (
            <button onClick={onImport} className="text-[10px] bg-[#1e293b] rounded px-2.5 py-1 text-slate-400">
              ↑ Import
            </button>
          )}
        </div>
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
              onEnlarge={() => setLightboxIndex(idx)}
              onInjectToCanvas={() =>
                injectAssetAsCanvasNode({ sourceCharacterNodeId: state.nodeId, item, isVideo: false })
              }
              onSetAsDefault={() => setCharacterNodeDefaultAsset(state.staged, state.patch, item)}
              isDefault={state.staged.defaultAssetUrl === item.url}
              onRename={(newName) =>
                state.patch({ [arrayField]: items.map((it, i) => (i === idx ? { ...it, name: newName } : it)) } as never)
              }
            />
          ))}
          {pendingForType.map(([jobId, m]) => (
            <PendingCard
              key={jobId}
              jobId={jobId}
              name={m.name}
              progress={m.progress}
              theme="image"
              onCancel={jobs.cancel}
            />
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
      <MultiImageLightbox
        items={items.map((it) => ({ url: it.url, alt: it.name }))}
        startIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
      <AssetGenPanel
        open={genPanelOpen}
        onClose={() => setGenPanelOpen(false)}
        onGenerate={(submission) => {
          setGenPanelOpen(false)
          void fireCustomGen(submission)
        }}
        assetType={assetType}
        characterId={state.staged.characterDbId ?? ""}
        canonicalDescription={state.staged.canonicalDescription}
      />
      <PerVariantRealLifeRefsDrawer
        open={refsDrawerOpen}
        onClose={() => setRefsDrawerOpen(false)}
        title={`Real-life refs · ${title}`}
        variants={presets}
        refsByVariant={state.staged.realLifeRefsByVariant ?? {}}
        onChange={(next) => state.patch({ realLifeRefsByVariant: next })}
      />
    </div>
  )
}

export function ExpressionsTab({
  state,
  jobs,
  onSwitchToAppearance,
}: {
  state: CharacterStudioState
  jobs: CharacterStudioJobs
  onSwitchToAppearance?: () => void
}) {
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
      onSwitchToAppearance={onSwitchToAppearance}
    />
  )
}
