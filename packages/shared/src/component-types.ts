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
  type: "select" | "text" | "number" | "toggle" | "aspect-ratio"
  allowedValues?: unknown[]
  /** Full option list with labels for select fields (preferred over allowedValues). */
  options?: Array<{ value: string; label: string }>
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

/** Separator used in component handle ids that target a specific port on a sub-workflow-input / sub-workflow-output node. */
export const HANDLE_PORT_SEPARATOR = "::"

/**
 * Split a component handle id of the form `nodeId` or `nodeId::portId`.
 * Returns the literal nodeId when no separator is present.
 */
export function parseHandleId(handleId: string): { nodeId: string; portId?: string } {
  const sep = handleId.indexOf(HANDLE_PORT_SEPARATOR)
  if (sep < 0) return { nodeId: handleId }
  const portId = handleId.slice(sep + HANDLE_PORT_SEPARATOR.length)
  return { nodeId: handleId.slice(0, sep), portId: portId || undefined }
}

/**
 * Apply a value for a component input handle to the inputOverrides map.
 *
 * - Plain handles (id = nodeId) write to `inputOverrides[nodeId][fieldKey]`,
 *   which the orchestrator shallow-merges into `node.data` at execution.
 * - Compound handles (id = nodeId::portId) write into
 *   `inputOverrides[nodeId].__injectedPortValues[portId]`, the slot that
 *   sub-workflow-input nodes read at runtime via output-extractor.
 *
 * Mutates the map in place so multi-port accumulation merges correctly when
 * iterating handles in a loop.
 */
export function applyHandleInputOverride(
  inputOverrides: Record<string, Record<string, unknown>>,
  handle: { id: string; fieldKey: string },
  value: unknown,
): void {
  const { nodeId, portId } = parseHandleId(handle.id)
  if (portId) {
    const existing = (inputOverrides[nodeId]?.__injectedPortValues as Record<string, unknown> | undefined) ?? {}
    inputOverrides[nodeId] = {
      ...inputOverrides[nodeId],
      __injectedPortValues: { ...existing, [portId]: value },
    }
  } else {
    inputOverrides[nodeId] = { ...inputOverrides[nodeId], [handle.fieldKey]: value }
  }
}

/**
 * Has a value already been recorded for this handle in the inputOverrides map?
 * Used to skip fallback wiring when an upstream connection already supplied
 * the input.
 */
export function isHandleInputWired(
  inputOverrides: Record<string, Record<string, unknown>>,
  handle: { id: string; fieldKey: string },
): boolean {
  const { nodeId, portId } = parseHandleId(handle.id)
  if (portId) {
    const injected = inputOverrides[nodeId]?.__injectedPortValues as Record<string, unknown> | undefined
    return injected?.[portId] !== undefined
  }
  return inputOverrides[nodeId]?.[handle.fieldKey] !== undefined
}

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
 *
 * Connected inputs (already present in inputOverrides) always take priority
 * over exposed settings for the same node+field combination.  This ensures
 * that mandatory upstream wires are never silently overwritten by stale
 * default / user-configured exposed-setting values.
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
      // Skip if a connected input already provided this field
      if (merged[setting.nodeId]?.[setting.field] !== undefined) continue
      merged[setting.nodeId] = { ...merged[setting.nodeId], [setting.field]: value }
    }
  }
  return merged
}
