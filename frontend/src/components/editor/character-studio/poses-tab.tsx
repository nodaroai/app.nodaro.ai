import { ImageAssetTab } from "./expressions-tab"
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
  return (
    <ImageAssetTab
      state={state}
      jobs={jobs}
      assetType="poses"
      arrayField="poses"
      presets={POSE_PRESETS}
      title="Poses"
      description="Body posture and stance reference images"
      onImport={() => {
        const url = window.prompt("Paste an image URL to import as a pose:")?.trim()
        if (url) state.patch({ poses: [...state.staged.poses, { name: "imported", url }] })
      }}
      onSwitchToAppearance={onSwitchToAppearance}
    />
  )
}
