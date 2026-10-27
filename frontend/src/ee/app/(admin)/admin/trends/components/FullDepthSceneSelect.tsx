// Full depth's scene source (hidden from users): where a run's scene
// (setting, lighting, props, wardrobe, shots) comes from, since the depth
// clip carries none — a description the engine writes on each run (the
// default), the original clip as a second video (up to 27.5 s), or
// nothing (the admin writes it). It changes what a run sends, never the
// stored depth clip: switching it needs no new clip.
//
// The original with a clip over the limit is said here and holds publishing
// (`full_depth_clip_too_long`), never Save. An environment whose engine
// cannot take the scene (`castSwap.fullDepthScenes`; absent = the original
// only) is named under the select.

import { useId } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AdminTrendFullDepthScene, TrendEngineEnvironment } from "@/lib/api"
import { FULL_DEPTH_SCENES, ORIGINAL_SCENE_MAX_SEC, environmentsLackingScene } from "../prompt-style"

interface Props {
  /** As stored: undefined = a description. */
  readonly value: AdminTrendFullDepthScene | undefined
  readonly onChange: (next: AdminTrendFullDepthScene | undefined) => void
  /** The source clip's length, when known (the original takes up to 27.5 s). */
  readonly clipSec?: number
  readonly envs?: readonly TrendEngineEnvironment[]
}

export function FullDepthSceneSelect({ value, onChange, clipSec, envs }: Props) {
  const id = useId()
  const shown = value ?? "description"
  const hint = FULL_DEPTH_SCENES.find((s) => s.value === shown)?.hint
  const tooLong = shown === "original" && clipSec !== undefined && clipSec > ORIGINAL_SCENE_MAX_SEC
  const lacking = environmentsLackingScene(shown, envs)
  return (
    <div className="flex flex-col gap-1 text-sm sm:w-1/2 sm:pr-1.5">
      <label htmlFor={id} className="font-medium">
        Scene from
      </label>
      <Select value={shown} onValueChange={(v) => onChange(v === "description" ? undefined : (v as AdminTrendFullDepthScene))}>
        <SelectTrigger id={id} className="h-9" aria-describedby={`${id}-hint`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FULL_DEPTH_SCENES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </span>
      {tooLong && (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          The clip is {clipSec!.toFixed(1)} s: the original takes clips up to {ORIGINAL_SCENE_MAX_SEC} s, so the trend can't be published this way.
          Use a shorter clip, or take the scene from a description or from nothing.
        </span>
      )}
      {lacking.length > 0 && (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          Not supported yet by the Cast Swap engine of: {lacking.join(", ")}. The trend can't be published until it is.
        </span>
      )}
    </div>
  )
}
