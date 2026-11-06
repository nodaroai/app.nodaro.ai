/**
 * Nodaro Motion's Motion setting for direct runs, per engine (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/motion   the setting (null = never saved), the engines, the prompt styles and the engine's supports
 *   PUT /v1/admin/nodaro-motion/motion   { motion }: save the whole setting; audit-logged
 *
 * The setting (`nodaro_motion_motion`, lib/nodaro-motion-motion.ts) is how
 * the Cast Swap engine prepares the clip and words the prompt of every DIRECT
 * run with `style: "motion"`: per engine, its masking (a face mask, or full
 * depth with its scene source) and its prompt style. An engine left out runs
 * Motion on its Precise masking with the Flexible prompt. A trend run keeps
 * its own trend's setting.
 *
 * A save first re-checks the Motion prompt part overrides already saved
 * (`nodaro_motion_prompt_parts`, each engine's `motion` entry) against the
 * NEW setting, on a large direct run (`directRunPromptProblems`): a
 * part the new masking or prompt style does not use, or a prompt grown too
 * long, is 422 `prompt_parts_invalid` with every problem (each naming its
 * `engine` and `style`), and nothing is saved. An engine that does not take
 * prompt parts, or words the prompt from `style` alone (no
 * `castSwap.promptStyles`), is not asked: the setting cannot change its
 * parts.
 *
 * The GET also answers `supports`: what this environment's Cast Swap engine
 * declares of what the setting uses (`styles`, `sourceModes`, `promptStyles`,
 * `fullDepthScenes`; each absent = an engine from before it), so the screen
 * can say when the engine is out of date.
 *
 * A save whose masking hides whole people (faces hidden, target "body") is
 * 409 `engine_unsupported` while any environment's engine cannot do it
 * (`nodaro-motion-hide-body.ts`: the row is shared by every environment);
 * so is one whose masking draws the face mesh (`faceMesh: true`) while any
 * environment's engine cannot draw it (`nodaro-motion-face-mesh.ts`); so is
 * one whose Full depth takes its scene from the description AND the original
 * (`"description-and-original"`) while any environment's engine does not list
 * that scene (`castSwap.fullDepthScenes`): an engine from before it cannot
 * read the setting at all; one whose masking names a depth colormap
 * (`depthColormap`) while any environment's engine cannot draw that map
 * (`nodaro-motion-depth-colormap.ts`); one whose masking names a depth model
 * size (`depthModelSize`) while any environment's engine cannot draw with it
 * (`nodaro-motion-depth-model-size.ts`); one whose full depth blurs the depth
 * map (`depthBlur` above 0) while any environment's engine cannot
 * (`nodaro-motion-depth-blur.ts`); one whose face mesh draws only some
 * of its parts (`faceMeshParts`) while any environment's engine does not list
 * them (`nodaro-motion-face-mesh.ts`); and one whose Full depth face mesh sets
 * the smallest face it draws lines on (`faceMeshMinFaceHeightPct`, 0
 * included) while any environment's engine does not declare it
 * (`nodaro-motion-face-mesh.ts`).
 *
 * Before any of those, a save whose masking carries `faceMeshMinFaceHeightPct`
 * at all is 422 `platform_unsupported` while any environment's PLATFORM (the
 * app itself, not its engine) has not recorded that it takes it: the row is
 * shared, and an older platform's strict schema drops the whole entry that
 * carries the key (`platformHoldOfFaceMeshMinFaceHeight`). An absent field is
 * never held.
 *
 * A save whose Faces hidden masking names the fill `"none"` or a blur on the
 * depth fill is 400 `validation_error`: both are the Precise setting's alone
 * (`motionMaskingPreciseOnlyProblem`), never kept here to be ignored.
 *
 * Each save writes an `admin_actions` row (`update_nodaro_motion_motion`)
 * with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { CAST_SWAP_PROMPT_STYLES } from "@nodaro/render-rules"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION, NODARO_MOTION_ENGINES, NODARO_MOTION_ENGINE_NAMES } from "@nodaro/shared/models"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { NODARO_MOTION_MOTION_KEY, nodaroMotionMotionSchema, type NodaroMotionMotion } from "../../lib/nodaro-motion-motion.js"
import { readNodaroMotionMotion, saveNodaroMotionMotion } from "../../lib/nodaro-motion-motion-store.js"
import { readNodaroMotionPromptParts } from "../../lib/nodaro-motion-prompt-parts-store.js"
import { readNodaroMotionMasking } from "../../lib/nodaro-motion-masking-store.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { loadedEngineHasPromptParts } from "../lib/cast-swap-prompt-parts.js"
import {
  directRunPromptPartsInvalid,
  directRunPromptProblems,
  loadedEngineHasPromptStyles,
  savedFlexWording,
  type DirectRunPromptProblem,
} from "../lib/nodaro-motion-prompt-check.js"
import { promptWordingOf } from "../../lib/nodaro-motion-prompt-wording.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { TREND_PUBLISH_ENVIRONMENTS, listEngineEnvironments } from "../lib/engine-environments.js"
import { engineTakesScene } from "../lib/trends/prompt-style.js"
import { fullDepthSceneOf, type FaceMaskingScene } from "../../lib/cast-swap-face-masking.js"
import { cannotHideBodiesMessage, environmentsThatCannotHideBodies, hidesWholePeople } from "../lib/nodaro-motion-hide-body.js"
import {
  cannotDrawFaceMeshMessage,
  cannotDrawFaceMeshMinFaceHeightMessage,
  cannotDrawFaceMeshPartsMessage,
  drawsFaceMesh,
  environmentsThatCannotDrawFaceMesh,
  environmentsThatCannotDrawFaceMeshMinFaceHeight,
  environmentsThatCannotDrawFaceMeshParts,
  faceMeshMinFaceHeightCarried,
  faceMeshMinFaceHeightOfSetting,
  faceMeshPartsOfSetting,
  platformHoldOfFaceMeshMinFaceHeight,
} from "../lib/nodaro-motion-face-mesh.js"
import { cannotBlurDepthMessage, depthBlurOfSetting, environmentsThatCannotBlurDepth } from "../lib/nodaro-motion-depth-blur.js"
import { motionMaskingPreciseOnlyProblem } from "../lib/nodaro-motion-fill-none.js"
import { cannotDrawColormapsMessage, depthColormapOfSetting, environmentsThatCannotDrawColormaps } from "../lib/nodaro-motion-depth-colormap.js"
import { cannotDrawModelSizesMessage, depthModelSizeOfSetting, environmentsThatCannotDrawModelSizes } from "../lib/nodaro-motion-depth-model-size.js"
import { defineNodaroMotionSettingsSection, sendRefusal } from "../lib/nodaro-motion-settings-section.js"
import { audit } from "./admin-trends-lifecycle.js"
import { withCanonicalFaceMeshLayers } from "../../lib/cast-swap-face-mesh-layers.js"
import {
  cannotDrawFaceMeshLayersMessage,
  environmentsThatCannotDrawFaceMeshLayers,
  faceMeshLayersOfSetting,
  platformHoldOfFaceMeshLayers,
} from "../lib/nodaro-motion-face-mesh-layers.js"

/** The Full depth scenes an engine must list before a shared setting may name them (newer than the setting's scenes). */
const DECLARED_ONLY_SCENES: readonly FaceMaskingScene[] = ["description-and-original"]

/**
 * `admin_actions.target_id` is a NOT NULL uuid, and a deployment-wide setting
 * has no row id of its own: every save of this setting is filed under this
 * fixed id (its own, beside the masking and prompt parts settings').
 */
export const NODARO_MOTION_MOTION_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f3"

const putBody = z.strictObject({ motion: nodaroMotionMotionSchema })

async function view() {
  const { motion, updatedAt } = await readNodaroMotionMotion()
  return {
    motion,
    updatedAt,
    engines: NODARO_MOTION_ENGINES.map((id) => ({ id, name: NODARO_MOTION_ENGINE_NAMES[id], internal: CAST_SWAP_ENGINE_OF_NODARO_MOTION[id] })),
    promptStyles: [...CAST_SWAP_PROMPT_STYLES],
    supports: engineSupports(),
  }
}

/** What this environment's engine declares of what the setting uses (copies; absent = not declared). */
function engineSupports() {
  const cs = getPluginSupports().castSwap
  return {
    ...(cs?.styles ? { styles: [...cs.styles] } : {}),
    ...(cs?.sourceModes ? { sourceModes: [...cs.sourceModes] } : {}),
    ...(cs?.promptStyles ? { promptStyles: [...cs.promptStyles] } : {}),
    ...(cs?.fullDepthScenes ? { fullDepthScenes: [...cs.fullDepthScenes] } : {}),
  }
}

/** The setting with each engine's face mesh layers saved canonically (`withCanonicalFaceMeshLayers`). A new object. */
function canonicalLayersOf(motion: NodaroMotionMotion): NodaroMotionMotion {
  return Object.fromEntries(
    Object.entries(motion).map(([engine, entry]) => [engine, entry?.masking ? { ...entry, masking: withCanonicalFaceMeshLayers(entry.masking) } : entry]),
  ) as NodaroMotionMotion
}

/** The setting as a stored settings set holds it (admin-nodaro-motion-settings-sets.ts): face mesh layers saved canonically. */
export const NODARO_MOTION_MOTION_SECTION = defineNodaroMotionSettingsSection({
  key: "motion",
  path: "/v1/admin/nodaro-motion/motion",
  label: "Motion style",
  body: putBody,
  prepare: (body) => {
    // A set of face mesh layers a parts value names is saved as that value (the full mesh: neither key).
    const motion = canonicalLayersOf(body.motion)
    // The fill "none" and a depth fill's blur are the Precise setting's alone: refused here, never stored unused.
    const preciseOnly = NODARO_MOTION_ENGINES.flatMap((engine) => {
      const problem = motionMaskingPreciseOnlyProblem(motion[engine]?.masking)
      return problem ? [{ path: `motion.${engine}.masking.${problem.field}`, message: problem.message }] : []
    })
    if (preciseOnly.length > 0) {
      const first = preciseOnly[0]!
      return { refusal: { status: 400, error: { code: "validation_error", message: `${first.path}: ${first.message}`, issues: preciseOnly } } }
    }
    return { value: { motion } }
  },
  engineRefusal: async ({ motion }) => {
    // A whole-person masking, or one that draws the face mesh, is saved only once every environment's
    // engine can do it (the row is shared by every environment).
    const hides = NODARO_MOTION_ENGINES.some((engine) => hidesWholePeople(motion[engine]?.masking))
    const meshes = NODARO_MOTION_ENGINES.some((engine) => drawsFaceMesh(motion[engine]?.masking))
    const scenes = NODARO_MOTION_ENGINES.flatMap((engine) => {
      const scene = motion[engine]?.masking ? fullDepthSceneOf(motion[engine]!.masking!) : null
      return scene && DECLARED_ONLY_SCENES.includes(scene) ? [scene] : []
    })
    // A depth colormap likewise (each map named, once).
    const colormaps = [...new Set(NODARO_MOTION_ENGINES.flatMap((engine) => depthColormapOfSetting(motion[engine]?.masking) ?? []))]
    // A depth model size likewise (each size named, once).
    const sizes = [...new Set(NODARO_MOTION_ENGINES.flatMap((engine) => depthModelSizeOfSetting(motion[engine]?.masking) ?? []))]
    // A depth blur, and face mesh parts other than the full mesh (each named, once), likewise.
    const blurs = NODARO_MOTION_ENGINES.some((engine) => depthBlurOfSetting(motion[engine]?.masking) !== undefined)
    const parts = [...new Set(NODARO_MOTION_ENGINES.flatMap((engine) => faceMeshPartsOfSetting(motion[engine]?.masking) ?? []))]
    // Full depth's smallest face with mesh lines likewise (any value set, 0 included).
    const minFaces = NODARO_MOTION_ENGINES.some((engine) => faceMeshMinFaceHeightOfSetting(motion[engine]?.masking) !== undefined)
    // Face mesh layers no parts value names: the engine must draw them, and (carried at all) the platform take them.
    const layers = NODARO_MOTION_ENGINES.some((engine) => faceMeshLayersOfSetting(motion[engine]?.masking) !== undefined)
    // And carried at all (where it draws nothing too): held first while any environment's platform does not take it.
    const maskings = NODARO_MOTION_ENGINES.map((engine) => motion[engine]?.masking)
    const carried = maskings.some(faceMeshMinFaceHeightCarried) || maskings.some((m) => m?.faceMeshLayers !== undefined)
    if (hides || meshes || scenes.length > 0 || colormaps.length > 0 || sizes.length > 0 || blurs || parts.length > 0 || minFaces || layers || carried) {
      const environments = await listEngineEnvironments()
      // The platform hold: this row is shared, and an older platform drops an entry that carries the key.
      const held = (await platformHoldOfFaceMeshMinFaceHeight(maskings, "setting", environments)) ?? platformHoldOfFaceMeshLayers(maskings, environments)
      if (held) return { status: 422, error: held }
      const bodies = hides ? environmentsThatCannotHideBodies(environments) : []
      if (bodies.length > 0) {
        return { status: 409, error: { code: "engine_unsupported", message: cannotHideBodiesMessage(bodies), envs: bodies } }
      }
      const mesh = meshes ? environmentsThatCannotDrawFaceMesh(environments) : []
      if (mesh.length > 0) {
        return { status: 409, error: { code: "engine_unsupported", message: cannotDrawFaceMeshMessage(mesh), envs: mesh } }
      }
      for (const scene of new Set(scenes)) {
        const lacking = TREND_PUBLISH_ENVIRONMENTS.filter((name) => {
          const env = environments.find((e) => e.env === name)
          return !env || !engineTakesScene(env.supports.castSwap, scene)
        })
        if (lacking.length > 0) {
          return {
            status: 409,
            error: {
              code: "engine_unsupported",
              message: `The Cast Swap engine in ${lacking.join(" and ")} cannot take the scene "${scene}" yet, and this setting is shared by every environment: choose another scene, or wait for the engine.`,
              envs: lacking,
            },
          }
        }
      }
      const maps = environmentsThatCannotDrawColormaps(environments, colormaps)
      if (maps.length > 0) {
        return { status: 409, error: { code: "engine_unsupported", message: cannotDrawColormapsMessage(colormaps, maps), envs: maps } }
      }
      const models = environmentsThatCannotDrawModelSizes(environments, sizes)
      if (models.length > 0) {
        return { status: 409, error: { code: "engine_unsupported", message: cannotDrawModelSizesMessage(sizes, models), envs: models } }
      }
      const blur = blurs ? environmentsThatCannotBlurDepth(environments) : []
      if (blur.length > 0) {
        return { status: 409, error: { code: "engine_unsupported", message: cannotBlurDepthMessage(blur), envs: blur } }
      }
      const partsLacking = environmentsThatCannotDrawFaceMeshParts(environments, parts)
      if (partsLacking.length > 0) {
        return { status: 409, error: { code: "engine_unsupported", message: cannotDrawFaceMeshPartsMessage(parts, partsLacking), envs: partsLacking } }
      }
      const layersLacking = layers ? environmentsThatCannotDrawFaceMeshLayers(environments) : []
      if (layersLacking.length > 0) {
        return { status: 409, error: { code: "engine_unsupported", message: cannotDrawFaceMeshLayersMessage(layersLacking), envs: layersLacking } }
      }
      const minFaceLacking = minFaces ? environmentsThatCannotDrawFaceMeshMinFaceHeight(environments) : []
      if (minFaceLacking.length > 0) {
        return { status: 409, error: { code: "engine_unsupported", message: cannotDrawFaceMeshMinFaceHeightMessage(minFaceLacking), envs: minFaceLacking } }
      }
    }
    return null
  },
  readLive: async () => {
    const { motion } = await readNodaroMotionMotion()
    return motion === null ? null : { motion }
  },
})

export function registerNodaroMotionMotionRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/motion", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion Motion setting")
    }
  })

  app.put("/v1/admin/nodaro-motion/motion", { preHandler: requireAdmin }, async (req, reply) => {
    const raw = NODARO_MOTION_MOTION_SECTION.body.safeParse(req.body)
    if (!raw.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(raw.error) } })
    const prepared = NODARO_MOTION_MOTION_SECTION.prepare(raw.data)
    if ("refusal" in prepared) return sendRefusal(reply, prepared.refusal)
    const parsed = { data: prepared.value }
    try {
      const refusal = await NODARO_MOTION_MOTION_SECTION.engineRefusal!(prepared.value, null)
      if (refusal) return sendRefusal(reply, refusal)
      // The Motion overrides already saved are re-checked against the new shape (a mode or prompt style
      // change can leave a part unused, or the prompt too long): any problem refuses the save.
      if (loadedEngineHasPromptParts() && loadedEngineHasPromptStyles()) {
        const saved = (await readNodaroMotionPromptParts()).promptParts
        // A Motion setting with no masking of its own falls back to the engine's masking setting (its face mesh too).
        const preciseMasking = (await readNodaroMotionMasking()).masking
        // Worded as the engine's direct Flex runs are (the new wording is longer).
        const wording = await savedFlexWording()
        const problems: DirectRunPromptProblem[] = []
        for (const engine of NODARO_MOTION_ENGINES) {
          const texts = saved?.[engine]?.motion
          if (!texts) continue
          const found = await directRunPromptProblems(
            app,
            req,
            reply,
            engine,
            "motion",
            texts,
            parsed.data.motion[engine],
            preciseMasking?.[engine],
            undefined,
            promptWordingOf(wording, engine),
          )
          if (!found) return reply
          problems.push(...found)
        }
        if (problems.length > 0) {
          return directRunPromptPartsInvalid(
            reply,
            problems,
            `The saved Motion engine prompt does not fit this setting: ${problems[0]!.message} Change or reset the Motion engine prompt first.`,
          )
        }
      }
      const before = (await readNodaroMotionMotion()).motion
      await saveNodaroMotionMotion(parsed.data.motion, req.userId!)
      await audit(req, "update_nodaro_motion_motion", "app_setting", NODARO_MOTION_MOTION_AUDIT_TARGET, {
        key: NODARO_MOTION_MOTION_KEY,
        before,
        after: parsed.data.motion,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion Motion setting")
    }
  })
}
