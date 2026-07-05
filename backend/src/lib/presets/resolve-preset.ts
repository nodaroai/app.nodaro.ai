import { getFactoryPresets } from "@nodaro/prompts"
import { extractPresetData } from "@nodaro/shared"
import { supabase } from "../supabase.js"

/**
 * One resolved node preset's reusable configuration, regardless of where it came
 * from. `data` is already `extractPresetData`-stripped (no label / runtime / graph
 * keys), so callers can apply it to a node's `data` directly.
 */
export interface ResolvedPreset {
  id: string
  name: string
  description?: string
  group?: string
  nodeType: string
  source: "factory" | "custom"
  /** Tuned config (provider/prompt/aspectRatio/resolution/quality/negativePrompt/…), stripped. */
  data: Record<string, unknown>
}

/**
 * Resolve ONE preset's config by id — the built-in FACTORY catalog first (ids are
 * slugs like `"generate-image/location-board"`), then the caller's own CUSTOM
 * presets (`node_presets`, UUID ids).
 *
 * Security: the custom path REQUIRES `userId` and filters on `user_id` (+ `node_type`),
 * so it can never return another user's preset. With no `userId` only factory presets
 * resolve; a non-factory id with no `userId` returns `null`.
 *
 * Returns `null` when the id resolves to neither.
 */
export async function resolvePreset(args: {
  nodeType: string
  presetId: string
  userId?: string
}): Promise<ResolvedPreset | null> {
  const { nodeType, presetId, userId } = args

  // Factory first (ids are "<nodeType>/<slug>").
  const factory = getFactoryPresets(nodeType).find((p) => p.id === presetId)
  if (factory) {
    return {
      id: factory.id,
      name: factory.name,
      description: factory.description,
      group: factory.group,
      nodeType,
      source: "factory",
      data: extractPresetData(factory.data as Record<string, unknown>),
    }
  }

  // Custom (caller's own; UUID id). Requires userId — never returns another user's preset.
  if (!userId) return null
  const { data, error } = await supabase
    .from("node_presets")
    .select("id,node_type,name,description,data")
    .eq("id", presetId)
    .eq("user_id", userId)
    .eq("node_type", nodeType)
    .maybeSingle()
  if (error || !data) return null
  const row = data as {
    id: string
    name: string
    description: string | null
    data: Record<string, unknown>
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    nodeType,
    source: "custom",
    data: extractPresetData(row.data ?? {}),
  }
}
