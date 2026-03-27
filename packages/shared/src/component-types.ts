import { INPUT_FIELD_MAP as PRESENTATION_INPUT_MAP } from "./presentation-utils.js"

export interface ComponentHandle {
  id: string
  name: string
  type: "image" | "video" | "audio" | "text"
  required: boolean
  mediaPreview?: boolean
  fieldKey: string
}

export interface ExposedSetting {
  nodeId: string
  field: string
  label: string
  type: "select" | "text" | "number" | "toggle"
  allowedValues?: unknown[]
  defaultValue: unknown
}

export interface ComponentMetadata {
  inputs: ComponentHandle[]
  outputs: ComponentHandle[]
  exposedSettings: ExposedSetting[]
}

/** Maps input node types to their data field key for inputOverrides (derived from presentation-utils) */
export const INPUT_FIELD_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(PRESENTATION_INPUT_MAP).map(([k, v]) => [k, v.key]),
)

/** Maps output media types to NodeOutput field keys */
export const OUTPUT_FIELD_MAP: Record<string, string> = {
  image: "imageUrl",
  video: "videoUrl",
  audio: "audioUrl",
  text: "text",
}

/**
 * Merge exposed settings into inputOverrides format.
 * exposedSettings is keyed by "nodeId:field" -> value on the component node data.
 */
export function mergeExposedSettings(
  inputOverrides: Record<string, Record<string, unknown>>,
  exposedSettings: Record<string, unknown>,
  metadata: ComponentMetadata,
): Record<string, Record<string, unknown>> {
  const merged = { ...inputOverrides }
  for (const setting of metadata.exposedSettings) {
    const key = `${setting.nodeId}:${setting.field}`
    const value = exposedSettings[key]
    if (value !== undefined) {
      merged[setting.nodeId] = { ...merged[setting.nodeId], [setting.field]: value }
    }
  }
  return merged
}
