/**
 * `presetId` on `POST /v1/generate-image`: the preset is applied to the body
 * the way the editor applies it (`apply-image-preset.ts`), BEFORE the credit
 * guard — the guard prices the model and levers the body names, so it must see
 * the preset's, not the caller's partial body. The rest of the route then sees
 * an ordinary request, exactly the one the editor's Run posts.
 *
 * Explicit fields in the body override the preset; every other field (the
 * caller's references, structured fields, sessionId, origin, …) is kept.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { resolvePreset } from "./resolve-preset.js"
import {
  buildGenerateImagePresetBody,
  PRESET_ASSEMBLY_KEYS,
  PRESET_OVERRIDE_KEYS,
  PresetVariablesRequiredError,
} from "./apply-image-preset.js"

export const presetIdSchema = z.string().min(1).max(200)
export const presetVariablesSchema = z.record(z.string().max(100), z.string().max(2000))
  .refine((v) => Object.keys(v).length <= 50, { message: "At most 50 preset variables" })

const CONSUMED_KEYS = new Set<string>([...PRESET_OVERRIDE_KEYS, ...PRESET_ASSEMBLY_KEYS])

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

  let built: Record<string, unknown>
  try {
    built = buildGenerateImagePresetBody(preset.data, rest, vars.data)
  } catch (err) {
    if (err instanceof PresetVariablesRequiredError) {
      return reply.status(400).send({ error: { code: err.code, message: err.message, tokens: err.tokens } })
    }
    throw err
  }
  // The editor refuses to run a node whose final prompt is empty (a settings-
  // only preset with no prompt given) — before any credit is held.
  if (typeof built.prompt !== "string" || !built.prompt.trim()) {
    return reply.status(400).send({ error: { code: "no_prompt", message: "This preset ships no prompt — pass prompt." } })
  }
  const kept = Object.fromEntries(Object.entries(rest).filter(([k]) => !CONSUMED_KEYS.has(k)))
  req.body = { ...kept, ...built }
}
