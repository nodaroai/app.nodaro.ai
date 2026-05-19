import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  LOCATION_ATMOSPHERE_PROVIDERS,
  LOCATION_PRESET_TO_CATALOG,
  type LocationAtmosphereProvider,
} from "@nodaro/shared"
import { generateLocationMotion } from "@/lib/api"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { useLocationStudioJobs } from "./use-location-studio-jobs"
import type { LocationStudioState } from "./use-location-studio"
import type { LocationAssetItem, LocationNodeData } from "@/types/nodes"

/**
 * MotionTab — the 6th and final Location Studio tab. Produces atmosphere video
 * clips via the i2v provider chain (Kling family + Wan family + Seedance 2),
 * always anchored to the approved main image.
 *
 * Differs from `EnvironmentalAssetTab` (the workhorse for the 5 image-based
 * tabs — time of day, weather, seasons, angles, lighting) in three ways:
 *   1. Outputs are video assets — display via `<video preload="metadata">`
 *      with native controls. No autoplay (preserves network + battery).
 *   2. Provider picker: an i2v model dropdown sourced from
 *      `LOCATION_ATMOSPHERE_PROVIDERS` in `@nodaro/shared`. Defaults to
 *      `"kling"` (the route's Zod default).
 *   3. Source frame requirement: every i2v call needs a source image. When
 *      `sourceImageUrl` is empty we disable every interactive control, show
 *      a banner, and tooltip each disabled chip so the user understands why.
 *
 * Auto-attach: when `attachToLocationId` + `attachToColumn` + `attachName`
 * are set the worker appends `{name, url}` to the locations row's
 * `atmosphere_motions` JSONB column on job completion. The bucket is fixed
 * (`atmosphere_motions` — the column is determined route-side, not by the
 * caller, because locations only have one motion column).
 *
 * Save-before-gen (Q-8): `studio.ensureSavedBeforeGen()` resolves the
 * locations row id (saving on first generate when absent) before the API
 * call so the auto-attach path never silently no-ops.
 */
const MOTION_PRESETS = [
  "slow dolly-in",
  "slow pan-left",
  "slow pan-right",
  "push up",
  "drone fly-over",
  "gentle drift",
  "parallax",
  "static atmospheric",
] as const

interface MotionTabProps {
  readonly studio: LocationStudioState
}

export function MotionTab({ studio }: MotionTabProps) {
  const data = studio.stagedData
  const [customPrompt, setCustomPrompt] = useState("")
  const [provider, setProvider] = useState<LocationAtmosphereProvider>("kling")
  const jobs = useLocationStudioJobs([])
  // Localized labels for the 8 motion preset chips. The English preset string
  // is still the load-bearing value (sent as `motionPrompt` / `attachName` and
  // stored in the locations row). Localization only affects what we RENDER.
  // Pulls from the existing `camera-motions` picker catalog — same
  // translations users see in the camera-motion picker node.
  const { resolveLabel } = useLocalizedCatalog("camera-motions")

  // The worker appends to `atmosphere_motions` via `append_location_asset` —
  // nothing to patch locally. Canvas refresh happens on next save / modal reopen.
  useEffect(() => {
    jobs.onFailed((jobId) => {
      toast.error(`Motion generation ${jobId.slice(0, 8)}… failed`)
    })
  }, [jobs.onFailed])

  if (!data) return null

  const items: ReadonlyArray<LocationAssetItem> = data.atmosphereMotions ?? []
  const noSourceImage = !data.sourceImageUrl
  const disabled = studio.isApprovingMainImage || noSourceImage

  async function fireGen(motionPrompt: string): Promise<void> {
    if (!data) return
    if (!data.sourceImageUrl) {
      toast.error("Approve a main image first")
      return
    }
    try {
      const locationDbId = await studio.ensureSavedBeforeGen()
      const trimmed = motionPrompt.slice(0, 200)
      const result = await generateLocationMotion({
        motionPrompt,
        sourceImageUrl: data.sourceImageUrl,
        provider,
        name: data.locationName || "Location",
        category: data.category,
        style: data.style,
        canonicalDescription: data.canonicalDescription || undefined,
        attachToLocationId: locationDbId,
        attachToColumn: "atmosphere_motions",
        attachName: trimmed,
      })
      jobs.trackJob({
        jobId: result.jobId,
        assetType: "atmosphere_motions",
        name: trimmed,
      })
    } catch {
      // ensureSavedBeforeGen / generateLocationMotion already toast on failure.
    }
  }

  async function handlePresetClick(motionPrompt: string): Promise<void> {
    if (disabled) return
    await fireGen(motionPrompt)
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
    studio.patch({ atmosphereMotions: next } as Partial<LocationNodeData>)
  }

  const trackedMotions = jobs.tracked.filter(
    (j) => j.assetType === "atmosphere_motions",
  )
  const customDisabled = disabled || !customPrompt.trim()
  const presetTooltip = noSourceImage ? "Approve a main image first" : undefined

  // Phase 2 #11 — Search/filter. Same shape as EnvironmentalAssetTab: hide
  // input until the grid is large enough to need it. Filter items by name,
  // tracked placeholders by name, presets by both raw + localized label.
  const [searchQuery, setSearchQuery] = useState("")
  const q = searchQuery.trim().toLowerCase()
  const visibleItems = q
    ? items.filter((i) => i.name.toLowerCase().includes(q))
    : items
  const visiblePresets = q
    ? MOTION_PRESETS.filter((p) => {
        const label = resolveLabel(LOCATION_PRESET_TO_CATALOG[p]?.entryId ?? p, p)
        return p.toLowerCase().includes(q) || label.toLowerCase().includes(q)
      })
    : MOTION_PRESETS
  const visibleTracked = q
    ? trackedMotions.filter((j) => j.name.toLowerCase().includes(q))
    : trackedMotions
  const totalCount = items.length + trackedMotions.length + MOTION_PRESETS.length
  const showSearch = totalCount > 10
  const zeroResults =
    q.length > 0 &&
    visibleItems.length === 0 &&
    visibleTracked.length === 0 &&
    visiblePresets.length === 0

  return (
    <div className="space-y-4 max-w-4xl">
      <h2 className="text-[12px] font-medium text-slate-300">
        🎬 Atmosphere Motion Clips
      </h2>

      {noSourceImage && (
        <div
          role="note"
          className="bg-[#1a1d27] border border-[#1e293b] text-slate-300 p-3 rounded text-[11px]"
        >
          Approve a main image first — motion generation needs a source frame.
        </div>
      )}

      {showSearch && (
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search atmosphere motions…"
            aria-label="Search atmosphere motions"
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

      {/* Asset grid — video cards + in-flight placeholders */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {visibleItems.map((item) => {
          const originalIdx = items.indexOf(item)
          return (
            <div
              key={`${item.url}-${originalIdx}`}
              data-testid={`motion-card-${originalIdx}`}
              className="relative group aspect-video border border-[#1e293b] rounded overflow-hidden bg-[#0e1117]"
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
                onClick={() => handleRemove(originalIdx)}
                aria-label={`Remove ${item.name}`}
                className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-black/80"
              >
                Remove
              </button>
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
        {!q && items.length === 0 && trackedMotions.length === 0 && (
          <div className="col-span-full text-center text-[11px] text-slate-500 py-8 border border-dashed border-[#1e293b] rounded">
            No atmosphere motions yet — pick a preset below or enter a custom
            motion prompt.
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

      {/* Provider picker */}
      <div className="flex items-center gap-2">
        <label htmlFor="motion-provider" className="text-[12px] text-slate-300">
          Provider:
        </label>
        <select
          id="motion-provider"
          value={provider}
          onChange={(e) =>
            setProvider(e.target.value as LocationAtmosphereProvider)
          }
          disabled={disabled}
          className="px-2 py-1 text-[12px] bg-[#1a1d27] border border-[#1e293b] rounded text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {LOCATION_ATMOSPHERE_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {/* Preset chips */}
      <div className="flex flex-wrap gap-2">
        {visiblePresets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handlePresetClick(p)}
            disabled={disabled}
            title={presetTooltip}
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
