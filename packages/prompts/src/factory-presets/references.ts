import { IMAGE_TOKEN_PATTERN } from "../image-token-pattern.js"
import { getPromptFields, nodeSupportsPromptAffixes, promptAffixCoreField } from "../node-prompt-fields.js"
import { NODE_PROMPT_CANDIDATE_FIELDS } from "../resolve-prompt.js"
import { MODELS_WITH_REFERENCE_IMAGE_SUPPORT, imageReferenceLimit } from "@nodaro/shared/models"

/**
 * The most reference images any image model takes. A preset can never need
 * more than some model could be sent, so a count is clamped to it — a typo
 * like `{image:99999}` must not tell a client to ask for 99,999 photos.
 */
export const MAX_PRESET_REFERENCES: number = Math.max(
  1,
  ...[...MODELS_WITH_REFERENCE_IMAGE_SUPPORT].map((provider) => imageReferenceLimit(provider)),
)

/**
 * The data fields of `nodeType` a reference token can sit in — every field the
 * run reads its prompt from: the candidate fields `computeNodePrompt` joins
 * (`NODE_PROMPT_CANDIDATE_FIELDS` — how a preset's prompt is resolved when it
 * runs, on the canvas and through `presetId` alike), the prompt-field
 * registry's own prompt and negative fields, the field the run wraps with
 * pre/post text, and the pre/post text itself where the node takes it. A node
 * whose prompt lives elsewhere (`llm-chat` → `userInput`) is read where its
 * prompt really is; a type with no prompt (an app namespace) has none.
 */
function promptFieldsOf(nodeType: string): string[] {
  const spec = getPromptFields(nodeType)
  const candidates = NODE_PROMPT_CANDIDATE_FIELDS[nodeType] ?? []
  if (!spec && candidates.length === 0) return []
  const fields = new Set<string>(candidates)
  if (spec) {
    fields.add(spec.prompt)
    if (spec.negative) fields.add(spec.negative)
  }
  const core = promptAffixCoreField(nodeType)
  if (core) fields.add(core)
  if (nodeSupportsPromptAffixes(nodeType)) {
    fields.add("promptPrefix")
    fields.add("promptSuffix")
  }
  return [...fields]
}

/** The highest `{image:N}` / `{image:N:label}` position in `text`, or 0. */
function highestImageToken(text: string): number {
  let highest = 0
  for (const match of text.matchAll(IMAGE_TOKEN_PATTERN)) {
    const n = Number.parseInt(match[1] ?? "", 10)
    if (Number.isInteger(n) && n > highest) highest = n
  }
  return highest
}

/**
 * How many connected reference images a preset works from — 0 for a preset
 * that needs none. A client shows a preset with a non-zero count as "needs a
 * photo" (`needsImage`) and asks for that many before running it.
 *
 * Two sources, and the larger wins:
 *   - the `{image:N}` / `{image:N:label}` tokens in the preset's prompt fields
 *     (the highest N): a template that names its references always reports them;
 *   - `declared` — the factory preset's own `minReferences`, for presets whose
 *     prompt refers to "the attached photo" in words, which no data field marks.
 *     A user preset has no declaration, so its count comes from its tokens.
 *
 * Pure; never throws. A declaration that is not a positive whole number is
 * ignored, and the result is at most {@link MAX_PRESET_REFERENCES}.
 */
export function presetMinReferences(
  nodeType: string,
  data: Readonly<Record<string, unknown>>,
  declared?: number,
): number {
  let count = typeof declared === "number" && Number.isInteger(declared) && declared > 0 ? declared : 0
  for (const field of promptFieldsOf(nodeType)) {
    const value = data[field]
    if (typeof value === "string") count = Math.max(count, highestImageToken(value))
  }
  return Math.min(count, MAX_PRESET_REFERENCES)
}
