/**
 * The workflow lane's palette / moodboard step: a node whose stored
 * `direction` names one of the caller's own (`colorLook: "palette:<id>"`,
 * `style: "moodboard:<id>"`) is resolved HERE, by the node executor, before
 * any jobs row exists — `buildPayload` is synchronous, so what it folds arrives
 * as `PayloadBuildContext.userDirection`. The resolution is the route's own
 * (`resolveUserDirection`), so a single-node run and a workflow run of the
 * same node fold the same clauses and send the same references.
 *
 * WHOSE ROWS: whoever SUPPLIED the value. A published app or a shared workflow
 * runs as the person running it but carries what its owner saved into it, so a
 * value SAVED in the graph the run loaded is read among the workflow owner's
 * rows (`OrchestratorContext.workflowOwnerId`, the rule sub-workflow references
 * follow). Anything else — a run request's `inputOverrides` (an app input, a
 * presentation card), a value that replaced a saved one — is the runner's, read
 * among the runner's rows only: a runner must never be able to name the
 * creator's moodboard and read its images and description back off the job.
 * What was saved is recorded by the orchestrator before it merges the overrides
 * (`savedUserDirectionRefs` → `OrchestratorContext.savedDirectionRefs`); a
 * node that record does not list (an inline sub-workflow's — loaded from the
 * owner's saved graph, never overridden) is the owner's. With no record at all
 * every value is the runner's (fails closed).
 *
 * Only Generate Image takes one; on any other node type the reference is a
 * refusal, never a silent no-op.
 */
import { readDirectionFields } from "@nodaro/prompts/prompt-builder"
import {
  hasUserDirectionRefs,
  resolveUserDirection,
  userDirectionNotSupported,
  userDirectionRefValues,
  type ResolvedUserDirection,
} from "../../lib/user-direction.js"
import type { OrchestratorContext, SimpleNode } from "./types.js"

/** A node error the orchestrator records as is: `message` is the sentence the
 *  person reads, `errorCode` the code (`node-executor.ts`'s coded throws). */
function nodeError(message: string, errorCode: string): Error & { errorCode: string } {
  const err = new Error(message) as Error & { errorCode: string }
  err.errorCode = errorCode
  return err
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/**
 * Per node id, the palette / moodboard values its SAVED direction holds — taken
 * from the graph as loaded, before any run override is merged into it. Every
 * node gets an entry (empty when it names none), so "not listed" means "not a
 * node of this graph".
 */
export function savedUserDirectionRefs(
  nodes: ReadonlyArray<{ id: string; data?: unknown }>,
): Map<string, ReadonlySet<string>> {
  const saved = new Map<string, ReadonlySet<string>>()
  for (const node of nodes) {
    const data = isPlainObject(node.data) ? node.data : undefined
    saved.set(String(node.id), new Set(userDirectionRefValues(data?.direction)))
  }
  return saved
}

export async function userDirectionForNode(
  node: SimpleNode,
  ctx: Pick<OrchestratorContext, "userId" | "workflowOwnerId" | "savedDirectionRefs">,
): Promise<ResolvedUserDirection | undefined> {
  // Every node runs through here, and almost none carries a direction: answer
  // those before touching the prompt package at all.
  const raw = (node.data as Record<string, unknown> | undefined)?.direction
  if (!isPlainObject(raw)) return undefined
  // The same narrow read the builder folds from: what it drops, nothing reads.
  const direction = readDirectionFields(raw)
  if (!hasUserDirectionRefs(direction)) return undefined
  if (node.type !== "generate-image") {
    const refused = userDirectionNotSupported(direction)
    throw nodeError(refused?.error.message ?? "palette and moodboard directions work on generate-image only", "validation_error")
  }
  const owner = ctx.workflowOwnerId ?? ctx.userId
  const record = ctx.savedDirectionRefs
  const savedHere = record?.get(String(node.id))
  const ownersOf = (value: string): readonly string[] => {
    if (record === undefined) return [ctx.userId]
    if (savedHere === undefined) return [owner]
    return savedHere.has(value) ? [owner] : [ctx.userId]
  }
  const outcome = await resolveUserDirection(direction, ownersOf)
  if (!outcome.ok) throw nodeError(outcome.refusal.message, outcome.refusal.code)
  return outcome.value
}
