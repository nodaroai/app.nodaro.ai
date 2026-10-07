import { describe, it, expect } from "vitest"
import { z } from "zod"
import { SceneNodeDataSchema, ShotSpecSchema, sceneRenderStateRegistry } from "@nodaro/shared"
import { restrictObjectSchemas } from "../../../../lib/json-schema-strict.js"
import { sceneNodeDataUrls } from "../../../../lib/pipeline-asset-ownership.js"
import {
  SHOT_RENDER_STATE_KEYS,
  SceneDirectorPlanSchema,
  sceneFromDirectorPlan,
  type SceneDirectorPlan,
  type SceneDirectorShot,
} from "../scene-director-plan.js"

/**
 * The Scene Director's output is a plan only (decided 2026-10-07): it accepts
 * no url field and no asset id. Urls and ids come only from the pipeline's
 * own outputs (Stage 6/7 and the helpers). A re-planned scene renders fresh
 * (decided 2026-10-07): Stage 5 persists the plan with the empty execution
 * state, so no output of an earlier render is carried over.
 */

/** The tool schema the model is shown, built as call-llm.ts builds it. */
const toolSchemaOf = (schema: z.ZodType): Record<string, unknown> =>
  restrictObjectSchemas(
    z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any", io: "input" }) as Record<string, unknown>,
  )

const EXECUTION_KEY = /(^|_)(urls?|asset_id)$/

/** Every property name and `format` value anywhere in a JSON schema. */
function namesIn(node: unknown, out = { keys: new Set<string>(), formats: new Set<string>() }) {
  if (Array.isArray(node)) {
    for (const item of node) namesIn(item, out)
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>
    if (typeof obj.format === "string") out.formats.add(obj.format)
    if (obj.properties && typeof obj.properties === "object") {
      for (const key of Object.keys(obj.properties)) out.keys.add(key)
    }
    for (const value of Object.values(obj)) namesIn(value, out)
  }
  return out
}

/** Every key anywhere in a value (objects, records, arrays). */
function keysAtAnyDepth(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const item of node) keysAtAnyDepth(item, out)
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      out.push(key)
      keysAtAnyDepth(value, out)
    }
  }
  return out
}

/** The JSON paths of every object node that accepts any key (`additionalProperties: {}` / `true`). */
function openObjectPaths(node: unknown, path = "$", out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((item, i) => openObjectPaths(item, `${path}[${i}]`, out))
  else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>
    const ap = obj.additionalProperties
    if (ap === true || (ap && typeof ap === "object" && Object.keys(ap).length === 0)) out.push(path)
    for (const [key, value] of Object.entries(obj)) openObjectPaths(value, `${path}.${key}`, out)
  }
  return out
}

/** A property's JSON subschema names a url or an asset id somewhere inside. */
const carriesExecutionState = (sub: unknown): boolean => {
  const { keys, formats } = namesIn({ properties: { _: sub } })
  return [...keys].some((k) => EXECUTION_KEY.test(k)) || formats.has("uri")
}

/**
 * The shot fields only a render or the user writes (Stage 7, dialogue-recheck,
 * the Editor LLM, accepting a match-cut break), read from the tag on the
 * shared schema, never from a list kept here.
 */
const taggedRenderStateKeys = (shape: Record<string, z.ZodType>): string[] =>
  Object.entries(shape)
    .filter(([, field]) => sceneRenderStateRegistry.has(field))
    .map(([key]) => key)
    .sort()

const RENDER_STATE = new Set(taggedRenderStateKeys(ShotSpecSchema.shape))

const props = (schema: Record<string, unknown>): Record<string, unknown> =>
  schema.properties as Record<string, unknown>

const fullScene = toolSchemaOf(SceneNodeDataSchema)
const fullShot = (props(fullScene).shots as { items: Record<string, unknown> }).items
const planScene = toolSchemaOf(SceneDirectorPlanSchema)
const planShot = (props(planScene).shots as { items: Record<string, unknown> }).items

const OWNER_JOB = "f0000000-0000-4000-8000-00000000a001"
const ownerUrl = (name: string, ext = "png") => `https://media.test/${name}s/${OWNER_JOB}-${name}.${ext}`
const ID = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`

const planShotOf = (shotId: string) => ({
  shot_id: shotId,
  camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
  shot_intensity_kind: "establishing_shot",
  action: `action of ${shotId}`,
  dialogue_line: null,
  duration_seconds: 4,
  motion_prompt: "x",
  start_state: "x",
  end_state: "x",
  continuity_with_previous: null,
  shot_intent: { needs_multishot_reference: false, is_loopable: false, needs_music_suppression: true, is_match_cut: false },
  visual_keyframe_prompt: `keyframe of ${shotId}`,
})

const planOf = (shotIds: string[]) =>
  ({
    scene_index: 1,
    description: "new plan",
    emotional_beat: "setup",
    duration_seconds: 8,
    shot_input_mode: "first_frame",
    cast_keys: [],
    location_key: "x",
    object_keys: [],
    continuity_from_prev: "hard_cut",
    image_model: "nano-banana-2",
    video_model: "kling",
    shots: shotIds.map(planShotOf),
  }) as SceneDirectorPlan

describe("the Scene Director's output schema is a plan only (decided 2026-10-07)", () => {
  it("the tool schema the model is shown names no url field, no asset id and no uri anywhere", () => {
    const { keys, formats } = namesIn(planScene)
    expect([...keys].filter((k) => EXECUTION_KEY.test(k))).toEqual([])
    expect(formats.has("uri")).toBe(false)
  })

  it("the full scene schema does name them (the test above is not vacuous)", () => {
    const { keys, formats } = namesIn(fullScene)
    expect([...keys].filter((k) => EXECUTION_KEY.test(k)).length).toBeGreaterThan(10)
    expect(formats.has("uri")).toBe(true)
  })

  it("every other field of the scene and of a shot is in the plan, unchanged (a field added to the shared schema is decided here)", () => {
    for (const [full, plan] of [
      [fullScene, planScene],
      [fullShot, planShot],
    ] as const) {
      for (const [key, sub] of Object.entries(props(full))) {
        if (key === "shots") continue
        if (EXECUTION_KEY.test(key) || carriesExecutionState(sub) || (plan === planShot && RENDER_STATE.has(key))) {
          expect(props(plan), key).not.toHaveProperty(key)
        } else {
          expect(props(plan)[key], key).toEqual(sub)
        }
      }
      expect(Object.keys(props(plan)).every((k) => k in props(full))).toBe(true)
    }
    // The shot list keeps its bounds.
    const { items: _full, ...fullBounds } = props(fullScene).shots as Record<string, unknown>
    const { items: _plan, ...planBounds } = props(planScene).shots as Record<string, unknown>
    expect(planBounds).toEqual(fullBounds)
    expect(planScene.required).toEqual((fullScene.required as string[]).filter((k) => k in props(planScene)))
  })

  it("a url or asset id the model sends anyway does not survive parsing", () => {
    const sent = {
      ...planOf(["shot_01"]),
      composite_video_url: ownerUrl("video", "mp4"),
      composite_video_asset_id: ID(1),
      scene_anchor_keyframe: { asset_id: ID(2), url: ownerUrl("image") },
      generated_clips: [{ asset_id: ID(3), url: ownerUrl("video", "mp4") }],
      shots: [
        {
          ...planShotOf("shot_01"),
          keyframe_url: ownerUrl("image"),
          keyframe_asset_id: ID(4),
          interpolation_keyframe_urls: [ownerUrl("image")],
          bridged_frame_url: ownerUrl("image"),
        },
      ],
    }
    const parsed = SceneDirectorPlanSchema.parse(sent)
    expect(JSON.stringify(parsed)).not.toContain("media.test")
    expect(JSON.stringify(parsed)).not.toMatch(/asset_id|_url|anchor_keyframe|generated_clips/)
    expect(parsed.shots[0]).toMatchObject({ shot_id: "shot_01", visual_keyframe_prompt: "keyframe of shot_01" })
  })

  it("a url or asset id nested under camera_path_directive.parameters does not survive parsing either", () => {
    const sent = {
      ...planOf(["shot_01"]),
      shots: [
        {
          ...planShotOf("shot_01"),
          camera_path_directive: {
            path_kind: "orbit",
            parameters: {
              degrees: 90,
              url: "https://evil.example/x.png",
              seed_image_url: ownerUrl("image"),
              x_asset_id: ID(30),
              nested: { frames: [{ asset_id: ID(31), url: ownerUrl("frame"), label: "a" }], ref_urls: [ownerUrl("sub")] },
            },
          },
        },
      ],
    }
    const parsed = SceneDirectorPlanSchema.parse(sent)
    expect(sceneNodeDataUrls(parsed)).toEqual([])
    expect(keysAtAnyDepth(parsed).filter((k) => EXECUTION_KEY.test(k))).toEqual([])
    // The plan's own parameters stay.
    expect(parsed.shots[0]!.camera_path_directive).toEqual({
      path_kind: "orbit",
      parameters: { degrees: 90, nested: { frames: [{ label: "a" }] } },
    })
  })

  it("the only open object in the tool schema is camera_path_directive.parameters (covered by the deep strip)", () => {
    expect(openObjectPaths(planScene)).toEqual([
      "$.properties.shots.items.properties.camera_path_directive.properties.parameters",
    ])
  })

  it("the shared ShotSpec and SceneNodeData schemas are unchanged (the published contract keeps its fields)", () => {
    expect(ShotSpecSchema.shape).toHaveProperty("keyframe_url")
    expect(SceneNodeDataSchema.shape).toHaveProperty("composite_video_url")
  })
})

describe("render and gate state is not part of the plan either (decided 2026-10-07)", () => {
  const RENDER_FIELDS = {
    accepted_match_cut_break: true,
    actual_audio_duration_sec: 9,
    dialogue_no_cut_zone: { start: 0, end: 9 },
    cut_decision: { in_offset_sec: 0.5, out_offset_sec: 0.5, transition_to_next: "hard_cut" },
    has_dialogue: true,
  }

  it("the shared ShotSpec tags exactly the fields a render or the user writes", () => {
    expect(taggedRenderStateKeys(ShotSpecSchema.shape)).toEqual([
      "accepted_match_cut_break",
      "actual_audio_duration_sec",
      "cut_decision",
      "dialogue_no_cut_zone",
      "has_dialogue",
    ])
    // The scene level holds none (its render state is the url / asset-ref rule).
    expect(taggedRenderStateKeys(SceneNodeDataSchema.shape)).toEqual([])
  })

  it("the plan-only shot type omits the same keys the shared schema tags", () => {
    expect([...SHOT_RENDER_STATE_KEYS].sort()).toEqual([...RENDER_STATE])
    // Type level (checked by tsc): none of the tagged keys is a key of the plan-only shot.
    type Overlap = Extract<keyof SceneDirectorShot, (typeof SHOT_RENDER_STATE_KEYS)[number]>
    const noOverlap: [Overlap] extends [never] ? true : false = true
    expect(noOverlap).toBe(true)
  })

  it("the tool schema the model is shown offers none of them", () => {
    for (const key of RENDER_STATE) expect(props(planShot), key).not.toHaveProperty(key)
    for (const key of RENDER_STATE) expect(props(fullShot), key).toHaveProperty(key)
  })

  it("one the model sends anyway does not survive parsing", () => {
    const sent = { ...planOf(["shot_01"]), shots: [{ ...planShotOf("shot_01"), ...RENDER_FIELDS }] }
    const parsed = SceneDirectorPlanSchema.parse(sent)
    for (const key of RENDER_STATE) expect(parsed.shots[0], key).not.toHaveProperty(key)
  })

  it("sceneFromDirectorPlan persists none of them; has_dialogue lands at its default of false", () => {
    const plan = {
      ...planOf(["shot_01", "shot_02"]),
      shots: [
        { ...planShotOf("shot_01"), ...RENDER_FIELDS },
        { ...planShotOf("shot_02"), accepted_match_cut_break: true, actual_audio_duration_sec: 9 },
      ],
    } as unknown as SceneDirectorPlan
    const scene = sceneFromDirectorPlan(plan)
    for (const shot of scene.shots) {
      expect(shot).not.toHaveProperty("accepted_match_cut_break")
      expect(shot).not.toHaveProperty("actual_audio_duration_sec")
      expect(shot).not.toHaveProperty("dialogue_no_cut_zone")
      expect(shot).not.toHaveProperty("cut_decision")
      expect(shot.has_dialogue).toBe(false)
    }
    expect(SceneNodeDataSchema.safeParse(scene).success).toBe(true)
  })
})

describe("sceneFromDirectorPlan: a re-planned scene renders fresh; the model's urls and ids never land (decided 2026-10-07)", () => {
  it("takes the plan alone: no stored scene can carry a url, id or asset ref of an earlier render into it", () => {
    expect(sceneFromDirectorPlan.length).toBe(1)
  })

  it("a url or id in the plan is ignored", () => {
    const plan = {
      ...planOf(["shot_01", "shot_03"]),
      composite_video_url: "https://example.com/model.mp4",
      last_frame: { asset_id: ID(20), url: "https://example.com/model.png" },
      shots: [
        { ...planShotOf("shot_01"), keyframe_url: "https://example.com/model.png", video_asset_id: ID(21) },
        { ...planShotOf("shot_03"), keyframe_url: "https://example.com/model.png", audio_asset_id: "pending" },
      ],
    } as unknown as SceneDirectorPlan
    const scene = sceneFromDirectorPlan(plan)
    expect(JSON.stringify(scene)).not.toContain("example.com")
    expect(JSON.stringify(scene)).not.toContain(ID(20))
    expect(JSON.stringify(scene)).not.toContain(ID(21))
    expect(keysAtAnyDepth(scene).filter((k) => EXECUTION_KEY.test(k))).toEqual([])
    expect(scene.last_frame).toBeNull()
  })

  it("the plan gets the empty execution state the scene schema defaults to", () => {
    const scene = sceneFromDirectorPlan(planOf(["shot_01", "shot_02"]))
    expect(scene.description).toBe("new plan")
    expect(scene.shots.map((s) => s.action)).toEqual(["action of shot_01", "action of shot_02"])
    expect(scene).toMatchObject({
      scene_anchor_keyframe: null,
      generated_keyframes: [],
      generated_clips: [],
      composite_video: null,
      last_frame: null,
      scene_audio_track: null,
    })
    expect(keysAtAnyDepth(scene).filter((k) => EXECUTION_KEY.test(k))).toEqual([])
    expect(sceneNodeDataUrls(scene)).toEqual([])
    expect(SceneNodeDataSchema.safeParse(scene).success).toBe(true)
  })

  it("a url or asset id nested at any depth of the plan never lands in the scene", () => {
    const plan = {
      ...planOf(["shot_01", "shot_03"]),
      shots: [
        {
          ...planShotOf("shot_01"),
          camera_path_directive: {
            path_kind: "orbit",
            parameters: {
              url: "https://evil.example/x.png",
              seed_image_url: "https://cdn.nodaro.ai/u/other/k.png",
              x_asset_id: ID(40),
              deeper: [{ asset_id: ID(41), url: "https://evil.example/y.png", radius: 2 }],
            },
          },
        },
        {
          ...planShotOf("shot_03"),
          camera_path_directive: { path_kind: "dolly", parameters: { ref_urls: ["https://evil.example/z.png"] } },
        },
      ],
    } as unknown as SceneDirectorPlan
    const scene = sceneFromDirectorPlan(plan)
    expect(JSON.stringify(scene)).not.toContain("evil.example")
    expect(JSON.stringify(scene)).not.toContain("cdn.nodaro.ai")
    expect(JSON.stringify(scene)).not.toContain(ID(40))
    expect(JSON.stringify(scene)).not.toContain(ID(41))
    expect(scene.shots[0]!.camera_path_directive).toEqual({
      path_kind: "orbit",
      parameters: { deeper: [{ radius: 2 }] },
    })
    expect(sceneNodeDataUrls(scene)).toEqual([])
    expect(keysAtAnyDepth(scene).filter((k) => EXECUTION_KEY.test(k))).toEqual([])
  })

  it("never mutates its input", () => {
    const plan = planOf(["shot_01"])
    const planCopy = JSON.parse(JSON.stringify(plan))
    sceneFromDirectorPlan(plan)
    expect(plan).toEqual(planCopy)
  })
})
