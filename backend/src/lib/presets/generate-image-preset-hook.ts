/**
 * `presetId` on `POST /v1/generate-image`: the preset is applied to the body
 * the way the editor applies it (`apply-image-preset.ts`), BEFORE the credit
 * guard — the guard prices the model and levers the body names, so it must see
 * the preset's, not the caller's partial body. The rest of the route then sees
 * an ordinary request, exactly the one the editor's Run posts.
 *
 * Explicit fields in the body override the preset; every other field (the
 * caller's references, structured fields, sessionId, origin, `count`, …) is
 * kept — so `count` makes N images of the preset's request.
 *
 * A fan-out (`models`, lib/image-batch.ts) is the preset applied once PER
 * MODEL, through the same `buildGenerateImagePresetBody`, with that model as the
 * explicit `provider` edit on the applied node: each model gets the editor's
 * request for it (its own native-or-folded negative prompt, its own reference
 * gate, its own levers for the route to snap). Those per-model bodies are kept
 * against the request (`presetFanOutBodies`) — never in the body, where a
 * client could write them — for the credit check and the handler to plan each
 * model from; the body itself carries the fan-out's shared fields.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { resolvePreset } from "./resolve-preset.js"
import {
  buildGenerateImagePresetBody,
  PRESET_ASSEMBLY_KEYS,
  PRESET_OVERRIDE_KEYS,
  PresetUserDirectionError,
  PresetVariablesRequiredError,
} from "./apply-image-preset.js"
import { rawImageBatchOf } from "../image-batch.js"

export const presetIdSchema = z.string().min(1).max(200)
export const presetVariablesSchema = z.record(z.string().max(100), z.string().max(2000))
  .refine((v) => Object.keys(v).length <= 50, { message: "At most 50 preset variables" })

const CONSUMED_KEYS = new Set<string>([...PRESET_OVERRIDE_KEYS, ...PRESET_ASSEMBLY_KEYS])

/** Per model of a preset fan-out, the request the preset builds for that model. */
const fanOutBodies = new WeakMap<FastifyRequest, ReadonlyMap<string, Record<string, unknown>>>()

/**
 * The preset's request for each model of this request's fan-out (`presetId` +
 * `models`), keyed by model id — or undefined when the request is not one.
 */
export function presetFanOutBodies(req: FastifyRequest): ReadonlyMap<string, Record<string, unknown>> | undefined {
  return fanOutBodies.get(req)
}

export async function applyGenerateImagePreset(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const body = req.body
  if (!body || typeof body !== "object" || Array.isArray(body)) return
  const { presetId, presetVariables, ...rest } = body as Record<string, unknown>
  if (presetId === undefined) {
    if (presetVariables !== undefined) req.body = rest
    return
  }
  const id = presetIdSchema.safeParse(presetId)
  const vars = presetVariablesSchema.optional().safeParse(presetVariables)
  if (!id.success || !vars.success) {
    return reply.status(400).send({
      error: { code: "validation_error", message: "presetId must be a preset id and presetVariables an object of strings" },
    })
  }

  const preset = await resolvePreset({ nodeType: "generate-image", presetId: id.data, userId: req.userId })
  if (!preset) {
    return reply.status(404).send({ error: { code: "preset_not_found", message: `Preset not found: ${id.data}` } })
  }

  const kept = Object.fromEntries(Object.entries(rest).filter(([k]) => !CONSUMED_KEYS.has(k)))
  // A well-formed fan-out applies the preset per model; anything else
  // (including `models` beside `provider`, which the route refuses) is the
  // one application, as before.
  const models = rawImageBatchOf(rest)?.models
  const built: Record<string, unknown>[] = []
  for (const model of models ?? [undefined]) {
    let one: Record<string, unknown>
    try {
      one = buildGenerateImagePresetBody(preset.data, model === undefined ? rest : { ...rest, provider: model }, vars.data)
    } catch (err) {
      if (err instanceof PresetVariablesRequiredError) {
        return reply.status(400).send({ error: { code: err.code, message: err.message, tokens: err.tokens } })
      }
      if (err instanceof PresetUserDirectionError) {
        return reply.status(400).send({ error: { code: err.code, message: err.message, field: err.field } })
      }
      throw err
    }
    // The editor refuses to run a node whose final prompt is empty (a settings-
    // only preset with no prompt given) — before any credit is held.
    if (typeof one.prompt !== "string" || !one.prompt.trim()) {
      return reply.status(400).send({ error: { code: "no_prompt", message: "This preset ships no prompt — pass prompt." } })
    }
    built.push({ ...kept, ...one })
  }
  if (!models) {
    req.body = built[0]
    return
  }
  fanOutBodies.set(req, new Map(models.map((model, i) => [model, built[i]!])))
  // The request names its models, not one provider: the first model's request,
  // without its provider, carries the shared fields the route validates.
  const { provider: _firstModel, ...shared } = built[0]!
  req.body = shared
}
