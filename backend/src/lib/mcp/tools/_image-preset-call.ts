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
import { normalizeImageInput } from "../normalize.js"
import { resolveRefArray } from "./_verb-helpers.js"
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
 * The call's explicit fields beside a preset, as the route's body names them —
 * every edit except the model / ratio / resolution / quality levers, which the
 * two preset paths coerce against different models. Only what the caller
 * passed: a preset's unset field is the editor's default, never a saved one.
 */
export async function presetCallFields(args: Record<string, unknown>, session: McpSession): Promise<Record<string, unknown>> {
  const overrides: Record<string, unknown> = {}
  if (typeof args.prompt === "string" && args.prompt) overrides.prompt = args.prompt
  // Node data like the rest: folded by the preset assembly whether the prompt
  // is the caller's or the preset's.
  if (args.structured !== undefined) overrides.structured = args.structured
  if (args.connected_references !== undefined) overrides.connectedReferences = args.connected_references
  if (args.described_references !== undefined) overrides.describedReferences = args.described_references
  if (args.reference_order !== undefined) overrides.referenceOrder = args.reference_order
  if (args.base_image_url !== undefined) overrides.baseImageUrl = args.base_image_url
  if (args.mask_url !== undefined) overrides.maskUrl = args.mask_url
  if (args.negative_prompt !== undefined) overrides.negativePrompt = args.negative_prompt
  if (args.strength !== undefined) overrides.strength = args.strength
  if (args.guidance_scale !== undefined) overrides.guidanceScale = args.guidance_scale
  if (args.reference_image_urls !== undefined) {
    overrides.referenceImageUrls = await resolveRefArray(args.reference_image_urls, session.userId, "image", 14)
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

  const overrides = await presetCallFields(args, session)
  // This tool never rejects a lever value: the caller's own model / ratio /
  // resolution / quality are coerced to the nearest valid one, against the model
  // that will run (the caller's, else the preset's, else the editor default).
  // Only the fields the caller passed — and no saved defaults.
  const levers = normalizeImageInput(
    { model: args.model as string | undefined, aspect_ratio: args.aspect_ratio as string | undefined, resolution: args.resolution as string | undefined, quality: args.quality as string | undefined },
    {},
    (preset.data.provider as string | undefined) ?? (GENERATE_IMAGE_EDITOR_DEFAULTS.provider as string),
  )
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
