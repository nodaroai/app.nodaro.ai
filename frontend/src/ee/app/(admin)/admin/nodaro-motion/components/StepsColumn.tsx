// Admin → Nodaro Motion, one engine's preparation steps (the
// `nodaro_motion_steps` setting's entry for the engine): the trend editor's
// StepsEditor, for every run people start themselves on that engine. Its
// scene description applies to every Flex run: Flex is always Full depth with
// a shot list, its scene written in words (MotionColumn.tsx).
//
// The setting is shared by every environment, so the editor is greyed out,
// naming the environments, until every one's engine takes the steps (the
// server refuses the save otherwise, 409 `engine_unsupported`).

import type { CastSwapSteps, NodaroMotionEngine, NodaroMotionMotionEntry, NodaroMotionSteps, TrendEngineEnvironment } from "@/lib/api"
import { StepsEditor, normaliseSteps } from "../../trends/components/StepsEditor"
import { sceneOf } from "../../trends/prompt-style"
import { isFlexMasking, shotListSceneOf } from "./MotionColumn"

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
  /** The engine's Motion entry, as edited (its Full depth's scene, as Flex runs it). */
  readonly motion: NodaroMotionMotionEntry | undefined
}

export function StepsColumn({ engine, value, onChange, envs, motion }: Props) {
  const m = motion?.masking
  // Flex is Full depth, its scene always written in words (the engine's reading); any other masking runs the default.
  const scene = isFlexMasking(m) ? (shotListSceneOf(sceneOf(m)) ?? sceneOf(m)) : "description"
  return <StepsEditor value={value} onChange={onChange} envs={envs} engine={engine} source="full-depth" scene={scene} />
}
