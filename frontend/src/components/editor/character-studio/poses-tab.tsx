import { ImageAssetTab } from "./expressions-tab"
import { tx, useT } from "@/lib/i18n"
import type { CharacterStudioState } from "./use-character-studio"
import type { CharacterStudioJobs } from "./use-character-studio-jobs"

const POSE_PRESETS = [
  "standing",
  "walking",
  "sitting",
  "running",
  "crouching",
  "pointing",
  "fighting stance",
  "jumping",
  "turning",
] as const

export function PosesTab({
  state,
  jobs,
  onSwitchToAppearance,
}: {
  state: CharacterStudioState
  jobs: CharacterStudioJobs
  onSwitchToAppearance?: () => void
}) {
  const t = useT()
  return (
    <ImageAssetTab
      state={state}
      jobs={jobs}
      assetType="poses"
      arrayField="poses"
      presets={POSE_PRESETS}
      title={t("node.assetBadgePoses")}
      description={t("studio.posesDescription")}
      onImport={() => {
        const url = window.prompt(tx("studio.pasteImageUrlPose"))?.trim()
        if (url) state.patch({ poses: [...state.staged.poses, { name: "imported", url }] })
      }}
      onSwitchToAppearance={onSwitchToAppearance}
    />
  )
}
