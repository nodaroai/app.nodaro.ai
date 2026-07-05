import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { MATERIALS, MATERIAL_CATEGORY_LABELS, MATERIAL_CATEGORY_ORDER, getMaterialLabel, getMaterialPromptHint, resolveEntityAspect, aspectRatioToNumber, type MaterialCategory } from "@nodaro/shared"
import { generateObjectAsset, removeObjectAsset } from "@/lib/api"
import { MultiImageLightbox } from "@/components/ui/multi-image-lightbox"
import { useObjectStudioJobs } from "./use-object-studio-jobs"
import { PresetChips } from "../studio-shell/preset-chips"
import { lowerNameSet } from "../studio-shell/preset-state"
import { StudioAssetMedia } from "../studio-shell/studio-asset-media"
import type { ObjectStudioState } from "./use-object-studio"
import type { ObjectAssetItem, ObjectNodeData } from "@/types/nodes"

/**
 * Shared workhorse for the 3 object image-asset tabs — Angles, Materials,
 * Variations. Each thin wrapper (see `angles-tab.tsx` etc.) imports this
 * component and passes the bucket name, preset list, and label.
 *
 * Mirrors the location-studio precedent (`environmental-asset-tab.tsx`)
 * with location -> object substitution. Object-specific deltas:
 *  - 3 tabKind values (angles/materials/variations), NOT location's 5.
 *  - Materials tab includes a UNIQUE "Browse Material catalog" affordance
 *    (no location equivalent) — see `MaterialCatalogBrowser` below. Picking
 *    a material fires `generateObjectAsset({ variant: "custom",
 *    userPrompt: label, seedPromptHint: hint })` per the route's Zod
 *    schema (which accepts "custom" + a free-form userPrompt).
 *  - attachToColumn matches the DB column name (snake_case for motion_clips,
 *    but angles/materials/variations match the bucket name as-is).
 *
 * Auto-attach: when `attachToObjectId` + `attachToColumn` + `attachName`
 * are all set, the worker appends the produced asset onto the object row's
 * JSONB column via `append_object_asset` RPC at job-completion time.
 *
 * Save-before-gen: `studio.ensureSavedBeforeGen()` is awaited BEFORE the
 * `generateObjectAsset` call so we never enqueue a job whose
 * `attachToObjectId` is empty.
 */
export type ObjectAssetBucket = "angles" | "materials" | "variations"

const BUCKET_TO_COLUMN: Record<ObjectAssetBucket, "angles" | "materials" | "variations"> = {
  angles: "angles",
  materials: "materials",
  variations: "variations",
}

const BUCKET_LABEL: Record<ObjectAssetBucket, string> = {
  angles: "angles",
  materials: "materials",
  variations: "variations",
}

interface ObjectAssetTabProps {
  readonly studio: ObjectStudioState
  readonly tabKind: ObjectAssetBucket
  readonly presets: readonly string[]
  readonly iconLabel: string
}

export function ObjectAssetTab({
  studio,
  tabKind,
  presets,
  iconLabel,
}: ObjectAssetTabProps) {
  const data = studio.stagedData
  const [customPrompt, setCustomPrompt] = useState("")
  // Fullscreen viewer: click an asset to open; ←/→ navigate, Esc closes.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const jobs = useObjectStudioJobs([])

  useEffect(() => {
    jobs.onFailed((jobId) => {
      toast.error(`Generation ${jobId.slice(0, 8)}… failed`)
    })
  }, [jobs.onFailed])

  if (!data) return null

  const items: ReadonlyArray<ObjectAssetItem> =
    ((data as unknown as Record<ObjectAssetBucket, ObjectAssetItem[] | undefined>)[
      tabKind
    ] ?? []) as ReadonlyArray<ObjectAssetItem>

  const disabled = studio.isApprovingMainImage

  // Card fallback container ratio (until the real media aspect is probed).
  // Drawn from the single entity-aspect table so the placeholder framing
  // matches what's requested at generation time (angles/materials/variations
  // are 1:1).
  const fallbackAspect = aspectRatioToNumber(
    resolveEntityAspect({ entity: "object", assetType: tabKind }),
  )

  async function fireGen(variant: string, isCustom: boolean, seedPromptHint?: string): Promise<void> {
    if (!data) return
    const trimmedVariant = isCustom ? variant.slice(0, 100) : variant
    // Optimistic "Generating…" card the instant the user clicks — before the
    // save + generate round-trips. settleJob swaps it for the real job;
    // abortJob drops it on any failure.
    const tempId = jobs.beginJob(tabKind, trimmedVariant)
    try {
      const objectDbId = await studio.ensureSavedBeforeGen()
      const result = await generateObjectAsset({
        assetType: isCustom ? "custom" : tabKind,
        variant: trimmedVariant,
        userPrompt: isCustom ? variant : undefined,
        name: data.objectName || "Object",
        description: data.description || undefined,
        category: data.category,
        style: data.style,
        // Per the location precedent: pass main image as source only when
        // style-lock is on (worker uses it to anchor variants to approved
        // look). When style-lock is off, fall back to text-only generation —
        // send `undefined`, NOT "" (the backend `safeUrlSchema.optional()`
        // rejects an empty string with a 400 before the handler's fallback runs;
        // location + creature already pass undefined).
        sourceImageUrl: data.styleLock && data.sourceImageUrl ? data.sourceImageUrl : undefined,
        attachToObjectId: objectDbId,
        attachToColumn: BUCKET_TO_COLUMN[tabKind],
        attachName: trimmedVariant,
        ...(seedPromptHint ? { seedPromptHint } : {}),
      })
      jobs.settleJob(tempId, result.jobId)
    } catch (e) {
      jobs.abortJob(tempId)
      // Surface the failure. `generateObjectAsset` / `ensureSavedBeforeGen`
      // throw but do NOT toast (apiJson only throws), so without this the
      // "Generating…" card just vanished with no explanation — e.g. out of
      // credits, or a rejected variant. Mirrors the location precedent.
      toast.error(e instanceof Error ? e.message : "Generation failed — try again.")
    }
  }

  async function handlePresetClick(variant: string): Promise<void> {
    if (disabled) return
    await fireGen(variant, false)
  }

  async function handleGenerateAll(): Promise<void> {
    if (disabled) return
    const existingNames = new Set(items.map((i) => i.name.toLowerCase()))
    const missing = presets.filter((p) => !existingNames.has(p.toLowerCase()))
    if (missing.length === 0) {
      toast.info("All presets already generated")
      return
    }
    if (missing.length >= 4) {
      if (!window.confirm(`This will queue ${missing.length} generation jobs.`)) return
    }
    for (const variant of missing) {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential
      await fireGen(variant, false)
    }
  }

  async function handleCustom(): Promise<void> {
    if (disabled) return
    const trimmed = customPrompt.trim()
    if (!trimmed) return
    if (trimmed.length > 2000) {
      toast.error("Custom prompt is too long (max 2000 chars)")
      return
    }
    await fireGen(trimmed, true)
    setCustomPrompt("")
  }

  async function handleRemove(idx: number): Promise<void> {
    const target = items[idx]
    const next = items.filter((_, i) => i !== idx)
    // Optimistic local patch (snappy UX), then persist via the remove-asset
    // route — the studio's UPDATE excludes worker-owned bucket columns, so a
    // local-only delete reappears on reopen.
    studio.patch({ [tabKind]: next } as Partial<ObjectNodeData>)
    const id = studio.stagedData?.objectDbId
    if (id && target) {
      try {
        await removeObjectAsset(id, { column: BUCKET_TO_COLUMN[tabKind], url: target.url })
      } catch {
        toast.error("Failed to delete asset — refresh to restore")
      }
    }
  }

  // Material-catalog browser pick handler. Only used when tabKind === "materials".
  async function handleMaterialPick(materialId: string): Promise<void> {
    if (disabled || !data) return
    const label = getMaterialLabel(materialId)
    const hint = getMaterialPromptHint(materialId)
    await fireGen(label, true, hint || undefined)
  }

  const trackedForBucket = jobs.tracked.filter((j) => j.assetType === tabKind)
  // Chip states: "created" once an asset of that name exists, "creating" while
  // a job (real or optimistic) is in flight.
  const createdNames = lowerNameSet(items)
  const busyNames = lowerNameSet(trackedForBucket)
  const customDisabled = disabled || !customPrompt.trim()

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-[12px] font-medium text-slate-300">{iconLabel}</h2>
        <button
          type="button"
          onClick={handleGenerateAll}
          disabled={disabled}
          className="px-3 py-1 text-[11px] rounded bg-[#1a1d27] hover:bg-[#1e293b] border border-[#1e293b] text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Generate All
        </button>
      </div>

      {/* Asset grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {items.map((item, idx) => (
          <div
            key={`${item.url}-${idx}`}
            onClick={() => setLightboxIndex(idx)}
            className="relative group border border-[#1e293b] rounded overflow-hidden bg-[#0e1117] cursor-zoom-in"
          >
            <StudioAssetMedia
              url={item.url}
              alt={item.name}
              fallbackAspect={fallbackAspect}
              className="w-full rounded"
            />
            <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] px-1.5 py-0.5">
              {item.name}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void handleRemove(idx)
              }}
              aria-label={`Remove ${item.name}`}
              className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-black/80"
            >
              Remove
            </button>
          </div>
        ))}
        {trackedForBucket.map((j) => (
          <div
            key={j.jobId}
            className="aspect-square border border-[#1e293b] rounded bg-[#0e1117] flex flex-col items-center justify-center gap-2 text-[11px] text-slate-400"
          >
            <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
            <span className="truncate max-w-full px-2">Generating {j.name}…</span>
          </div>
        ))}
        {items.length === 0 && trackedForBucket.length === 0 && (
          <div className="col-span-full text-center text-[11px] text-slate-500 py-8 border border-dashed border-[#1e293b] rounded">
            No {BUCKET_LABEL[tabKind]} variants yet — pick a preset below or enter a custom prompt.
          </div>
        )}
      </div>

      {/* Preset chips */}
      <PresetChips
        presets={presets}
        createdNames={createdNames}
        busyNames={busyNames}
        disabled={disabled}
        onPick={(p) => void handlePresetClick(p)}
      />

      {/* Custom prompt */}
      <div className="flex gap-2">
        <input
          type="text"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Custom prompt (free-form)"
          disabled={disabled}
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
          className="px-4 py-2 text-[12px] rounded bg-[#ff0073] hover:bg-[#ff0073]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
        >
          Generate
        </button>
      </div>

      {/* Material catalog browser — UNIQUE to the Materials tab. No location
          equivalent. Renders the @nodaro/shared MATERIALS catalog grouped by
          MaterialCategory. Picking fires generateObjectAsset with
          variant="custom" + userPrompt=label + seedPromptHint=catalog hint. */}
      {tabKind === "materials" && (
        <MaterialCatalogBrowser disabled={disabled} onPick={handleMaterialPick} />
      )}

      <MultiImageLightbox
        items={items.map((i) => ({ url: i.url, alt: i.name }))}
        startIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Material catalog browser — sub-component. UNIQUE Materials-tab affordance.
// ---------------------------------------------------------------------------

interface MaterialCatalogBrowserProps {
  readonly disabled: boolean
  readonly onPick: (materialId: string) => void | Promise<void>
}

export function MaterialCatalogBrowser({ disabled, onPick }: MaterialCatalogBrowserProps) {
  // Pre-bucket the catalog by category once so the render path doesn't
  // iterate the full list per category section.
  const byCategory = useMemo(() => {
    const map = new Map<MaterialCategory, typeof MATERIALS[number][]>()
    for (const m of MATERIALS) {
      const arr = map.get(m.category) ?? []
      arr.push(m)
      map.set(m.category, arr)
    }
    return map
  }, [])

  return (
    <div
      data-testid="material-catalog-browser"
      className="space-y-3 mt-2 pt-3 border-t border-[#1e293b]"
    >
      <h3 className="text-[11px] font-medium text-slate-300">
        Browse Material catalog
      </h3>
      <p className="text-[10px] text-slate-500">
        Pick a material to generate a variant. Each pick fires a custom-prompt
        generation seeded with the catalog's prompt hint.
      </p>
      {MATERIAL_CATEGORY_ORDER.map((category) => {
        const entries = byCategory.get(category) ?? []
        if (entries.length === 0) return null
        return (
          <div key={category}>
            <div className="text-[9px] uppercase tracking-widest text-slate-600 mb-1.5">
              {MATERIAL_CATEGORY_LABELS[category]}
            </div>
            <div className="flex flex-wrap gap-2">
              {entries.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    void onPick(m.id)
                  }}
                  disabled={disabled}
                  title={m.description}
                  className="px-2.5 py-1 text-[11px] rounded bg-[#1a1d27] hover:bg-[#1e293b] border border-[#1e293b] text-slate-300 transition-transform active:scale-95 disabled:active:scale-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
