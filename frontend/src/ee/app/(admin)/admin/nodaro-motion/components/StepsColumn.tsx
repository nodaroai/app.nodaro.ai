// Admin → Nodaro Motion, one engine's preparation steps (the
// `nodaro_motion_steps` setting's entry for the engine): the trend editor's
// StepsEditor, for every run people start themselves on that engine. Its
// scene description applies to the engine's Motion runs prepared in Full
// depth with the scene from a description (the Precise masking never is);
// once every environment's engine runs the shot list, every Flex run is
// (`flexIsFullDepth`: Full depth with a shot list).
//
// The setting is shared by every environment, so the editor is greyed out,
// naming the environments, until every one's engine takes the steps (the
// server refuses the save otherwise, 409 `engine_unsupported`).

import type { CastSwapSteps, NodaroMotionEngine, NodaroMotionMotionEntry, NodaroMotionSteps, TrendEngineEnvironment } from "@/lib/api"
import { StepsEditor, normaliseSteps } from "../../trends/components/StepsEditor"
import { clipPreparationOf } from "../../trends/clip-preparation"
import { sceneOf } from "../../trends/prompt-style"
import { flexIsFullDepth } from "./MotionColumn"

/** The setting as it is saved: each engine's steps that are set; an engine with none is left out. */
export function stepsToSaved(draft: NodaroMotionSteps | null | undefined): NodaroMotionSteps {
  const out: NodaroMotionSteps = {}
  for (const [id, steps] of Object.entries(draft ?? {}) as Array<[NodaroMotionEngine, CastSwapSteps | undefined]>) {
    const kept = normaliseSteps(steps)
    if (kept) out[id] = kept
  }
  return out
}

interface Props {
  readonly engine: NodaroMotionEngine
  readonly value: CastSwapSteps | undefined
  readonly onChange: (next: CastSwapSteps | undefined) => void
  readonly envs: readonly TrendEngineEnvironment[] | undefined
  /** The engine's Motion entry, as edited (its masking decides whether a scene description is written). */
  readonly motion: NodaroMotionMotionEntry | undefined
}

export function StepsColumn({ engine, value, onChange, envs, motion }: Props) {
  const m = motion?.masking
  const masked = !!m && m.mode !== "off"
  // The shot list's rule: Flex is Full depth, its scene always written in words (the engine's reading).
  const shotList = flexIsFullDepth(envs)
  const fullDepth = masked && clipPreparationOf(m) === "full-depth"
  return (
    <StepsEditor
      value={value}
      onChange={onChange}
      envs={envs}
      engine={engine}
      source={shotList ? "full-depth" : masked ? clipPreparationOf(m) : undefined}
      scene={shotList ? (fullDepth && sceneOf(m) === "original" ? "description-and-original" : "description") : masked ? sceneOf(m) : undefined}
    />
  )
}
