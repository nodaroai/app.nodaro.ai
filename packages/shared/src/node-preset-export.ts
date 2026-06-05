import { z } from "zod"
import { extractPresetData } from "./node-preset-extract.js"

export const NODE_PRESET_EXPORT_KIND = "nodaro.node-presets" as const

export interface ExportedPreset {
  nodeType: string
  name: string
  description?: string
  data: Record<string, unknown>
}

export interface NodePresetExport {
  kind: typeof NODE_PRESET_EXPORT_KIND
  version: 1
  exportedAt: string
  presets: ExportedPreset[]
}

const exportedPresetSchema = z.object({
  nodeType: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  data: z.record(z.string(), z.unknown()),
})

const envelopeSchema = z.object({
  kind: z.literal(NODE_PRESET_EXPORT_KIND),
  version: z.literal(1),
  exportedAt: z.string().optional().default(""),
  presets: z.array(exportedPresetSchema).max(500),
})

export function buildNodePresetExport(
  presets: ExportedPreset[],
  exportedAtIso: string,
): NodePresetExport {
  return {
    kind: NODE_PRESET_EXPORT_KIND,
    version: 1,
    exportedAt: exportedAtIso,
    presets: presets.map((p) => ({ ...p, data: extractPresetData(p.data) })),
  }
}

/**
 * Validate an unknown parsed-JSON value as a preset export; throws on invalid. Defensively
 * re-strips runtime keys from each preset's data.
 */
export function parseNodePresetExport(input: unknown): NodePresetExport {
  const parsed = envelopeSchema.parse(input)
  return {
    ...parsed,
    presets: parsed.presets.map((p) => ({ ...p, data: extractPresetData(p.data) })),
  }
}
