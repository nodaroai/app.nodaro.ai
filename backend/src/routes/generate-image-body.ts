/**
 * The request body of `POST /v1/generate-image` — its Zod schema, shared by the
 * route (validation, catalog snap write-back) and its OpenAPI entry. Split out
 * of generate-image.ts so the planner (generate-image-plan.ts) can name the
 * schema without importing the route.
 */
import { z } from "zod"
import { clientOriginSchema } from "../lib/client-origin-schema.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { imageBatchFields, imageBatchIssues } from "../lib/image-batch.js"
import { imageFormatFields, maskFormatConflict } from "../lib/image-format-schema.js"
import { presetIdSchema, presetVariablesSchema } from "../lib/presets/generate-image-preset-hook.js"
import { IMAGE_GEN_PROVIDERS, FLUX_LORA_CHARACTER_MODEL_ID, IMAGE_ASPECT_RATIO_VALUES, IMAGE_RESOLUTION_VALUES, IMAGE_QUALITY_VALUES, IMAGE_BACKGROUND_VALUES, IMAGE_RENDERING_SPEED_VALUES, PROMPT_HARD_CEILING, DEFAULT_REQUEST_IMAGE_LIMIT, MAX_REQUEST_IMAGE_LIMIT, requestImageLimit } from "@nodaro/shared/models"
import { defaultImageModel, pricedSentImages } from "@nodaro/shared/model-catalog"
import { imageInputLimitProblem, structuredReferenceListLimit } from "../lib/image-input-limit.js"
import { generateImageRunModelOfBody } from "../lib/generate-image-run-model.js"
import { connectedReferenceSchema, describedReferenceSchema, DESCRIBED_REFERENCE_LIMIT } from "../lib/connected-reference-schema.js"
import { directionSchema } from "../lib/direction-schema.js"
import { subjectSchema } from "../lib/subject-schema.js"

// The optional cinematic-direction id channel (`@nodaro/prompts`
// `DirectionFields`) that the Studio framing UI, the MCP route and canvas node
// data all speak now lives in `lib/direction-schema.ts` (imported above). Its
// key set is DERIVED from the `DIRECTION_FIELDS` registry table
// rather than hand-listed. This route is its only consumer today;
// `generate-video` has no `direction` field yet and adopts the same schema when
// its channel ships, which is why the schema is surface-agnostic.
// `assembleImageInput` folds the ids into the prompt as hints, in the
// registry's canonical order.

/**
 * Mirror of `@nodaro/shared` `StructuredPromptFields` (Path-1 structured
 * fields). Free-form strings under person / styling / setting / camera / lens /
 * mood — `assembleImageInput` renders them into a prompt fragment.
 */
const structuredPromptFieldsSchema = z.object({
  person: z.object({
    age: z.number().optional(),
    gender: z.enum(["man", "woman", "child", "non-binary"]).optional(),
    hair: z.string().optional(),
    eyes: z.string().optional(),
    expression: z.string().optional(),
    profession: z.string().optional(),
    warriorType: z.string().optional(),
  }).optional(),
  styling: z.object({
    mood: z.string().optional(),
    lighting: z.string().optional(),
    aesthetic: z.string().optional(),
    colorLook: z.string().optional(),
  }).optional(),
  setting: z.object({
    era: z.string().optional(),
    atmosphere: z.string().optional(),
    backdrop: z.string().optional(),
  }).optional(),
  camera: z.object({
    framing: z.string().optional(),
    motion: z.string().optional(),
    format: z.string().optional(),
  }).optional(),
  lens: z.object({
    focalLength: z.string().optional(),
    aperture: z.string().optional(),
  }).optional(),
  mood: z.string().optional(),
})

/** What the API reference says of the two structured lists' bound, read from
 *  the limits themselves (`parseGenerateImageRequest` holds a request to it). */
const STRUCTURED_LIST_BOUND =
  `At most ${MAX_REQUEST_IMAGE_LIMIT} entries when every model the request runs has a request image limit of its own ` +
  `(the images the run would send are then held to that limit, and a request over it is told how many to remove); ` +
  `at most ${DEFAULT_REQUEST_IMAGE_LIMIT} on any other model.`

export const generateImageBody = z.object({
  /** Apply a node preset (factory id or one of yours) as the editor does: its prompt,
   *  pre/post text, style, negative prompt and levers. Explicit fields override it.
   *  Consumed before validation (`applyGenerateImagePreset`); never stored on the job. */
  presetId: presetIdSchema.optional(),
  /** Values for the preset's placeholders that have no default, e.g. { "BRAND": "Acme" }. */
  presetVariables: presetVariablesSchema.optional(),
  /** The client app that sent this request (`GET /v1/jobs?origin=` filters on it). */
  origin: clientOriginSchema.optional(),
  /** Pre & post text wrapped around `prompt` (a preset's words) — the same
   *  join every AI prompt node uses (`applyPromptAffixes`). */
  promptPrefix: z.string().max(PROMPT_HARD_CEILING).optional(),
  promptSuffix: z.string().max(PROMPT_HARD_CEILING).optional(),
  // RELAXED from `.min(1)` to `.min(0)` for WI-1b: in structured mode the user
  // prompt may be empty when `connectedReferences` / `direction` / `structured`
  // fill it. The empty-prompt rejection MOVES post-assembly (a bound entity /
  // direction chip that filled an otherwise-empty prompt still runs; an
  // assembly that produces a truly-empty prompt → 400). The flat path (no
  // structured fields) still effectively requires a prompt because no other
  // input can populate it — see the post-assembly empty check in the handler.
  // Generous ceiling, NOT a per-model reject: the prompt assembler truncates to
  // the provider's verified cap (getMaxImagePromptChars) and the editor warns the
  // user first (warn-don't-block). Per-model enforcement lives in the assembler.
  prompt: z.string().min(0).max(PROMPT_HARD_CEILING),
  /** The prompt as its author typed it, when `prompt` is a version the client
   *  expanded (`{Label}` fields, `{image:N}` references, @-mentions resolved).
   *  Stored on the job (`input_data.userPrompt`) to show what the user wrote;
   *  never sent to the model. Defaults to `prompt`. */
  userPrompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  // Several images in one call: `count` (each its own job) and `models` (the
  // same request on 2–4 models, instead of `provider`) — lib/image-batch.ts.
  ...imageBatchFields,
  // The bound is the largest limit any model has; `parseGenerateImageRequest`
  // holds each model to its own.
  referenceImageUrls: z.array(safeUrlSchema).max(MAX_REQUEST_IMAGE_LIMIT).optional(),
  // ─── WI-1b structured inputs (all optional; ADDITIVE) ────────────────────
  // When ANY of these is present, the route is in "structured mode": it
  // assembles the flat prompt + reference URLs server-side via the shared
  // `assembleImageInput`. When ALL are absent, the route behaves
  // byte-identically to before (the pre-assembled flat-prompt path).
  // Bounded, with `referenceOrder`, at the largest limit any model has; a
  // request on a model held to the default limit is checked against that
  // limit instead (`parseGenerateImageRequest`).
  connectedReferences: z.array(connectedReferenceSchema).max(MAX_REQUEST_IMAGE_LIMIT).optional().describe(STRUCTURED_LIST_BOUND),
  // References the caller NAMED and DESCRIBED but has no media for — an un-bound
  // cast role, an analysis slot. They attach no URL and consume no reference-image
  // budget; the assembler renders them as prose so a name in the prompt reaches
  // the model as a real, described subject. Structured-mode on their own: the
  // normal case (a story landing before any entity exists) sends nothing else.
  describedReferences: z.array(describedReferenceSchema).max(DESCRIBED_REFERENCE_LIMIT).optional(),
  // User-defined reorder of the assembled reference list (stable tile ids),
  // honored by `assembleImageInput`'s reference-order pass — parity with
  // generate-video. No-op without `connectedReferences` (nothing to reorder).
  referenceOrder: z.array(z.string()).max(MAX_REQUEST_IMAGE_LIMIT).optional().describe(STRUCTURED_LIST_BOUND),
  direction: directionSchema.optional(),
  // Structured SUBJECT: catalog IDS for WHO is in the shot (Person / Styling /
  // props), rendered server-side by `renderSubjectHints` and folded AHEAD of
  // the direction clauses — the subject is the noun phrase the cinematography
  // modifies. Same doctrine as `direction`: the wire carries ids, the platform
  // owns the wording, and a client stops baking catalog text it can never
  // un-bake. Absent → byte-identical to today.
  subject: subjectSchema.optional(),
  structured: structuredPromptFieldsSchema.optional(),
  // Reference-lock TOKEN (D5, studio spec 2026-08-30-structured-prompt-assembly):
  // an id, not text — the route maps it to the platform's MEASURED lock wording
  // (reference-rules.ts), so improved wording reaches every client without a
  // client release. "standard" = REFERENCE_RULES (default-deny + likeness +
  // compose; the population winner); "multi-person" = the face-clause variant
  // (reach for it when two faces are in play). Honored by the HYBRID format's
  // lock-snippet slot; inert under legacy (which has no snippet slot) and
  // without references to govern. Free-text lock wording is deliberately NOT
  // accepted on the wire — the wording is platform-owned (D2).
  referenceLock: z.enum(["standard", "multi-person"]).optional(),
  characterDescriptions: z.array(z.string().max(500)).max(10).optional(),
  // `flux-lora-character` is an internal-only provider id selected when a
  // single trained @character is mentioned. It does NOT appear in
  // `IMAGE_GEN_PROVIDERS` (which drives user-facing dropdowns) — instead we
  // accept it via a union and require the paired `_internalLora` hint below.
  provider: z.union([
    z.enum(IMAGE_GEN_PROVIDERS),
    z.literal(FLUX_LORA_CHARACTER_MODEL_ID),
  ]).optional(),
  /**
   * Internal-only hint set by the frontend's single-node Run path (see
   * `execute-node.ts`) when the user runs a generate-image node that
   * references a trained character. NEVER set by SDK/public clients.
   * Required when `provider === FLUX_LORA_CHARACTER_MODEL_ID`.
   *
   * Carries the character row id (NOT the resolved version + trigger) —
   * the route looks up `lora_replicate_version` + `lora_trigger_word`
   * server-side scoped by `req.userId`. Without this lookup, a caller
   * could submit any guessed/leaked Replicate version hash and run
   * inference against ANY trained LoRA.
   */
  _internalLora: z.object({
    characterId: z.string().uuid(),
  }).optional(),
  // ONE shared vocabulary across /v1/generate-image, /v1/image-to-image and
  // /v1/edit-image (`IMAGE_ASPECT_RATIO_VALUES` — the union of every ratio any
  // image model declares, guarded by a catalog-superset test). It is permissive
  // ON PURPOSE: "auto" is gpt-image-2 specific and the banner ratios are Wan
  // 2.7 / Nano Banana 2 Lite specific, and the per-model gate is the catalog
  // snap below, which corrects an unsupported ratio instead of rejecting it.
  aspectRatio: z.enum(IMAGE_ASPECT_RATIO_VALUES).optional(),
  resolution: z.enum(IMAGE_RESOLUTION_VALUES).optional(),
  quality: z.enum(IMAGE_QUALITY_VALUES).optional(),
  /** Image background, on the models that take one (`auto`, `opaque`, `transparent`). */
  background: z.enum(IMAGE_BACKGROUND_VALUES).optional(),
  // The file written (PNG, JPEG, WebP, GIF, SVG) and a GIF's or an SVG's own levers.
  ...imageFormatFields,
  negativePrompt: z.string().max(5000).optional(),
  seed: z.number().int().min(0).optional(),
  renderingSpeed: z.enum(IMAGE_RENDERING_SPEED_VALUES).optional(),
  styleType: z.string().optional(),
  expandPrompt: z.boolean().optional(),
  // Identity injection: when the upstream Character node has its
  // "Inject identity description in downstream prompts" toggle enabled, the
  // frontend / DAG executor passes these so the route appends the character's
  // canonical_description (with an identity-preserve suffix) to the prompt
  // before reservation and worker enqueue. Default off — must be explicit.
  injectCharacterContext: z.boolean().optional().default(false),
  attachToCharacterId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  /** Inpaint base image (the image being edited). With maskUrl, the worker
   *  composites the result's masked region back over this image. */
  baseImageUrl: safeUrlSchema.optional(),
  /** Inpaint mask (white = edit region, black = keep). Requires baseImageUrl. */
  maskUrl: safeUrlSchema.optional(),
  /** i2i strength (gated per provider by I2I_STRENGTH_SUPPORT). */
  strength: z.number().min(0).max(1).optional(),
  /** guidance scale (gated per provider by GUIDANCE_SCALE_SUPPORT). */
  guidanceScale: z.number().min(0).max(20).optional(),
})

/** The models a request runs on, as the rules below read them: its `models`,
 *  else its `provider`, else the default for its ratio. */
function requestModels(data: Pick<GenerateImageData, "models" | "provider" | "aspectRatio">): string[] {
  return data.models?.length ? data.models : [data.provider ?? defaultImageModel("general", data.aspectRatio)]
}

/** The body's cross-field rules: the batch fields' and each model's own image
 *  limit. Shared by both request schemas below. */
function imageRequestRules(data: GenerateImageData, ctx: z.RefinementCtx): void {
  for (const issue of imageBatchIssues(data)) ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message })
  const maskConflict = maskFormatConflict(data)
  if (maskConflict) ctx.addIssue({ code: "custom", path: ["maskUrl"], message: maskConflict })
  const references = data.referenceImageUrls ?? []
  // No model named: the limit of the default the route will run it on.
  for (const model of requestModels(data)) {
    const limit = requestImageLimit(model)
    const sent = pricedSentImages(model, references, data.baseImageUrl)
    if (sent > limit) {
      // A model with a request image limit of its own says how many to
      // remove, the base image counted (`imageInputLimitProblem`); a model
      // held to the default limit keeps its message.
      const message = imageInputLimitProblem(model, sent, "request")?.message ?? `${model} takes at most ${limit} input images`
      ctx.addIssue({ code: "custom", path: ["referenceImageUrls"], message })
      break
    }
  }
}

/** A request whose every model refuses a request over its image limit: the
 *  body's own bounds (the largest limit any model has) and its rules. */
const ownLimitImageRequest = generateImageBody.superRefine(imageRequestRules)

/** A request on any model held to the default limit: the same, with
 *  `connectedReferences` and `referenceOrder` held to the bound they always
 *  had, the default limit. The fields keep their places in the body, so such
 *  a request gets exactly the issues, in the order, it always got. */
const defaultLimitImageRequest = generateImageBody.extend({
  connectedReferences: z.array(connectedReferenceSchema).max(DEFAULT_REQUEST_IMAGE_LIMIT).optional(),
  referenceOrder: z.array(z.string()).max(DEFAULT_REQUEST_IMAGE_LIMIT).optional(),
}).superRefine(imageRequestRules)

/** The model ids the body's `provider` and `models` enums take. */
const ROUTE_IMAGE_MODELS: ReadonlySet<string> = new Set(IMAGE_GEN_PROVIDERS)

/**
 * The models a body not yet validated runs on, to choose its schema: the model
 * each job really runs, as the credit guard judges it
 * (`generateImageRunModelOfBody`: a Character LoRA run runs the
 * trained-character model, a request naming no model the default at its
 * ratio), or a fan-out's `models`. When in doubt it answers a model held to
 * the default limit (`undefined`), so such a body keeps the answer it always
 * got: an id the body's enums would refuse, `provider` or the trained-character
 * hint beside `models` (which the batch rules refuse), or no body at all.
 */
function rawRequestModels(body: unknown): (string | undefined)[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [undefined]
  const record = body as Record<string, unknown>
  const models = Array.isArray(record.models) && record.models.length > 0 ? (record.models as unknown[]) : undefined
  const named = [...(models ?? []), ...(record.provider !== undefined ? [record.provider] : [])]
  if (named.some((model) => typeof model !== "string" || !ROUTE_IMAGE_MODELS.has(model))) return [undefined]
  if (!models) return [generateImageRunModelOfBody(record)]
  if (record.provider !== undefined || "_internalLora" in record) return [undefined]
  return models as string[]
}

/**
 * What the handler validates: the body, its cross-field rules and each model's
 * own image limit. `connectedReferences` and `referenceOrder` are bounded by
 * the models it runs on (`structuredReferenceListLimit`, decided 2026-11-15):
 * at the largest limit any model has when every one of them refuses a request
 * over its own limit (the handler then counts the images the run would send
 * against it), and at the default limit, exactly as before, otherwise.
 * `generateImageBody` stays a plain object — `applySnappedLevers` and the
 * OpenAPI entry read its `shape`.
 */
export function parseGenerateImageRequest(body: unknown) {
  return structuredReferenceListLimit(rawRequestModels(body)) > DEFAULT_REQUEST_IMAGE_LIMIT
    ? ownLimitImageRequest.safeParse(body)
    : defaultLimitImageRequest.safeParse(body)
}

/**
 * The body with its image arrays unbounded, read only to count what a request
 * past their bounds would send (`oversizedImageArraysProblem`): never to run one.
 */
export const unboundedImageArraysBody = generateImageBody.extend({
  connectedReferences: z.array(connectedReferenceSchema).optional(),
  referenceImageUrls: z.array(safeUrlSchema).optional(),
  referenceOrder: z.array(z.string()).optional(),
})

export type GenerateImageData = z.infer<typeof generateImageBody>
