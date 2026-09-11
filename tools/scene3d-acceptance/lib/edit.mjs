/**
 * The deterministic, unpriced edit — and which lane it has to take.
 *
 * There are TWO deterministic edit paths and they are not interchangeable:
 *
 *  - a v1 Basic scene edits through the `edit-3d-scene` NODE with
 *    `operations`, which the route prices under its `3d-scene-ops` identifier
 *    (zero) rather than an LLM tier;
 *  - a v2 scene — everything the advanced engine authors — is REFUSED by that
 *    route by design (`scene_schema_unsupported`, "select an advanced engine")
 *    and edits through the retained-revision endpoint instead, which applies
 *    overlays arithmetically and creates no job at all.
 *
 * Picking the lane by the plan's own `schemaVersion` is the only way this
 * stays correct as scenes move between versions, and the receipt records which
 * lane ran so a reader never has to guess which of the two "free edit" claims
 * was actually measured.
 */
import { HarnessError, idempotencyKeyFor, submitOnce } from "./client.mjs"
import { followJob, readJobRecord } from "./poll.mjs"

/**
 * A deterministic operation this plan is guaranteed to accept.
 *
 * `visible: true` on an already-visible entity is chosen on purpose: it is a
 * real, persisted overlay (so it proves the lane works and mints a revision)
 * that changes no pixel of the render, so a later render-only export of the
 * ORIGINAL revision is still comparable.
 */
export function deterministicOperationFor(plan) {
  if (plan?.schemaVersion === 2) {
    const entity = (plan.objects ?? []).find(
      (candidate) =>
        (candidate.capabilities === undefined || candidate.capabilities.includes("visibility"))
        && !(candidate.locks ?? []).includes("visibility"),
    )
    if (!entity) {
      throw new HarnessError("this scene has no entity that accepts a visibility overlay", { code: "no_editable_entity" })
    }
    return {
      lane: "retained-revision",
      description: `set-override entity-visibility visible=true on ${entity.id}`,
      operations: [{ op: "set-override", override: { kind: "entity-visibility", entityId: entity.id, visible: true } }],
    }
  }
  if (plan?.schemaVersion === 1) {
    if (typeof plan.backgroundColor !== "string") {
      throw new HarnessError("this v1 scene has no backgroundColor to re-assert", { code: "no_editable_entity" })
    }
    return {
      lane: "basic-edit-node",
      description: `set-background to its current colour ${plan.backgroundColor}`,
      operations: [{ op: "set-background", color: plan.backgroundColor }],
    }
  }
  throw new HarnessError(`unknown scene schema version ${plan?.schemaVersion}`, { code: "unknown_schema" })
}

/**
 * Apply it, through whichever lane the plan requires.
 *
 * Returns `jobId: null` for the retained lane — that absence IS the evidence
 * that nothing was queued and nothing could be charged.
 */
export async function applyDeterministicEdit(client, { plan, runId, label = "edit", pollMs = 3000, timeoutMs = 600_000 }) {
  const chosen = deterministicOperationFor(plan)
  if (chosen.lane === "retained-revision") {
    const contentHash = plan?.provenance?.contentHash
    if (typeof contentHash !== "string" || !/^[0-9a-f]{64}$/.test(contentHash)) {
      throw new HarnessError("this v2 plan carries no canonical content hash — the retained edit cannot be authorized", { code: "no_content_hash" })
    }
    const newRevisionId = crypto.randomUUID()
    const started = Date.now()
    const result = await client.scene3d.applyEdits(plan.revisionId, {
      newRevisionId,
      expectedContentHash: contentHash,
      operations: chosen.operations,
    })
    return {
      lane: chosen.lane,
      description: chosen.description,
      jobId: null,
      requestedRevisionId: newRevisionId,
      elapsedMs: Date.now() - started,
      plan: result?.scenePlan ?? null,
      changeSummary: result?.changeSummary ?? null,
      credits: 0,
      creditStatus: null,
    }
  }

  const started = Date.now()
  const { jobId } = await submitOnce(client, {
    type: "edit-3d-scene",
    params: { scenePlan: plan, expectedRevisionId: plan.revisionId, operations: chosen.operations },
    idempotencyKey: idempotencyKeyFor(runId, label),
  })
  const follow = await followJob(client, jobId, { pollMs, timeoutMs })
  const job = await readJobRecord(client, jobId)
  return {
    lane: chosen.lane,
    description: chosen.description,
    jobId,
    elapsedMs: Date.now() - started,
    terminalStatus: follow.terminalStatus,
    plan: follow.output?.scenePlan ?? null,
    changeSummary: follow.output?.changeSummary ?? null,
    credits: job?.credits ?? null,
    creditStatus: job?.credit_status ?? null,
  }
}
