/**
 * Scene3D authoring — the two LLM calls, and the revision loop around them.
 *
 * `llmCompleteStructured` already retries a SHAPE failure (the model returned
 * something the draft schema rejects). What it cannot see is the semantic
 * layer: a parent cycle, a keyframe past the end of the scene, an operation
 * that touches a locked object. Those are decided by the SHARED validator
 * (`scene3DPlanSchema` / `applyScene3DEditOperations`) after the parse, and a
 * single-shot failure there would burn the whole job. So this file wraps the
 * call in a bounded revision loop that hands the refusal back to the model in
 * its own words and asks again.
 *
 * The edit lane never lets the model write a plan. It writes OPERATIONS, and
 * `applyScene3DEditOperations` — the same function the deterministic lane
 * calls — decides whether they are allowed. Locks are therefore enforced on
 * the model's output by construction, not by asking it nicely.
 */
import {
  applyScene3DEditOperations,
  newScene3DRevisionId,
  scene3DPlanSchema,
  summarizeScene3DOperations,
  type LlmReasoningEffort,
  type Scene3DEditOperation,
  type Scene3DEditResult,
  type Scene3DPlan,
  type Scene3DReference,
  type VideoAnalysisResult,
} from "@nodaro/shared"
import { llmCompleteStructured, type LlmMessage } from "../../lib/llm-client.js"
import { LLM_ROUTE_DEFAULTS } from "@nodaro/shared"
import {
  draftToScene3DPlan,
  scene3DDraftEditSchema,
  scene3DDraftPlanSchema,
  toEditOperations,
} from "./scene3d-draft.js"
import { scene3DEditSystemPrompt, scene3DGenerateSystemPrompt } from "./scene3d-prompts.js"
import {
  buildScene3DUserContent,
  mergeScene3DReferences,
  scene3DImageModalityError,
  scene3DReferenceBindingError,
  withScene3DReferences,
  withoutScene3DReferences,
} from "./scene3d-references.js"

/** Authoring a 100-object scene with keyframe tracks is a long generation;
 *  the structured route raised its own ceiling for the same reason. */
export const SCENE3D_LLM_TIMEOUT_MS = 240_000

/** How many times the model may be told "that scene is invalid, here is why".
 *  Two: one honest mistake is common, a second on the SAME correction means
 *  the brief and the contract genuinely disagree and failing is the honest
 *  outcome (the job refunds). */
export const SCENE3D_MAX_REVISIONS = 2

export interface Scene3DAuthoringUsage {
  inputTokens: number
  outputTokens: number
  providerCost?: number
}

export interface Scene3DAuthoringResult extends Scene3DAuthoringUsage {
  plan: Scene3DPlan
  changeSummary?: string
  /** How many extra attempts the semantic layer cost. 0 on a clean first pass. */
  revisions: number
}

interface CommonInput {
  llmModel: string
  reasoningEffort?: LlmReasoningEffort
  references: Scene3DReference[]
  analysis?: VideoAnalysisResult
  /** Which video reference `analysis` describes. Absent = the first one. */
  analyzedReferenceId?: string
}

export interface GenerateScenePlanInput extends CommonInput {
  prompt: string
  width: number
  height: number
  fps: number
  durationInFrames: number
  /** Pinned by the caller so the job row and the plan agree on identity. */
  revisionId?: string
}

export interface EditScenePlanInput extends CommonInput {
  plan: Scene3DPlan
  instruction: string
  lockedObjectIds: string[]
  selectedObjectIds: string[]
  revisionId?: string
}

function routeParams() {
  const defaults = LLM_ROUTE_DEFAULTS["3d-scene"] ?? {}
  return { temperature: defaults.temperature, maxTokens: defaults.maxTokens }
}

/** The scene as the model sees it on an edit: everything except our identity
 *  bookkeeping, which it must not echo back. */
function planForModel(plan: Scene3DPlan): string {
  const { revisionId: _revisionId, parentRevisionId: _parentRevisionId, ...rest } = plan
  return JSON.stringify(rest)
}

function firstIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
    .join("; ")
}

/** Append the refusal as a user turn so the next attempt sees exactly what
 *  was wrong. Roles alternate (Anthropic rejects two user turns in a row), so
 *  the model's own output goes back as the assistant turn between them. */
function withRefusal(messages: LlmMessage[], previous: unknown, refusal: string): LlmMessage[] {
  return [
    ...messages,
    { role: "assistant", content: JSON.stringify(previous) },
    {
      role: "user",
      content: `That was rejected: ${refusal}\n\nFix exactly that and return the corrected answer. Change nothing else.`,
    },
  ]
}

/**
 * Author a NEW scene. The render frame (size, fps, duration) comes from the
 * request and is stamped here — the model only describes the scene, so it
 * cannot produce a 90-second "4-second" previz.
 */
export async function generateScenePlan(input: GenerateScenePlanInput): Promise<Scene3DAuthoringResult> {
  // Both ingress paths refuse this before reserving; failing here rather than
  // dropping the attachments keeps "the references had no effect" from being
  // a thing that can happen quietly.
  const modalityError = scene3DImageModalityError(input.llmModel, input.references)
  if (modalityError) throw new Error(modalityError)
  const brief = [
    `BRIEF\n${input.prompt}`,
    `FRAME\n${input.width}x${input.height} at ${input.fps} fps, ${input.durationInFrames} frames (${(
      input.durationInFrames / input.fps
    ).toFixed(2)}s). Every keyframe must be an integer in 0..${input.durationInFrames - 1}.`,
  ].join("\n\n")

  let messages: LlmMessage[] = [
    {
      role: "user",
      content: await buildScene3DUserContent({
        text: brief,
        references: input.references,
        llmModel: input.llmModel,
        analysis: input.analysis,
        analyzedReferenceId: input.analyzedReferenceId,
      }),
    },
  ]

  const usage: Scene3DAuthoringUsage = { inputTokens: 0, outputTokens: 0 }
  let lastRefusal = ""

  for (let attempt = 0; attempt <= SCENE3D_MAX_REVISIONS; attempt++) {
    const completion = await llmCompleteStructured(
      {
        modelId: input.llmModel,
        system: scene3DGenerateSystemPrompt(),
        messages,
        reasoningEffort: input.reasoningEffort,
        timeoutMs: SCENE3D_LLM_TIMEOUT_MS,
        ...routeParams(),
      },
      scene3DDraftPlanSchema,
      { schemaName: "scene3d_plan" },
    )
    usage.inputTokens += completion.inputTokens
    usage.outputTokens += completion.outputTokens
    if (completion.providerCost != null) usage.providerCost = (usage.providerCost ?? 0) + completion.providerCost

    const candidate = draftToScene3DPlan(completion.output, {
      revisionId: input.revisionId ?? newScene3DRevisionId(),
      width: input.width,
      height: input.height,
      fps: input.fps,
      durationInFrames: input.durationInFrames,
      references: input.references,
    })
    const validated = scene3DPlanSchema.safeParse(candidate)
    if (validated.success) {
      return { ...usage, plan: validated.data as Scene3DPlan, revisions: attempt }
    }
    lastRefusal = firstIssues(validated.error)
    messages = withRefusal(messages, completion.output, lastRefusal)
  }

  throw new Error(`3D scene authoring failed validation after ${SCENE3D_MAX_REVISIONS + 1} attempts: ${lastRefusal}`)
}

/**
 * Edit an existing scene from an instruction.
 *
 * The model answers with operations; `applyScene3DEditOperations` is what
 * accepts or refuses them — including the locks, which are checked AFTER the
 * model has spoken and are not negotiable. A refusal is fed back once or
 * twice, because "you touched a locked object" is exactly the kind of mistake
 * a model corrects when told.
 */
export async function editScenePlan(input: EditScenePlanInput): Promise<Scene3DAuthoringResult> {
  // The set the model is shown AND the set the produced revision carries: the
  // plan's own references with this request's merged in by id. Computed once,
  // here, so the conditioning and the persisted plan cannot disagree.
  const references = mergeScene3DReferences(input.plan.references, input.references)
  const modalityError = scene3DImageModalityError(input.llmModel, references)
  if (modalityError) throw new Error(modalityError)
  const context = [
    `INSTRUCTION\n${input.instruction}`,
    `CURRENT SCENE (JSON)\n${planForModel(input.plan)}`,
    `FRAME\n${input.plan.width}x${input.plan.height} at ${input.plan.fps} fps, ${input.plan.durationInFrames} frames. Every keyframe must be an integer in 0..${input.plan.durationInFrames - 1}.`,
    input.lockedObjectIds.length > 0
      ? `LOCKED (must not change in any way): ${input.lockedObjectIds.join(", ")}`
      : "LOCKED: nothing",
    input.selectedObjectIds.length > 0
      ? `SELECTED (what the user is looking at — this is what "it"/"this" refers to, not permission to change anything else): ${input.selectedObjectIds.join(", ")}`
      : "SELECTED: nothing",
  ].join("\n\n")

  let messages: LlmMessage[] = [
    {
      role: "user",
      content: await buildScene3DUserContent({
        text: context,
        references,
        llmModel: input.llmModel,
        analysis: input.analysis,
        analyzedReferenceId: input.analyzedReferenceId,
      }),
    },
  ]

  const usage: Scene3DAuthoringUsage = { inputTokens: 0, outputTokens: 0 }
  let lastRefusal = ""

  for (let attempt = 0; attempt <= SCENE3D_MAX_REVISIONS; attempt++) {
    const completion = await llmCompleteStructured(
      {
        modelId: input.llmModel,
        system: scene3DEditSystemPrompt(),
        messages,
        reasoningEffort: input.reasoningEffort,
        timeoutMs: SCENE3D_LLM_TIMEOUT_MS,
        ...routeParams(),
      },
      scene3DDraftEditSchema,
      { schemaName: "scene3d_edit" },
    )
    usage.inputTokens += completion.inputTokens
    usage.outputTokens += completion.outputTokens
    if (completion.providerCost != null) usage.providerCost = (usage.providerCost ?? 0) + completion.providerCost

    const converted = toEditOperations(completion.output.operations)
    if (converted.ok) {
      const applied = applyScene3DEditWithReferences({
        plan: input.plan,
        operations: converted.operations,
        references: input.references,
        expectedRevisionId: input.plan.revisionId,
        lockedObjectIds: input.lockedObjectIds,
        ...(input.revisionId ? { revisionId: input.revisionId } : {}),
      })
      if (applied.ok) {
        return {
          ...usage,
          plan: applied.plan,
          changeSummary: completion.output.changeSummary.trim() || applied.changeSummary,
          revisions: attempt,
        }
      }
      lastRefusal = applied.message
    } else {
      lastRefusal = converted.message
    }
    messages = withRefusal(messages, completion.output, lastRefusal)
  }

  throw new Error(`3D scene edit was refused after ${SCENE3D_MAX_REVISIONS + 1} attempts: ${lastRefusal}`)
}

/**
 * Apply operations AND settle the reference set — the one transition both edit
 * lanes go through.
 *
 * Order is the whole point:
 *
 * 1. Operations are applied to the plan with its references STRIPPED. The
 *    contract validates a plan's references against its objects, so judging
 *    them before the operations run would refuse `add-object "car"` paired
 *    with a reference scoped to `"car"` — a combination the authoring prompt
 *    explicitly asks for.
 * 2. The merged set (`mergeScene3DReferences`) is stamped onto the result.
 * 3. The WHOLE plan is re-validated, which is what decides object bindings
 *    against the objects the edit actually left behind: a reference pointing
 *    at an object this edit removed is refused here, in the contract's own
 *    words, and on the instruction lane that refusal goes back to the model.
 *
 * The alternative — letting `applyScene3DEditOperations` carry the references
 * through untouched — is what made new edit references vanish: the result was
 * derived from the SOURCE plan, so a reference the caller had just paid to
 * attach was never on the revision it produced.
 */
export function applyScene3DEditWithReferences(args: {
  plan: Scene3DPlan
  operations: readonly Scene3DEditOperation[] | unknown
  /** The request's references. Merged into the plan's by id. */
  references?: readonly Scene3DReference[]
  expectedRevisionId?: string
  lockedObjectIds?: readonly string[]
  revisionId?: string
}): Scene3DEditResult {
  // Staleness is judged against the plan the caller handed in, before anything
  // is stripped — `applyScene3DEditOperations` compares against the plan it is
  // given and the stripped copy carries the same revisionId, so this is only
  // spelled out here because the two must never come apart.
  const applied = applyScene3DEditOperations(withoutScene3DReferences(args.plan), args.operations, {
    ...(args.expectedRevisionId ? { expectedRevisionId: args.expectedRevisionId } : {}),
    ...(args.lockedObjectIds ? { lockedObjectIds: args.lockedObjectIds } : {}),
    ...(args.revisionId ? { revisionId: args.revisionId } : {}),
  })
  if (!applied.ok) return applied

  const references = mergeScene3DReferences(args.plan.references, args.references)
  const plan = withScene3DReferences(applied.plan, references)
  const bindingError = scene3DReferenceBindingError(plan)
  if (bindingError) {
    return { ok: false, code: "invalid_plan", message: `the edit would leave the scene invalid — ${bindingError}` }
  }
  return { ...applied, plan }
}

/**
 * The DETERMINISTIC lane: the caller supplied operations, so there is nothing
 * to author. Kept here beside the LLM lane so both edit paths are one import
 * away from each other and neither can quietly grow its own lock or reference
 * handling.
 */
export function applyDeterministicScene3DEdit(args: {
  plan: Scene3DPlan
  operations: readonly Scene3DEditOperation[]
  references?: readonly Scene3DReference[]
  expectedRevisionId?: string
  lockedObjectIds?: readonly string[]
  revisionId?: string
}): Scene3DEditResult {
  return applyScene3DEditWithReferences(args)
}

export { summarizeScene3DOperations }
