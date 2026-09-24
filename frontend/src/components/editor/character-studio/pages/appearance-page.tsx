import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import { ImageAssetTab } from "../expressions-tab"
import { useT } from "@/lib/i18n"

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
  // Identity anchor set = the 5 standard head angles. They land in the `angles`
  // column, which `assembleCharacterReferenceSet` (backend) uses as angle-matched
  // multi-image references for every subsequent Studio asset — so having the full
  // turnaround keeps faces on-model. Surface completion so users know to build it.
  const t = useT()
  const hasPortrait = Boolean(state.staged.sourceImageUrl)
  const anchorHave = HEAD_ANGLE_PRESETS.filter((p) =>
    (state.staged.angles ?? []).some((a) => a.name.toLowerCase() === p.toLowerCase()),
  ).length
  const anchorTotal = HEAD_ANGLE_PRESETS.length

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      <div className="rounded-md border border-[#1e293b] bg-[#0f1420] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-medium text-slate-200">{t("studio.identityAnchorSet")}</div>
          <div
            className={`text-[10px] tabular-nums ${anchorHave === anchorTotal ? "text-emerald-400" : "text-slate-400"}`}
          >
            {t("studio.nOfTotalAngles", { have: anchorHave, total: anchorTotal })}
          </div>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
          {t("studio.anchorSetExplainer")}
          {!hasPortrait && ` ${t("studio.approvePortraitFirstAngles")}`}
        </p>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-2">{t("studio.headFaceAngles")}</div>
        <ImageAssetTab
          state={state}
          jobs={jobs}
          assetType="headAngles"
          arrayField="angles"
          presets={HEAD_ANGLE_PRESETS}
          title={t("studio.headAngles")}
          description={t("studio.headAnglesDescription")}
        />
      </div>
      <div className="border-t border-[#1e293b] pt-4">
        <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-2">{t("studio.bodyAngles")}</div>
        <ImageAssetTab
          state={state}
          jobs={jobs}
          assetType="bodyAngles"
          arrayField="bodyAngles"
          presets={BODY_ANGLE_PRESETS}
          title={t("studio.bodyAngles")}
          description={t("studio.bodyAnglesDescription")}
        />
      </div>
      <div className="border-t border-[#1e293b] pt-4">
        <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-2">{t("studio.lightingVariations")}</div>
        <ImageAssetTab
          state={state}
          jobs={jobs}
          assetType="lighting"
          arrayField="lightingVariations"
          presets={LIGHTING_PRESETS}
          title={t("paramcfg.lighting")}
          description={t("studio.lightingDescription")}
        />
      </div>
    </div>
  )
}
