/**
 * A Generate Image preset, applied the way the editor applies it.
 *
 * The editor writes a preset onto a Generate Image node — the node's defaults,
 * then `presetApplyClearKeys`, then the preset's data (the dropdown's
 * `buildPresetApplyPatch`) — and Run builds the request from that node
 * (`payload-builder.ts` `case "generate-image"`; the frontend single-node Run is
 * held to the same build). This module turns `(preset, the caller's explicit
 * fields, placeholder values)` into the flat `/v1/generate-image` body that
 * build produces, so a preset applied over MCP, the SDK or REST runs the
 * editor's request: the same final prompt, the same native-vs-folded negative
 * prompt, the same levers, the same credit id.
 *
 * It composes with the editor's own functions — `computeNodePrompt` (prompt +
 * pre/post text), `resolveNodeRefs` / `unresolvedRefTokens` (placeholders),
 * `assembleImageInput` (style, negative, references, stored direction) — and
 * re-implements none of them. Levers are passed through unsnapped: the route
 * snaps them with the same `resolveNormalizedImageGen` call the editor's build
 * makes. `generate-image-preset-parity.test.ts` holds every factory preset to
 * the editor's build.
 */
import { assembleImageInput, type AssembleImageInput } from "@nodaro/prompts/assembly"
import { composeNegative, computeNodePrompt, NODE_PROMPT_CANDIDATE_FIELDS } from "@nodaro/prompts/prompt-fields"
import { readDirectionFields, readStructuredFields, readSubjectFields } from "@nodaro/prompts/prompt-builder"
import { PROMPT_PREFIX_KEY, PROMPT_SUFFIX_KEY } from "@nodaro/shared/nodes"
import { canonicalVarName, resolveNodeRefs, unresolvedRefTokens } from "@nodaro/shared/workflow"
import { REFERENCE_RULES, REFERENCE_RULES_MULTI_PERSON } from "@nodaro/prompts/doctrine"
import { backendHybridRoles } from "../reference-format.js"
import { userDirectionRefKey } from "../user-direction-result.js"

const NODE_TYPE = "generate-image"

type AssembleRefs = NonNullable<AssembleImageInput["connectedReferences"]>
type AssembleDescribed = NonNullable<AssembleImageInput["describedReferences"]>

/**
 * The Generate Image node's `defaultData` levers in `NODE_DEFINITIONS`
 * (frontend/src/types/nodes.ts) — what a preset lands on in the editor. A preset
 * that leaves one unset runs on this value there, so it runs on it here too (not
 * on the account's saved MCP image defaults). The parity test reads the
 * frontend definition and fails when the two differ.
 */
export const GENERATE_IMAGE_EDITOR_DEFAULTS: Readonly<Record<string, unknown>> = {
  prompt: "",
  provider: "gpt-image-2",
  style: "",
  aspectRatio: "16:9",
  negativePrompt: "",
}

/** The node data keys a caller may set beside a preset — the route body's own
 *  names. Anything else in the body is not node data and is left alone. */
export const PRESET_OVERRIDE_KEYS = [
  "prompt", PROMPT_PREFIX_KEY, PROMPT_SUFFIX_KEY, "provider", "aspectRatio", "resolution", "quality",
  "negativePrompt", "style", "referenceImageUrls", "referenceImageUrl", "seed", "renderingSpeed", "styleType",
  "expandPrompt", "strength", "guidanceScale", "baseImageUrl", "maskUrl", "direction", "subject", "structured",
] as const

/** Request-only assembly channels (not node data): the route's structured
 *  references. A preset call folds them here, in the same assembly as the
 *  preset, so the route receives one finished prompt and never assembles again. */
export const PRESET_ASSEMBLY_KEYS = ["connectedReferences", "describedReferences", "referenceOrder", "referenceLock"] as const

/** The levers the built body carries, as the editor's build sends them. */
const PASS_THROUGH_LEVERS = [
  "provider", "aspectRatio", "resolution", "quality", "seed", "renderingSpeed", "styleType", "expandPrompt",
  "strength", "guidanceScale", "baseImageUrl", "maskUrl",
] as const

/** A preset whose text names a placeholder with no default and no value given.
 *  The editor refuses the same run ("connect the source node, or give the
 *  reference a default"); off the canvas the way to supply one is a value. */
export class PresetVariablesRequiredError extends Error {
  readonly code = "preset_variables_required"
  constructor(readonly tokens: readonly string[]) {
    super(
      `This preset needs a value for ${tokens.map((t) => `{${t}}`).join(", ")}. ` +
        `Pass them as presetVariables, e.g. { "${tokens[0]}": "…" }.`,
    )
    this.name = "PresetVariablesRequiredError"
  }
}

/**
 * A preset call whose direction names one of the caller's own palettes or
 * moodboards (`palette:<id>` / `moodboard:<id>`) — given with the call, or saved
 * in the preset. This build folds the direction in one synchronous assembly
 * that cannot read the caller's rows, and a user-owned resource is never
 * ignored in silence, so the call is refused. The editor resolves them: a
 * preset applied on a Generate Image node, then run, folds them in the run.
 */
export class PresetUserDirectionError extends Error {
  readonly code = "validation_error"
  constructor(readonly field: string, fromPreset: boolean) {
    super(
      fromPreset
        ? `This preset's ${field} names one of your palettes or moodboards, which a preset call cannot use yet. ` +
          "Apply the preset on a Generate Image node in the editor and run it there, or pass your own direction."
        : `${field}: a palette or moodboard cannot be combined with a preset yet. Send it without presetId.`,
    )
    this.name = "PresetUserDirectionError"
  }
}

/** The editor's node after applying `presetData`, with the caller's explicit
 *  fields on top (an edit made on the applied node). The editor's apply also
 *  clears the keys `presetApplyClearKeys` names; here the preset lands on a fresh
 *  node's defaults, which carry none of them, so there is nothing to clear. */
export function editorNodeData(
  presetData: Readonly<Record<string, unknown>>,
  overrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const explicit = Object.fromEntries(
    PRESET_OVERRIDE_KEYS.filter((k) => overrides[k] !== undefined).map((k) => [k, overrides[k]]),
  )
  return {
    ...GENERATE_IMAGE_EDITOR_DEFAULTS,
    ...presetData,
    ...explicit,
  }
}

function variablesMap(variables: Readonly<Record<string, string>> | undefined): Map<string, string> {
  return new Map(Object.entries(variables ?? {}).map(([k, v]) => [canonicalVarName(k), v]))
}

/**
 * Settle the author-typed prompt fields as the editor's build does (§4.6): a
 * placeholder naming nothing and carrying no default refuses; every other one
 * becomes its value, else its `|| default`. Nothing exists on a canvas here, so
 * the only values are the caller's.
 */
function settlePromptFields(data: Record<string, unknown>, refMap: Map<string, string>): Record<string, unknown> {
  const fields = [...(NODE_PROMPT_CANDIDATE_FIELDS[NODE_TYPE] ?? ["prompt"]), PROMPT_PREFIX_KEY, PROMPT_SUFFIX_KEY]
  const resolvable = new Set(refMap.keys())
  const missing = new Set<string>()
  for (const f of fields) {
    const text = data[f]
    if (typeof text !== "string") continue
    for (const t of unresolvedRefTokens(text, { resolvable, known: new Set() })) missing.add(t)
  }
  if (missing.size > 0) throw new PresetVariablesRequiredError([...missing])
  const settled = { ...data }
  for (const f of fields) {
    if (typeof settled[f] === "string" && settled[f]) settled[f] = resolveNodeRefs(settled[f] as string, refMap)
  }
  return settled
}

/**
 * The flat `/v1/generate-image` body the editor's Run sends for this preset.
 * THROWS `PresetVariablesRequiredError` for a placeholder with no default and no
 * value, and `PresetUserDirectionError` for a direction naming one of the
 * caller's palettes or moodboards. The body carries no `promptPrefix` /
 * `promptSuffix`: they are already in `prompt`, and the route would wrap them a
 * second time.
 */
export function buildGenerateImagePresetBody(
  presetData: Readonly<Record<string, unknown>>,
  overrides: Readonly<Record<string, unknown>> = {},
  variables?: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const refMap = variablesMap(variables)
  const data = settlePromptFields(editorNodeData(presetData, overrides), refMap)
  const provider = data.provider as string
  const negative = typeof data.negativePrompt === "string" && data.negativePrompt && refMap.size > 0
    ? resolveNodeRefs(data.negativePrompt, refMap)
    : (data.negativePrompt as string | undefined)
  // The editor's manual references (`[{ id, url }]`, or plain URLs from the
  // API), else its legacy single `referenceImageUrl` — payload-builder's order.
  const listed = Array.isArray(data.referenceImageUrls)
    ? (data.referenceImageUrls as unknown[])
      .map((r) => (typeof r === "string" ? r : (r as { url?: unknown } | null)?.url))
      .filter((u): u is string => typeof u === "string" && u.length > 0)
    : []
  const refs = listed.length === 0 && typeof data.referenceImageUrl === "string" && data.referenceImageUrl
    ? [data.referenceImageUrl]
    : listed
  const lock = overrides.referenceLock
  const direction = readDirectionFields(data.direction)
  const userRefKey = userDirectionRefKey(direction)
  if (userRefKey !== undefined) {
    throw new PresetUserDirectionError(`direction.${userRefKey}`, overrides.direction === undefined)
  }
  const subject = readSubjectFields(data.subject)
  const structured = readStructuredFields(data.structured)

  const assembled = assembleImageInput({
    userPrompt: computeNodePrompt(NODE_TYPE, data, { refMap, appendWired: true }),
    provider,
    style: typeof data.style === "string" ? data.style : undefined,
    negativePrompt: composeNegative(negative, undefined) || undefined,
    ...(backendHybridRoles() ? { referenceFormat: "hybrid" as const } : {}),
    extraReferenceImageUrls: refs,
    ancestorRefs: [],
    ...(direction !== undefined ? { direction } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(structured !== undefined ? { structured } : {}),
    // The caller's structured references, folded once here (see PRESET_ASSEMBLY_KEYS).
    ...(overrides.connectedReferences !== undefined ? { connectedReferences: overrides.connectedReferences as AssembleRefs } : {}),
    ...(overrides.describedReferences !== undefined ? { describedReferences: overrides.describedReferences as AssembleDescribed } : {}),
    ...(overrides.referenceOrder !== undefined ? { referenceOrder: overrides.referenceOrder as string[] } : {}),
    ...(lock === "standard" || lock === "multi-person"
      ? { referenceLockSnippet: lock === "multi-person" ? REFERENCE_RULES_MULTI_PERSON : REFERENCE_RULES }
      : {}),
  })

  const body: Record<string, unknown> = { prompt: assembled.prompt }
  if (assembled.nativeNegativePrompt) body.negativePrompt = assembled.nativeNegativePrompt
  if (assembled.referenceImageUrls?.length) body.referenceImageUrls = assembled.referenceImageUrls
  for (const k of PASS_THROUGH_LEVERS) if (data[k] !== undefined && data[k] !== "") body[k] = data[k]
  return body
}
