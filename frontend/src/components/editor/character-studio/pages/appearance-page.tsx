import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import { ImageAssetTab } from "../expressions-tab"

// Head angles drop "back" (back-of-head is rarely useful as a likeness ref);
// body angles keep all 6 since back-body views matter for character sheets.
const HEAD_ANGLE_PRESETS = ["front", "3/4 left", "left profile", "right profile", "3/4 right"] as const
const BODY_ANGLE_PRESETS = ["front", "3/4 left", "left profile", "right profile", "3/4 right", "back"] as const
const LIGHTING_PRESETS = ["daylight", "night", "dramatic"] as const

/**
 * Appearance page — the Head/Body Angles + Lighting reference-image sub-sections,
 * relocated out of the old `appearance-tab.tsx`. Each reuses `ImageAssetTab`.
 * These omit the portrait-required gate (they're contextually part of the
 * Appearance flow and can generate without an explicit switch CTA).
 */
export function AppearancePage({ state, jobs }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      <div>
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
          description="full-body natural standing at different angles"
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
