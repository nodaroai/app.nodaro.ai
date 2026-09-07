/**
 * Reference conditioning for Scene3D authoring — and the ONE place every rule
 * about references lives.
 *
 * The point of a reference is that it CHANGES the scene: an appearance image
 * should move colours AND silhouette, a layout image should move placement, a
 * motion clip should move timing. So references are not summarised into an
 * adjective — they ride the request as real multimodal input, through the
 * platform's existing machinery:
 *
 *  - IMAGES go to the model as content blocks (`lib/anthropic-image.ts`
 *    prefetch → base64, URL pass-through on any failure), exactly like the
 *    image-critic and prompt-helper routes. Each block is preceded by its OWN
 *    label (id, role, object scope) so the model can tell reference "hero-ref"
 *    from reference "set-ref" — a numbered list ahead of the images is not
 *    enough once one of them is filtered out.
 *  - VIDEO goes through the platform's `video-analysis` job. The route creates
 *    that child as the caller (so its duration policy, its price and its
 *    refusals are the plugin's, in one place), the worker waits for it, and
 *    the analysis JSON is composed into the authoring input here.
 *
 * Everything a reference list can be WRONG about is decided by
 * `scene3DReferenceListError` below, and by nothing else. The route calls it
 * before a row exists, the orchestrator's `payload-builder` calls it before it
 * returns a payload (which is before the reservation), and both ingress paths
 * therefore refuse the same lists with the same sentences. A second copy of
 * these rules beside either caller is how the two paths drift.
 */
import {
  SCENE3D_LIMITS,
  getLlmModalityCaps,
  scene3DPlanSchema,
  stripDerivedAnalysisFields,
  type Scene3DPlan,
  type Scene3DReference,
  type VideoAnalysisResult,
} from "@nodaro/shared"
import { prefetchAsBase64 } from "../../lib/anthropic-image.js"
import type { LlmContentBlock } from "../../lib/llm-client.js"

const ROLE_INSTRUCTION: Record<Scene3DReference["role"], string> = {
  // Silhouette and proportion are the POINT of an appearance reference in a
  // grey-box previz: the palette is one line of the answer, but "how tall and
  // how bulky does this thing read" is what the blocking pass is for.
  appearance:
    "match what it looks like — its palette and materials, and just as much its silhouette and proportions (how tall, how wide, how bulky each thing reads against the others)",
  layout: "match how it places things in space — the staging, not the pixels",
  motion: "match its timing and camera movement",
}

/**
 * ONE video reference per request.
 *
 * Not an arbitrary number: the platform's cancel path reads a SINGULAR
 * `input_data.analysisJobId` (`lib/cancel-job.ts`), so a second child would be
 * left running — and billing — when the parent is cancelled. Lifting the cap
 * means teaching that path about a list first.
 */
export const SCENE3D_MAX_VIDEO_REFERENCES = 1

/**
 * How many images one authoring call attaches: the contract's whole reference
 * ceiling, so nothing a caller supplied is ever dropped in silence.
 *
 * It used to be four, which meant a request carrying the eight references the
 * public contract advertises had half of them quietly disappear — the model
 * conditioned on a different scene than the caller described and nothing said
 * so. If this ever has to be lower than `maxReferences` again, the excess must
 * be REFUSED at the route, not skipped here.
 */
export const SCENE3D_MAX_IMAGE_REFERENCES = SCENE3D_LIMITS.maxReferences

/** A video window we can actually honour: the whole clip. */
function isFullClipWindow(reference: Scene3DReference): boolean {
  return (reference.startSeconds === undefined || reference.startSeconds === 0) && reference.endSeconds === undefined
}

/**
 * Every rule that needs the whole list. Returns the sentence to refuse with,
 * or `undefined` when the list is usable.
 *
 * Note what is NOT here: `objectId` on a generate. A brief may legitimately
 * say "this reference is the hero" before the hero exists — the authoring
 * prompt requires the model to create an object with that id, and the shared
 * plan validator refuses the finished scene if it did not. That is a rule
 * about the PLAN, and it is enforced exactly once, where the plan is.
 */
export function scene3DReferenceListError(references: readonly Scene3DReference[]): string | undefined {
  const ids = new Set<string>()
  for (const reference of references) {
    if (ids.has(reference.id)) return `duplicate reference id "${reference.id}"`
    ids.add(reference.id)
    // These two are plan-LEVEL rules in the contract (`scene3DPlanIssues`), so
    // the reference schema alone lets them through — and the server is what
    // stamps them onto the plan. Catching them here is the difference between
    // a 400 the caller can fix and a job that burns its whole revision budget
    // on a field the model never wrote.
    if (reference.kind === "image" && (reference.startSeconds !== undefined || reference.endSeconds !== undefined)) {
      return `reference "${reference.id}" is an image; a time window applies to video only`
    }
    if (
      reference.startSeconds !== undefined &&
      reference.endSeconds !== undefined &&
      reference.endSeconds <= reference.startSeconds
    ) {
      return `reference "${reference.id}" ends at or before it starts`
    }
    // v1 analyses the WHOLE clip. The analysis route takes no time window, so a
    // request naming one would be analysed end to end anyway — and a field that
    // is accepted, stored on the plan and then ignored is worse than one that
    // is refused, because nothing downstream can tell the two apart.
    if (reference.kind === "video" && !isFullClipWindow(reference)) {
      return `reference "${reference.id}" asks for a time window; 3D scene references analyse the whole clip in v1 — trim the video first (POST /v1/trim-video) and reference the trimmed result`
    }
  }
  if (references.length > SCENE3D_LIMITS.maxReferences) {
    return `At most ${SCENE3D_LIMITS.maxReferences} references are supported; this request has ${references.length}.`
  }
  const videos = references.filter((r) => r.kind === "video").length
  if (videos > SCENE3D_MAX_VIDEO_REFERENCES) {
    return `At most ${SCENE3D_MAX_VIDEO_REFERENCES} video reference is supported; attach the rest as images.`
  }
  return undefined
}

/**
 * Why this model cannot condition on these references, or `undefined`.
 *
 * Checked BEFORE any reservation on both ingress paths: attaching an image to
 * a text-only model is a block the provider drops on the floor, so the job
 * would bill an LLM tier for a scene authored from the brief alone and the
 * caller would never learn its references had no effect.
 */
export function scene3DImageModalityError(
  llmModel: string,
  references: readonly Scene3DReference[],
): string | undefined {
  if (!references.some((r) => r.kind === "image")) return undefined
  if (getLlmModalityCaps(llmModel).image) return undefined
  return `Model "${llmModel}" cannot read images, and this request has image references. Choose a vision-capable model, or remove the image references.`
}

/**
 * The reference set an edit produces: the plan's own references, with the
 * request's merged in BY ID — a supplied reference replaces the one that
 * carries its id, and everything else survives.
 *
 * This is what makes references cumulative across a chain of edits: reference
 * "hero-ref" attached on edit 1 is still on the plan (and still conditions the
 * model) on edit 5, and edit 5 can repoint it by sending the same id.
 * Order is stable — kept references hold their position, genuinely new ones
 * are appended in the order they arrived.
 */
export function mergeScene3DReferences(
  existing: readonly Scene3DReference[] | undefined,
  incoming: readonly Scene3DReference[] | undefined,
  replace = false,
): Scene3DReference[] {
  if (replace) return [...(incoming ?? [])]
  const supplied = new Map((incoming ?? []).map((r) => [r.id, r]))
  const merged: Scene3DReference[] = []
  const taken = new Set<string>()
  for (const reference of existing ?? []) {
    const replacement = supplied.get(reference.id)
    merged.push(replacement ?? reference)
    taken.add(reference.id)
  }
  for (const reference of incoming ?? []) {
    if (!taken.has(reference.id)) merged.push(reference)
  }
  return merged
}

/**
 * Stamp a reference list onto a plan. Absent rather than empty when there is
 * nothing to say — `draftToScene3DPlan` omits the key the same way, so a plan
 * with no references has one shape, not two.
 *
 * Deliberately NOT validated here: the caller re-validates the WHOLE plan
 * afterwards, which is where a reference pointing at an object that the same
 * edit just removed (or has yet to add) is decided.
 */
export function withScene3DReferences(plan: Scene3DPlan, references: readonly Scene3DReference[]): Scene3DPlan {
  const next = { ...plan }
  if (references.length === 0) delete next.references
  else next.references = [...references]
  return next
}

/** The plan as `applyScene3DEditOperations` should see it: references removed,
 *  so an operation list is judged on geometry alone and a reference bound to an
 *  object the SAME list adds is not rejected before that operation runs. */
export function withoutScene3DReferences(plan: Scene3DPlan): Scene3DPlan {
  const next = { ...plan }
  delete next.references
  return next
}

/** Re-validate a plan after its references were stamped on. Returns the
 *  contract's own sentence, so a refusal reads the same wherever it surfaces. */
export function scene3DReferenceBindingError(plan: Scene3DPlan): string | undefined {
  const validated = scene3DPlanSchema.safeParse(plan)
  if (validated.success) return undefined
  const issue = validated.error.issues[0]
  if (!issue) return "the edit would leave the scene invalid"
  const path = issue.path.map(String).join(".")
  return path ? `${path}: ${issue.message}` : issue.message
}

/**
 * The references one authoring call actually PRESENTS.
 *
 * Presented, not requested: a video is presented only when its analysis is in
 * hand (an inherited video reference from an earlier revision has none, and
 * describing it would invite the model to "match reference 3" from nothing).
 * Images are presented up to `SCENE3D_MAX_IMAGE_REFERENCES`, which is the
 * contract's own ceiling — so on the supported path the presented set IS the
 * requested set.
 */
export function scene3DPresentedReferences(args: {
  references: readonly Scene3DReference[]
  /** The video reference the analysis describes, if any. */
  analyzedReferenceId?: string
  analysis?: VideoAnalysisResult
}): { images: Scene3DReference[]; video?: Scene3DReference } {
  const images = args.references.filter((r) => r.kind === "image").slice(0, SCENE3D_MAX_IMAGE_REFERENCES)
  if (!args.analysis) return { images }
  const videos = args.references.filter((r) => r.kind === "video")
  const video = args.analyzedReferenceId ? videos.find((r) => r.id === args.analyzedReferenceId) : videos[0]
  return { images, ...(video ? { video } : {}) }
}

/** One reference's label — the same sentence in the summary list and beside
 *  the image block itself, so the two can never describe different things. */
export function scene3DReferenceLabel(reference: Scene3DReference): string {
  const scope = reference.objectId ? `, applies to object "${reference.objectId}"` : ""
  return `REFERENCE "${reference.id}" (${reference.kind}, ${reference.role}${scope}) — ${ROLE_INSTRUCTION[reference.role]}`
}

/** The prose half: what each PRESENTED reference is for, in the order the
 *  model meets it. */
export function describeScene3DReferences(references: readonly Scene3DReference[]): string {
  if (references.length === 0) return ""
  const lines = references.map((reference, index) => `${index + 1}. ${scene3DReferenceLabel(reference)}`)
  return `REFERENCES (in the order they are presented below)\n${lines.join("\n")}`
}

/**
 * Build the user message. Text first, then each attached image behind its own
 * label, then the video analysis — the order the model reads them in, and the
 * order the reference list above numbers them in.
 *
 * A model with no image modality is NOT handled by quietly dropping the
 * images: the caller checks `scene3DImageModalityError` before reserving, so
 * reaching this function with an unreadable attachment is a bug, and it throws
 * rather than authoring a scene the references had no part in.
 */
export async function buildScene3DUserContent(args: {
  text: string
  references: readonly Scene3DReference[]
  llmModel: string
  analysis?: VideoAnalysisResult
  analyzedReferenceId?: string
}): Promise<LlmContentBlock[]> {
  const { images, video } = scene3DPresentedReferences(args)
  if (images.length > 0) {
    const modalityError = scene3DImageModalityError(args.llmModel, images)
    if (modalityError) throw new Error(modalityError)
  }
  const presented = [...images, ...(video ? [video] : [])]

  const blocks: LlmContentBlock[] = []
  const description = describeScene3DReferences(presented)
  blocks.push({ type: "text", text: description ? `${args.text}\n\n${description}` : args.text })

  // Sequential, not Promise.all: each may re-encode a multi-megabyte image
  // through sharp. Each image is introduced by its own label because a
  // provider flattens these blocks into one stream — without it, "reference 2"
  // in the list above is only positionally tied to the second picture.
  for (const image of images) {
    blocks.push({ type: "text", text: scene3DReferenceLabel(image) })
    blocks.push(await prefetchAsBase64(image.url))
  }

  if (args.analysis) {
    // Compact, like the llm-structured worker: a long analysis pretty-printed
    // approaches the platform's LLM text ceiling and the whitespace carries
    // nothing.
    const heading = video ? `VIDEO REFERENCE ANALYSIS for "${video.id}" (JSON)` : "VIDEO REFERENCE ANALYSIS (JSON)"
    blocks.push({
      type: "text",
      text: `${heading}\n${JSON.stringify(stripDerivedAnalysisFields(args.analysis))}`,
    })
  }

  return blocks
}
