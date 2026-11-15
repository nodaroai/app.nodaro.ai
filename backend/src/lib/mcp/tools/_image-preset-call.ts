/**
 * `generate_image { presetId }`: the preset applied the way the editor applies
 * it (`lib/presets/apply-image-preset.ts`, the same function
 * `POST /v1/generate-image { presetId }` runs), with the call's explicit fields
 * as edits on the applied node.
 *
 * The account's saved image defaults (`save_image_defaults`) do NOT fill the
 * levers a preset leaves unset: the editor's node defaults do. A preset then
 * runs, and is priced, the same for every account and on every surface, and an
 * unset lever in a preset means the node's default, not one account's pick.
 * Explicit fields still win; saved defaults still apply to a call with no preset.
 */
import type { McpSession } from "../session.js"
import { isAutoAspectToken } from "@nodaro/shared/model-catalog"
import { DEFAULT_REQUEST_IMAGE_LIMIT, refusesImagesOverLimitOn } from "@nodaro/shared/models"
import { normalizeImageInput } from "../normalize.js"
import { structuredReferenceListLimit } from "../../image-input-limit.js"
import { coerceStringArray, MCP_IMAGE_LIST_CEILING, refuseListsOver, resolveRefArray } from "./_verb-helpers.js"
import { resolvePreset } from "../../presets/resolve-preset.js"
import {
  buildGenerateImagePresetBody,
  GENERATE_IMAGE_EDITOR_DEFAULTS,
  PresetUserDirectionError,
  PresetVariablesRequiredError,
} from "../../presets/apply-image-preset.js"

type ToolError = { content: Array<{ type: "text"; text: string }>; isError: true }

function toolError(text: string): ToolError {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

/**
 * `generate_image`'s image lists held to the models the call runs on, before
 * any asset lookup or prompt assembly (decided 2026-11-15). The tool's schema
 * leaves them unbounded, as it always left `reference_image_urls`:
 *
 * - `connected_references` and `reference_order` (`structuredReferenceListLimit`):
 *   a call that runs on any model held to the default limit is refused past
 *   that limit, with the answer the tool's schema gave when it held these
 *   lists to it. A call whose every model has a request image limit of its own
 *   is left to the route, which counts the images it would send and says how
 *   many to remove, up to `MCP_IMAGE_LIST_CEILING` entries. A preset call
 *   cannot leave the default limit to the route: the preset folds the
 *   references into `referenceImageUrls` first, and the assembler would leave
 *   the extra ones out.
 * - `reference_image_urls`, when it is passed on whole (any model the call
 *   runs refuses a request over its limit): up to `MCP_IMAGE_LIST_CEILING`
 *   entries. Otherwise it is cut to the model's limit before its lookups, as
 *   before.
 */
export function checkImageLists(args: Record<string, unknown>, models: readonly string[]): void {
  const structuredMax = structuredReferenceListLimit(models) === DEFAULT_REQUEST_IMAGE_LIMIT ? DEFAULT_REQUEST_IMAGE_LIMIT : MCP_IMAGE_LIST_CEILING
  const passedWhole = referencesPassedWhole(models)
  refuseListsOver("generate_image", {
    connected_references: { entries: args.connected_references as unknown[] | undefined, max: structuredMax },
    reference_order: { entries: args.reference_order as unknown[] | undefined, max: structuredMax },
    ...(passedWhole && args.reference_image_urls !== undefined
      ? { reference_image_urls: { entries: coerceStringArray(args.reference_image_urls, Number.POSITIVE_INFINITY), max: MCP_IMAGE_LIST_CEILING } }
      : {}),
  })
}

/** True when `reference_image_urls` is passed on whole: some model the call runs refuses a request over its limit. */
export function referencesPassedWhole(models: readonly string[]): boolean {
  return models.some((model) => refusesImagesOverLimitOn(model, "request"))
}

/**
 * The call's explicit fields beside a preset, as the route's body names them —
 * every edit except the model / ratio / resolution / quality levers, which the
 * two preset paths coerce against different models. Only what the caller
 * passed: a preset's unset field is the editor's default, never a saved one.
 *
 * `models` are the models the call runs on. When one refuses a request over
 * its image limit (`refusesImagesOverLimitOn`: every model with a request
 * image limit of its own), every reference is passed on and the route refuses
 * a count over it, saying how many to remove, rather than some being left out
 * here (decided 2026-11-14); any other model's references are cut at 14, the
 * route's limit for it, as before. Every list is first held to the same
 * models (`checkImageLists`).
 */
export async function presetCallFields(
  args: Record<string, unknown>,
  session: McpSession,
  models: readonly string[],
): Promise<Record<string, unknown>> {
  checkImageLists(args, models)
  const overrides: Record<string, unknown> = {}
  if (typeof args.prompt === "string" && args.prompt) overrides.prompt = args.prompt
  // Node data like the rest: folded by the preset assembly whether the prompt
  // is the caller's or the preset's.
  if (args.structured !== undefined) overrides.structured = args.structured
  if (args.subject !== undefined) overrides.subject = args.subject
  if (args.connected_references !== undefined) overrides.connectedReferences = args.connected_references
  if (args.described_references !== undefined) overrides.describedReferences = args.described_references
  if (args.reference_order !== undefined) overrides.referenceOrder = args.reference_order
  if (args.base_image_url !== undefined) overrides.baseImageUrl = args.base_image_url
  if (args.mask_url !== undefined) overrides.maskUrl = args.mask_url
  if (args.negative_prompt !== undefined) overrides.negativePrompt = args.negative_prompt
  if (args.strength !== undefined) overrides.strength = args.strength
  if (args.guidance_scale !== undefined) overrides.guidanceScale = args.guidance_scale
  if (args.reference_image_urls !== undefined) {
    overrides.referenceImageUrls = await resolveRefArray(args.reference_image_urls, session.userId, "image", referencesPassedWhole(models) ? MCP_IMAGE_LIST_CEILING : 14)
  }
  return overrides
}

/** The route body for a preset call, or the tool error to return. */
export async function presetImageBody(
  args: Record<string, unknown>,
  session: McpSession,
): Promise<{ body: Record<string, unknown>; refCount: number } | { error: ToolError }> {
  const presetId = args.presetId as string
  const preset = await resolvePreset({ nodeType: "generate-image", presetId, userId: session.userId })
  if (!preset) {
    return { error: toolError(`Preset not found: ${presetId}. List ids with list_node_presets { nodeType: "generate-image" }.`) }
  }

  // This tool never rejects a lever value: the caller's own model / ratio /
  // resolution / quality are coerced to the nearest valid one, against the model
  // that will run (the caller's, else the preset's, else the editor default).
  // Only the fields the caller passed — and no saved defaults.
  const levers = normalizeImageInput(
    { model: args.model as string | undefined, aspect_ratio: args.aspect_ratio as string | undefined, resolution: args.resolution as string | undefined, quality: args.quality as string | undefined },
    {},
    (preset.data.provider as string | undefined) ?? (GENERATE_IMAGE_EDITOR_DEFAULTS.provider as string),
  )
  // `levers.model` is the model that will run, whose image limit the references follow.
  const overrides = await presetCallFields(args, session, [levers.model])
  if (args.model !== undefined) overrides.provider = levers.model
  if (args.aspect_ratio !== undefined) overrides.aspectRatio = isAutoAspectToken(args.aspect_ratio) ? "auto" : levers.aspectRatio
  if (args.resolution !== undefined && levers.resolution !== undefined) overrides.resolution = levers.resolution
  if (args.quality !== undefined && levers.quality !== undefined) overrides.quality = levers.quality

  let built: Record<string, unknown>
  try {
    built = buildGenerateImagePresetBody(preset.data, overrides, args.variables as Record<string, string> | undefined)
  } catch (err) {
    if (err instanceof PresetVariablesRequiredError) return { error: toolError(`${err.message.replace("presetVariables", "variables")}`) }
    // A preset saved with one of the caller's palettes / moodboards: refused, never folded as nothing.
    if (err instanceof PresetUserDirectionError) return { error: toolError(err.message) }
    throw err
  }
  if (!built.prompt) {
    return { error: toolError("A prompt is required (this preset ships none — pass prompt).") }
  }
  const refCount = Array.isArray(built.referenceImageUrls) ? built.referenceImageUrls.length : 0
  return {
    body: {
      ...built,
      mcp_client: session.clientName,
      userId: session.userId,
    },
    refCount,
  }
}
