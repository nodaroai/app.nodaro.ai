import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  LOCATION_BUCKET_TO_CATALOG_ID,
  LOCATION_PRESET_TO_CATALOG,
} from "@nodaro/shared"
import { generateLocationAsset } from "@/lib/api"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { useLocationStudioJobs } from "./use-location-studio-jobs"
import type { LocationStudioState } from "./use-location-studio"
import type { LocationAssetItem, LocationNodeData } from "@/types/nodes"

/**
 * Shared workhorse for the 5 environmental asset tabs — Time of Day, Weather,
 * Seasons, Angles, Lighting. Each thin wrapper (see `time-of-day-tab.tsx` etc.)
 * imports this component and passes the bucket name, preset list, asset-type
 * enum value, and label.
 *
 * Layout (matches PR-1 Appearance tab conventions):
 *  - Header row: title + "Generate All" button.
 *  - Asset grid: existing items (with hover ✕ remove) followed by in-flight
 *    placeholder cards from `useLocationStudioJobs.tracked` filtered to this
 *    bucket. Empty-state copy when both are zero.
 *  - Preset chip row: clickable buttons that fire `generateLocationAsset` with
 *    the configured `bucketName` (used as both the route's `assetType` and
 *  - Custom prompt input: free-form text that fires `assetType: "custom"`
 *    with the typed text as both `variant` and `userPrompt` (the route's
 *    `buildVariantPrompt` prefers `userPrompt` for the custom path so the
 *    long-form user description wins over the short variant literal).
 *
 * Auto-attach: when `attachToLocationId` + `attachToColumn` + `attachName`
 * are all set, the worker appends the produced asset onto the location row's
 * JSONB column via `append_location_asset` RPC at job-completion time. The
 * frontend doesn't need to manually patch `stagedData.<bucket>` — the studio
 * refresh path on next open / next save round-trip will pull the new entry
 * from the canonical row. The in-flight placeholder gives the user a visual
 * acknowledgment until that round-trip completes.
 *
 * Save-before-gen (Q-8): `studio.ensureSavedBeforeGen()` is awaited BEFORE
 * the `generateLocationAsset` call so we never enqueue a job whose
 * `attachToLocationId` is empty — the worker would silently skip the attach
 * step in that case, the asset would land in R2 but never appear on the row.
 */
export type LocationEnvironmentalBucket =
  | "timeOfDay"
  | "weather"
  | "seasons"
  | "angles"
  | "lighting"

export type LocationEnvironmentalColumn =
  | "time_of_day"
  | "weather"
  | "seasons"
  | "angles"
  | "lighting"

const BUCKET_TO_COLUMN: Record<LocationEnvironmentalBucket, LocationEnvironmentalColumn> = {
  timeOfDay: "time_of_day",
  weather: "weather",
  seasons: "seasons",
  angles: "angles",
  lighting: "lighting",
}

const BUCKET_LABEL: Record<LocationEnvironmentalBucket, string> = {
  timeOfDay: "time of day",
  weather: "weather",
  seasons: "seasons",
  angles: "angles",
  lighting: "lighting",
}

interface EnvironmentalAssetTabProps {
  readonly studio: LocationStudioState
  readonly bucketName: LocationEnvironmentalBucket
  readonly presets: readonly string[]
  readonly iconLabel: string
}

export function EnvironmentalAssetTab({
  studio,
  bucketName,
  presets,
  iconLabel,
}: EnvironmentalAssetTabProps) {
  const data = studio.stagedData
  const [customPrompt, setCustomPrompt] = useState("")
  const jobs = useLocationStudioJobs([])
  // Localized labels for preset chips. The English preset string is still the
  // load-bearing value (sent as `variant` / `attachName` to the API + stored
  // in the locations row). Localization only affects what we RENDER. Each
  // location-studio bucket maps to ONE canonical picker catalog
  // (lighting / atmosphere / framing / seasons) so the location studio
  // reuses the same translations that the camera-motion / framing / lighting
  // picker nodes already ship — no parallel `location-variants` catalog.
  const catalogId = LOCATION_BUCKET_TO_CATALOG_ID[bucketName]
  const { resolveLabel } = useLocalizedCatalog(catalogId)

  // The worker appends the asset to the location row's bucket via
  // `append_location_asset` — nothing to patch here. The tracked placeholder
  // drops on resolve; on next modal save/reopen the canonical row refreshes.
  // Only the failure toast is wired so users see if a chip click no-ops.
  useEffect(() => {
    jobs.onFailed((jobId) => {
      toast.error(`Generation ${jobId.slice(0, 8)}… failed`)
    })
  }, [jobs.onFailed])

  if (!data) return null

  const items: ReadonlyArray<LocationAssetItem> =
    ((data as unknown as Record<LocationEnvironmentalBucket, LocationAssetItem[] | undefined>)[
      bucketName
    ] ?? []) as ReadonlyArray<LocationAssetItem>

  const disabled = studio.isApprovingMainImage

  async function fireGen(variant: string, isCustom: boolean): Promise<void> {
    if (!data) return
    try {
      const locationDbId = await studio.ensureSavedBeforeGen()
      const trimmedVariant = isCustom ? variant.slice(0, 100) : variant
      const result = await generateLocationAsset({
        assetType: isCustom ? "custom" : bucketName,
        variant: trimmedVariant,
        userPrompt: isCustom ? variant : undefined,
        name: data.locationName || "Location",
        category: data.category,
        style: data.style,
        // Pass main image as the source only when the user has style-lock on —
        // the worker uses it to anchor the variant to the approved look. When
        // style-lock is off, the worker falls back to text-only generation.
        sourceImageUrl: data.styleLock && data.sourceImageUrl ? data.sourceImageUrl : undefined,
        attachToLocationId: locationDbId,
        attachToColumn: BUCKET_TO_COLUMN[bucketName],
        attachName: trimmedVariant,
      })
      jobs.trackJob({ jobId: result.jobId, assetType: bucketName, name: trimmedVariant })
    } catch {
      // ensureSavedBeforeGen / generateLocationAsset already toast on failure.
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
      // Sequential so we don't blast N parallel POSTs at once. The orchestrator
      // / worker happily parallelizes downstream; the throttle here is just
      // about giving the credit reservation path a moment to settle.
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

  function handleRemove(idx: number): void {
    const next = items.filter((_, i) => i !== idx)
    // Mutate just this bucket on the staged data. Cast through Partial so
    // TypeScript accepts the dynamic key — every bucket name in the registry
    // maps to a LocationAssetItem[] on LocationNodeData.
    studio.patch({ [bucketName]: next } as Partial<LocationNodeData>)
  }

  // Phase 2 #10 — Bulk asset operations. The Set tracks selected items by
  // their ORIGINAL index in the unfiltered `items` array so search filtering
  // doesn't desync the selection. Multi-select shows a checkbox overlay on
  // every card (always visible, not just on hover) once at least one card
  // is selected; the floating action bar at the top of the grid offers
  // "Delete N" + "Cancel". `mark-favorite` and `export-zip` are deferred —
  // delete-all is the most-asked-for action.
  const [selectedIdx, setSelectedIdx] = useState<ReadonlySet<number>>(new Set())
  const isSelectionMode = selectedIdx.size > 0

  function toggleSelected(idx: number) {
    setSelectedIdx((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  function clearSelection() {
    setSelectedIdx(new Set())
  }

  function handleBulkDelete() {
    if (selectedIdx.size === 0) return
    const remaining = items.filter((_, i) => !selectedIdx.has(i))
    studio.patch({ [bucketName]: remaining } as Partial<LocationNodeData>)
    clearSelection()
  }

  const trackedForBucket = jobs.tracked.filter((j) => j.assetType === bucketName)
  const customDisabled = disabled || !customPrompt.trim()

  // Phase 2 #11 — Search/filter. Show the input only when the combined count
  // (items + tracked placeholders + presets) exceeds a small threshold so we
  // don't clutter sparse grids. The query filters items by `item.name`,
  // tracked placeholders by `j.name`, and preset chips by BOTH the raw preset
  // literal AND the resolved localized label (so a French user typing
  // "néon" still finds the canonical "neon" preset chip).
  const [searchQuery, setSearchQuery] = useState("")
  const q = searchQuery.trim().toLowerCase()
  const visibleItems = q
    ? items.filter((i) => i.name.toLowerCase().includes(q))
    : items
  const visiblePresets = q
    ? presets.filter((p) => {
        const label = resolveLabel(LOCATION_PRESET_TO_CATALOG[p]?.entryId ?? p, p)
        return p.toLowerCase().includes(q) || label.toLowerCase().includes(q)
      })
    : presets
  const visibleTracked = q
    ? trackedForBucket.filter((j) => j.name.toLowerCase().includes(q))
    : trackedForBucket
  const totalCount = items.length + trackedForBucket.length + presets.length
  const showSearch = totalCount > 10
  const zeroResults =
    q.length > 0 &&
    visibleItems.length === 0 &&
    visibleTracked.length === 0 &&
    visiblePresets.length === 0

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

      {showSearch && (
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${BUCKET_LABEL[bucketName]}…`}
            aria-label={`Search ${BUCKET_LABEL[bucketName]}`}
            className="flex-1 px-3 py-1.5 text-[11px] bg-[#1a1d27] border border-[#1e293b] rounded text-slate-200 placeholder:text-slate-600"
          />
          {q && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-[11px] text-slate-400 hover:text-slate-200"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Phase 2 #10 — Bulk action bar. Appears only when at least one card
          is selected. The Delete button is destructive, so it gets the same
          rose treatment as other destructive UI in the editor. */}
      {isSelectionMode && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-[#1a1d27] border border-[#1e293b] text-[11px] text-slate-300"
        >
          <span>
            {selectedIdx.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearSelection}
              className="px-2 py-1 rounded text-slate-400 hover:bg-[#1e293b] hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-medium"
            >
              Delete {selectedIdx.size}
            </button>
          </div>
        </div>
      )}

      {/* Asset grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {visibleItems.map((item) => {
          // We need the index from the ORIGINAL items array so handleRemove
          // patches the correct entry — filtering changes positional indices.
          const originalIdx = items.indexOf(item)
          const isSelected = selectedIdx.has(originalIdx)
          return (
            <div
              key={`${item.url}-${originalIdx}`}
              onClick={(e) => {
                // In selection mode, clicking anywhere on the card toggles
                // selection. Outside selection mode the card is purely a
                // viewer; we don't want a single click to start selection
                // (use the checkbox in the corner for that).
                if (isSelectionMode) {
                  e.preventDefault()
                  toggleSelected(originalIdx)
                }
              }}
              className={
                "relative group aspect-video border rounded overflow-hidden bg-[#0e1117] "
                + (isSelected
                  ? "border-[#22d3ee] ring-2 ring-[#22d3ee] cursor-pointer"
                  : "border-[#1e293b] " + (isSelectionMode ? "cursor-pointer" : ""))
              }
            >
              <img
                src={item.url}
                alt={item.name}
                loading="lazy"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] px-1.5 py-0.5">
                {item.name}
              </div>
              {/* Phase 2 #10 — selection checkbox. Always visible when at
                  least one card is already selected; otherwise opacity-0 so
                  it only appears on hover. Stops propagation so the card-
                  level click handler doesn't double-fire. */}
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation()
                  toggleSelected(originalIdx)
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select ${item.name}`}
                className={
                  "absolute top-1 left-1 size-4 accent-[#22d3ee] cursor-pointer "
                  + (isSelectionMode ? "opacity-100" : "opacity-0 group-hover:opacity-100")
                }
              />
              {!isSelectionMode && (
                <button
                  type="button"
                  onClick={() => handleRemove(originalIdx)}
                  aria-label={`Remove ${item.name}`}
                  className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-black/80"
                >
                  Remove
                </button>
              )}
            </div>
          )
        })}
        {visibleTracked.map((j) => (
          <div
            key={j.jobId}
            className="aspect-video border border-[#1e293b] rounded bg-[#0e1117] flex items-center justify-center text-[11px] text-slate-400"
          >
            Generating {j.name}…
          </div>
        ))}
        {!q && items.length === 0 && trackedForBucket.length === 0 && (
          <div className="col-span-full text-center text-[11px] text-slate-500 py-8 border border-dashed border-[#1e293b] rounded">
            No {BUCKET_LABEL[bucketName]} variants yet — pick a preset below or enter a custom prompt.
          </div>
        )}
        {zeroResults && (
          <div className="col-span-full text-center text-[11px] text-slate-500 py-6 border border-dashed border-[#1e293b] rounded">
            No matches for &quot;{searchQuery.trim()}&quot;.{" "}
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-pink-400 hover:underline"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Preset chips */}
      <div className="flex flex-wrap gap-2">
        {visiblePresets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handlePresetClick(p)}
            disabled={disabled}
            className="px-3 py-1 text-[11px] rounded bg-[#1a1d27] hover:bg-[#1e293b] border border-[#1e293b] text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {resolveLabel(LOCATION_PRESET_TO_CATALOG[p]?.entryId ?? p, p)}
          </button>
        ))}
      </div>

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
    </div>
  )
}
