/**
 * Scene3D revision bookkeeping for the canvas.
 *
 * Three invariants live here, all required by the spec and all easy to get
 * wrong inside a poll callback:
 *
 * 1. **Revisions are immutable.** A new plan is APPENDED to `sceneHistory`;
 *    nothing already in the stack is ever rewritten. Restoring is therefore a
 *    pure lookup, and the render job can be pointed at any past revision.
 *
 * 2. **A late job never overwrites a newer manual edit.** An LLM generate/edit
 *    takes seconds; the user keeps scrubbing and nudging objects while it runs.
 *    The job records the revision it was launched against; if the node has
 *    moved on by the time the job lands, the arriving plan is PARKED in
 *    `scenePendingPlan` for the user to adopt, instead of silently discarding
 *    their work.
 *
 * 3. **Nothing the user paid for is thrown away.** Whatever the outcome, the
 *    arriving plan is recorded in history — parking is about which revision is
 *    ACTIVE, never about keeping the result at all.
 */
import type { Scene3DRevisionContext, Scene3DRevisionEntry } from "@/types/nodes"
import { isScene3DAuthoringEngine } from "@nodaro/shared"
import { planRevisionId } from "./plan-view"

/**
 * Keep the stack bounded. A revision holds a WHOLE plan (a few KB with a
 * hundred objects) plus its authoring context, the stack is persisted inside
 * the workflow's JSONB, and a graph can hold several scene nodes — so this is a
 * row-size decision, not a UI one. Twelve covers a working session's undo depth
 * without turning one node into a hundred-KB blob.
 */
export const MAX_SCENE_REVISIONS = 12

export type PushRevisionOptions = {
  changeSummary?: string
  /** What was asked for to produce this revision — restored with it. */
  context?: Scene3DRevisionContext
  /** The job that produced it. Carried so a later run can name the revision
   *  AND the run that authorizes it (3D Render Pro's `scene` source). */
  jobId?: string
  now?: () => string
}

/**
 * Append `plan` as the newest revision. A plan whose `revisionId` is already
 * the newest entry is a no-op (re-running a deterministic edit that produced
 * nothing, or a re-render of the same state, must not grow the stack).
 */
export function pushRevision(
  history: readonly Scene3DRevisionEntry[] | undefined,
  plan: Record<string, unknown>,
  source: Scene3DRevisionEntry["source"],
  options: PushRevisionOptions = {},
): Scene3DRevisionEntry[] {
  const { changeSummary, context, jobId, now = () => new Date().toISOString() } = options
  const revisionId = planRevisionId(plan)
  if (!revisionId) return [...(history ?? [])]
  const existing = history ?? []
  if (existing.length > 0 && existing[existing.length - 1].revisionId === revisionId) {
    return [...existing]
  }
  // A revision id can reappear after a restore-then-edit round trip; keep the
  // stack a SET of revisions so history never shows the same id twice.
  const deduped = existing.filter((entry) => entry.revisionId !== revisionId)
  const entry: Scene3DRevisionEntry = {
    revisionId,
    scenePlan: plan,
    source,
    changeSummary,
    createdAt: now(),
  }
  if (jobId) entry.jobId = jobId
  if (context && Object.keys(context).length > 0) entry.context = context
  const next = [...deduped, entry]
  return next.length > MAX_SCENE_REVISIONS ? next.slice(next.length - MAX_SCENE_REVISIONS) : next
}

export function findRevision(
  history: readonly Scene3DRevisionEntry[] | undefined,
  revisionId: string,
): Scene3DRevisionEntry | undefined {
  return (history ?? []).find((entry) => entry.revisionId === revisionId)
}

/**
 * True when `plan` is `ancestorRevisionId`, or descends from it through
 * `parentRevisionId` links resolvable in the stored history.
 *
 * This is what separates "the user's local nudges on top of the scene we are
 * about to edit" (expected, silent) from "the upstream scene was regenerated
 * and is a different lineage" (worth telling the user, because their revision
 * is about to stop being the active one — it stays restorable in history).
 */
export function descendsFrom(
  plan: Record<string, unknown> | undefined,
  ancestorRevisionId: string,
  history: readonly Scene3DRevisionEntry[] | undefined,
): boolean {
  let current = plan
  // Bounded by the history depth — a malformed parent cycle must not hang the run.
  for (let hop = 0; hop <= MAX_SCENE_REVISIONS && current; hop++) {
    if (planRevisionId(current) === ancestorRevisionId) return true
    const parentId = current.parentRevisionId
    if (typeof parentId !== "string" || parentId.length === 0) return false
    if (parentId === ancestorRevisionId) return true
    current = findRevision(history, parentId)?.scenePlan
  }
  return false
}

export type SceneCompletionInput = {
  /** The plan currently active on the node when the job completed. */
  current: Record<string, unknown> | undefined
  /**
   * The revision that was active when the job was submitted — CAPTURED per job,
   * never re-read from the node (a second run would have overwritten it).
   * `undefined` is a real value: it means "this job started on an empty node".
   */
  baseRevisionId: string | undefined
  /** The plan the job produced. */
  incoming: Record<string, unknown>
  changeSummary?: string
  history: readonly Scene3DRevisionEntry[] | undefined
  source: Scene3DRevisionEntry["source"]
  /** The inputs this job ran with — stored with the revision so a restore
   *  brings the prompt/model/references back with the scene. */
  context?: Scene3DRevisionContext
  /** The job that produced `incoming`, recorded on the revision it becomes. */
  jobId?: string
  now?: () => string
}

export type SceneCompletionResult = {
  /** `adopt` — the incoming plan becomes active. `park` — kept aside, user decides. */
  outcome: "adopt" | "park"
  /** Node-data patch to apply. Always clears the in-flight job bookkeeping. */
  patch: {
    scenePlan?: Record<string, unknown>
    sceneHistory: Scene3DRevisionEntry[]
    scenePendingPlan?: Record<string, unknown>
    changeSummary?: string
    expectedRevisionId?: string
    sceneJobBaseRevisionId: undefined
  }
}

/**
 * Decide what a completed generate/edit job may do to the node.
 *
 * The incoming plan is ALWAYS recorded in history (nothing the user paid for is
 * thrown away) — the only question is whether it also becomes the active scene.
 *
 * The staleness test compares the two revisions INCLUDING `undefined`, which is
 * the whole point: `undefined` is not "unknown", it is "there was no scene".
 * Requiring both sides to be present (the earlier shape) made three real races
 * silently clobber the user —
 *  - job starts on an empty node, a restore or a second job lands a scene while
 *    it runs → base `undefined` ≠ current `r1`, so park;
 *  - job starts on `r1`, the user clears the scene → current `undefined` ≠ base
 *    `r1`, so park (clearing is a decision, not a gap to backfill);
 *  - job starts on an empty node and it is still empty → `undefined` ===
 *    `undefined`, so adopt, which is the ordinary first generation.
 */
export function resolveSceneCompletion(input: SceneCompletionInput): SceneCompletionResult {
  const { current, baseRevisionId, incoming, changeSummary, history, source, context, jobId, now } = input
  const currentRevision = planRevisionId(current)
  const incomingRevision = planRevisionId(incoming)

  // The node moved on while the job ran (manual edit, restore, a second job) —
  // park rather than clobber. An incoming plan with no revision id is parked
  // too: it can't be addressed, so it must not become the active scene.
  const superseded = currentRevision !== baseRevisionId

  if (superseded || !incomingRevision) {
    return {
      outcome: "park",
      patch: {
        sceneHistory: pushRevision(history, incoming, source, { changeSummary, context, jobId, now }),
        scenePendingPlan: incoming,
        sceneJobBaseRevisionId: undefined,
      },
    }
  }

  return {
    outcome: "adopt",
    patch: {
      scenePlan: incoming,
      sceneHistory: pushRevision(history, incoming, source, { changeSummary, context, jobId, now }),
      scenePendingPlan: undefined,
      changeSummary,
      expectedRevisionId: incomingRevision,
      sceneJobBaseRevisionId: undefined,
    },
  }
}

/**
 * The patch for a result that arrived for a run the node has ALREADY moved off
 * (discarded, or replaced by a newer run whose job id the node now points at).
 *
 * It keeps the paid-for revision in history and touches NOTHING else — not
 * `scenePlan`, not `scenePendingPlan`, and above all none of the run-state keys
 * (`executionStatus`, `currentJobId`, `sceneJobBaseRevisionId`), which now
 * belong to the newer run. Writing `resolveSceneCompletion`'s patch here would
 * clear the live job's base revision and re-arm the stale race it exists to
 * prevent.
 */
export function archiveSupersededResult(
  history: readonly Scene3DRevisionEntry[] | undefined,
  incoming: Record<string, unknown>,
  source: Scene3DRevisionEntry["source"],
  options: PushRevisionOptions = {},
): { sceneHistory: Scene3DRevisionEntry[] } | null {
  if (!planRevisionId(incoming)) return null
  const sceneHistory = pushRevision(history, incoming, source, options)
  if (sceneHistory.length === (history ?? []).length && findRevision(history, planRevisionId(incoming)!)) {
    return null // already recorded — nothing to write
  }
  return { sceneHistory }
}

/**
 * Adopt a plan produced by a LOCAL, deterministic edit (a numeric nudge in the
 * panel). Same bookkeeping as a completed job, minus the race — a local edit is
 * by construction based on the currently active revision.
 */
export function adoptLocalRevision(
  history: readonly Scene3DRevisionEntry[] | undefined,
  plan: Record<string, unknown>,
  changeSummary?: string,
  context?: Scene3DRevisionContext,
  now?: () => string,
): {
  scenePlan: Record<string, unknown>
  sceneHistory: Scene3DRevisionEntry[]
  expectedRevisionId: string | undefined
  changeSummary: string | undefined
} {
  const baseRevisionId = typeof plan.parentRevisionId === "string" ? plan.parentRevisionId : undefined
  return {
    scenePlan: plan,
    sceneHistory: pushRevision(history, plan, "manual", {
      changeSummary,
      context: { ...(context ?? {}), ...(baseRevisionId ? { baseRevisionId } : {}) },
      now,
    }),
    expectedRevisionId: planRevisionId(plan),
    changeSummary,
  }
}

/**
 * The authoring context to store with whatever revision a run produces.
 *
 * Read off the node at LAUNCH time, so a restore later brings back the model,
 * effort, references and locks the result was actually authored under — not
 * whatever the panel holds by then. `prompt` is the RAW field value; prompt
 * affixes are node config and are re-applied on the next run.
 */
export function scene3DRunContext(
  data: Record<string, unknown>,
  prompt: string | undefined,
  references: readonly unknown[] | undefined,
  baseRevisionId: string | undefined,
): Scene3DRevisionContext {
  const context: Scene3DRevisionContext = {}
  if (isScene3DAuthoringEngine(data.engine)) context.engine = data.engine
  if (typeof prompt === "string" && prompt.length > 0) context.prompt = prompt
  if (typeof data.llmModel === "string") context.llmModel = data.llmModel
  if (data.reasoningEffort !== undefined) {
    context.reasoningEffort = data.reasoningEffort as Scene3DRevisionContext["reasoningEffort"]
  }
  if (typeof data.advancedMode === "boolean") context.advancedMode = data.advancedMode
  if (typeof data.temperature === "number") context.temperature = data.temperature
  if (typeof data.maxTokens === "number") context.maxTokens = data.maxTokens
  if (references && references.length > 0) {
    context.references = references as Scene3DRevisionContext["references"]
  }
  if (data.referenceRoles && typeof data.referenceRoles === "object") {
    context.referenceRoles = data.referenceRoles as Record<string, string>
  }
  if (data.referenceObjectIds && typeof data.referenceObjectIds === "object") {
    context.referenceObjectIds = data.referenceObjectIds as Record<string, string>
  }
  if (baseRevisionId) context.baseRevisionId = baseRevisionId
  const locked = data.lockedObjectIds
  if (Array.isArray(locked) && locked.length > 0) context.lockedObjectIds = locked as string[]
  const selected = data.selectedObjectIds
  if (Array.isArray(selected) && selected.length > 0) context.selectedObjectIds = selected as string[]
  return context
}

/**
 * The node-data patch that puts a revision's authoring context back.
 *
 * Only keys the revision RECORDED are returned: `updateNodeData` treats an
 * explicit `undefined` as "clear this field", so spreading a context that never
 * captured a model would blank the model the user has selected. A revision
 * written before context existed therefore restores plan-only.
 *
 * `references` is restored as the record of what that run sent — the next run
 * re-resolves the set from the node's live edges, so it is informational.
 * `referenceRoles` / `referenceObjectIds` are the live inputs to that
 * resolution, which is why they are restored as configuration.
 */
export function restoreContextPatch(
  context: Scene3DRevisionContext | undefined,
  promptField: "scenePrompt" | "editPrompt",
): Record<string, unknown> {
  if (!context) return {}
  const patch: Record<string, unknown> = {}
  if (context.engine !== undefined) patch.engine = context.engine
  if (context.prompt !== undefined) patch[promptField] = context.prompt
  if (context.llmModel !== undefined) patch.llmModel = context.llmModel
  if (context.reasoningEffort !== undefined) patch.reasoningEffort = context.reasoningEffort
  if (context.advancedMode !== undefined) patch.advancedMode = context.advancedMode
  if (context.temperature !== undefined) patch.temperature = context.temperature
  if (context.maxTokens !== undefined) patch.maxTokens = context.maxTokens
  if (context.references !== undefined) patch.references = context.references
  if (context.referenceRoles !== undefined) patch.referenceRoles = context.referenceRoles
  if (context.referenceObjectIds !== undefined) patch.referenceObjectIds = context.referenceObjectIds
  if (context.lockedObjectIds !== undefined) patch.lockedObjectIds = context.lockedObjectIds
  if (context.selectedObjectIds !== undefined) patch.selectedObjectIds = context.selectedObjectIds
  return patch
}
