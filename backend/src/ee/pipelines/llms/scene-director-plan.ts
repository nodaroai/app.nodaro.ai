import type { z } from "zod"
import {
  AssetRefSchema,
  SceneNodeDataSchema,
  ShotSpecSchema,
  sceneRenderStateRegistry,
  type AssetRef,
  type SceneNodeData,
  type ShotSpec,
} from "@nodaro/shared"

/**
 * The Scene Director's output is a plan only (decided 2026-10-07). It accepts
 * no url field and no asset id: urls and ids come only from the pipeline's
 * own outputs (Stage 6/7 and the helpers write them), never from the model.
 *
 * The plan schema is DERIVED from the published `SceneNodeDataSchema` (which
 * stays the persisted contract) by removing every execution-state field:
 *   - a key named `url`, `*_url`, `*_urls`, `asset_id` or `*_asset_id` (the
 *     rule migrations 480/482 judge scene_node_data by), and
 *   - a field holding asset refs (`AssetRefSchema`, alone or in a list), and
 *   - a shot field only a render or the user writes, which the shared schema
 *     tags in `sceneRenderStateRegistry` (decided 2026-10-07):
 *     `accepted_match_cut_break` (the user accepting a match-cut break),
 *     `actual_audio_duration_sec` and `has_dialogue` (Stage 7 speech),
 *     `dialogue_no_cut_zone` (dialogue-recheck) and `cut_decision` (the
 *     Editor LLM). A model-sent value would skip the match-cut critic or
 *     stretch shot durations by a number no recording measured.
 * By rule and by tag, not by a list, so a field added to the shared schema
 * later is covered. The derived Zod schema is also what `callLLM` turns into the tool
 * schema the model is shown, so the model is never offered such a field, and
 * one it sends anyway is stripped by parsing.
 *
 * A re-planned scene renders fresh (decided 2026-10-07): the scene Stage 5
 * persists is the plan alone, with the empty execution state. Nothing the
 * stored scene holds from an earlier render (composite, keyframes,
 * interpolation keyframes, clips, frames, audio, asset refs) is carried over,
 * so Stage 6 and Stage 7 cannot reuse a stale output.
 *
 * The one open object a shot still carries, `camera_path_directive.parameters`
 * (a free-form record), is covered by stripping the same keys AT ANY DEPTH —
 * as `sceneNodeDataUrls` and migration 482's trigger judge them: parsing does
 * it (a transform, so the tool schema `callLLM` renders with `io: "input"` is
 * unchanged), and `sceneFromDirectorPlan` does it again so the persisted
 * scene never depends on the caller having parsed.
 */
const EXECUTION_KEY = /(^|_)(urls?|asset_id)$/

type Def = { type?: string; innerType?: z.ZodType; element?: z.ZodType }
const defOf = (schema: z.ZodType): Def => (schema as unknown as { def: Def }).def

/** Peel default / nullable / optional wrappers, then one list. */
function coreOf(schema: z.ZodType): z.ZodType {
  let cur = schema
  while (defOf(cur).innerType) cur = defOf(cur).innerType!
  return defOf(cur).type === "array" && defOf(cur).element ? coreOf(defOf(cur).element!) : cur
}

/** The field, or any wrapper layer of it, carries the shared render-state tag. */
function isRenderState(schema: z.ZodType): boolean {
  for (let cur: z.ZodType | undefined = schema; cur; cur = defOf(cur).innerType) {
    if (sceneRenderStateRegistry.has(cur)) return true
  }
  return false
}

function executionKeysOf(shape: Record<string, z.ZodType>): string[] {
  return Object.entries(shape)
    .filter(([key, field]) => EXECUTION_KEY.test(key) || coreOf(field) === AssetRefSchema || isRenderState(field))
    .map(([key]) => key)
}

/**
 * The tagged shot fields, named for the type level (a type cannot read the
 * registry). The test pins this list to the tags on the shared schema.
 */
export const SHOT_RENDER_STATE_KEYS = [
  "accepted_match_cut_break",
  "actual_audio_duration_sec",
  "cut_decision",
  "dialogue_no_cut_zone",
  "has_dialogue",
] as const satisfies readonly (keyof ShotSpec)[]

const SHOT_EXECUTION_KEYS = executionKeysOf(ShotSpecSchema.shape)
const SCENE_EXECUTION_KEYS = executionKeysOf(SceneNodeDataSchema.shape)

const maskOf = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, true])) as never

const SceneDirectorShotSchema = ShotSpecSchema.omit(maskOf(SHOT_EXECUTION_KEYS))

/** `shots` keeps its own bounds (min/max) around the plan-only shot. */
const shotsField = SceneNodeDataSchema.shape.shots
const planShotsField = shotsField.clone({ ...shotsField.def, element: SceneDirectorShotSchema } as never)

type ExecutionKeys<T> = {
  [K in keyof T]-?: K extends "url" | `${string}_url` | `${string}_urls` | "asset_id" | `${string}_asset_id`
    ? K
    : NonNullable<T[K]> extends AssetRef | AssetRef[]
      ? K
      : never
}[keyof T]

export type SceneDirectorShot = Omit<ShotSpec, ExecutionKeys<ShotSpec> | (typeof SHOT_RENDER_STATE_KEYS)[number]>
export type SceneDirectorPlan = Omit<SceneNodeData, ExecutionKeys<SceneNodeData> | "shots"> & {
  shots: SceneDirectorShot[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v)

/** A copy of `value` with every url / asset-id key removed at any depth (objects, records, arrays). */
function withoutExecutionKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutExecutionKeysDeep) as T
  if (!isObj(value)) return value
  const out: Obj = {}
  for (const [k, v] of Object.entries(value)) if (!EXECUTION_KEY.test(k)) out[k] = withoutExecutionKeysDeep(v)
  return out as T
}

export const SceneDirectorPlanSchema = SceneNodeDataSchema.omit(maskOf([...SCENE_EXECUTION_KEYS, "shots"]))
  .extend({ shots: planShotsField })
  .transform(withoutExecutionKeysDeep) as unknown as z.ZodType<SceneDirectorPlan, unknown>

/** `obj` without `keys` (the asset-ref fields) and without any url / asset-id key at any depth. */
function withoutKeys(obj: Obj, keys: readonly string[]): Obj {
  const out: Obj = {}
  for (const [k, v] of Object.entries(obj)) if (!keys.includes(k) && !EXECUTION_KEY.test(k)) out[k] = withoutExecutionKeysDeep(v)
  return out
}

/**
 * The empty execution state a schema defaults to for `keys` (scene asset
 * refs: null / []; a shot's `has_dialogue`: false). A key with no default is
 * left out.
 */
function executionDefaults(shape: Record<string, z.ZodType>, keys: readonly string[]): Obj {
  const out: Obj = {}
  for (const key of keys) {
    const parsed = shape[key]!.safeParse(undefined)
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data
  }
  return out
}

/**
 * The scene Stage 5 persists: the plan, with the empty execution state the
 * scene schema defaults to. It takes no stored scene on purpose (decided
 * 2026-10-07: a re-planned scene renders fresh), so no url, asset id or asset
 * ref of an earlier render can reach the re-planned scene, and Stage 7's
 * cached-composite short-circuit cannot fire on it. No render or gate state
 * the model sends (an accepted match-cut break, a measured audio length, a
 * cut) lands either; `has_dialogue` starts at its default of false until
 * Stage 7 records speech. Any execution field in
 * `plan` is ignored, whatever its value and at any depth
 * (`camera_path_directive.parameters` included), so nothing the model emits
 * becomes a url or an id. The input is not mutated.
 */
export function sceneFromDirectorPlan(plan: SceneDirectorPlan): SceneNodeData {
  const planObj = plan as unknown as Obj
  const shots = (Array.isArray(planObj.shots) ? planObj.shots : []).map((shot) => ({
    ...executionDefaults(ShotSpecSchema.shape, SHOT_EXECUTION_KEYS),
    ...withoutKeys(isObj(shot) ? shot : {}, SHOT_EXECUTION_KEYS),
  }))
  return {
    ...executionDefaults(SceneNodeDataSchema.shape, SCENE_EXECUTION_KEYS),
    ...withoutKeys(planObj, SCENE_EXECUTION_KEYS),
    shots,
  } as unknown as SceneNodeData
}
