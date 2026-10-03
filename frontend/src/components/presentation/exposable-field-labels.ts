import type { MessageKey, TFunction } from "@/lib/i18n"

/**
 * The published-app field cards render a node's exposable field by its
 * `ExposableField.label` — the English string in `NODE_DEFINITIONS`
 * `exposableFields`. This maps each of those labels to the dictionary key the
 * config panels already use for the same field, so the card reads in the
 * interface language. Every key's English is byte-identical to the label it
 * replaces (guarded by `__tests__/exposable-field-labels.test.ts`, which also
 * fails when a node definition gains a field label that is not listed here).
 *
 * Labels that are not listed — the per-slot fields a motion-graphics plan
 * derives at run time — pass through unchanged.
 */
export const EXPOSABLE_FIELD_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  "Model": "field.model",
  "Aspect Ratio": "field.aspectRatio",
  "Quality": "field.quality",
  "Negative Prompt": "field.negativePrompt",
  "Style": "field.style",
  "Prompt": "present.prompt",
  "Duration (seconds)": "field.durationSeconds",
  "Duration (s)": "scriptcfg.durationS",
  "Resolution": "field.resolution",
  "Generate Audio": "vidcfg.generateAudio",
  "No background music": "present.fieldNoBackgroundMusic",
  "Span Start (seconds)": "present.spanStartSeconds",
  "Span End (seconds)": "present.spanEndSeconds",
  "Mode": "field.mode",
  "Motion": "field.motion",
  "Stability": "field.stability",
  "Similarity": "audiocfg.similarity",
  "Instrumental": "audiocfg.instrumental",
  "Loudness": "audiocfg.loudness",
  "Engine": "node.engine",
  "System Prompt": "settings.systemPrompt",
  "User Prompt": "txtcfg.userPromptLabel",
  "Temperature": "audiocfg.temperature",
  "Max Tokens": "txtcfg.maxTokens",
}

/** An exposable field's label in the interface language; unknown labels pass through. */
export function localizeExposableFieldLabel(label: string, t: TFunction): string {
  const key = EXPOSABLE_FIELD_LABEL_KEYS[label]
  return key ? t(key) : label
}
