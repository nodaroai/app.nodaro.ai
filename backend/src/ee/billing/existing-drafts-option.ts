/**
 * The `existingDrafts` option of a whole-workflow estimate made for one
 * caller's run (decided 2026-11-13): every surface that quotes a workflow for
 * the user who would run it — `POST /v1/credits/estimate-workflow` (the API
 * and MCP estimate), `GET /v1/api/schema`, a shared workflow's page and a
 * Component's estimate — prices a Seedance 2.5 HD finalize of a draft that
 * already exists exactly, as the finalize's own gate prices that draft for
 * that user, as the editor and the run-set estimates already do; never at the
 * provider's 8 s row.
 *
 * The pricer is `existingDraftFinalizePricer` (seedance-draft-finalize-credits.ts),
 * loaded only when an estimate asks it for a price — a graph with such a
 * finalize, on an edition with credits — so a route that builds the option
 * stays free of the draft lookup's imports.
 */
import type { ExistingDraftFinalizePricer, WorkflowEstimateOptions } from "./credits.js"

/**
 * The most distinct drafts one estimate prices exactly: each is a lookup of
 * the draft's job, and these routes take a caller's graph, so a graph of
 * thousands of finalizes would otherwise make thousands of lookups per
 * request. The drafts past it are priced as before, at the provider's row.
 */
export const EXISTING_DRAFTS_PRICED_PER_ESTIMATE = 20

/**
 * The `existingDrafts` option for an estimate of `userId`'s run: that user's
 * own drafts, priced exactly — the first {@link EXISTING_DRAFTS_PRICED_PER_ESTIMATE}
 * distinct ones the estimate asks for (in the graph's order); the rest as
 * before. No user (an anonymous viewer) runs no draft of their own, so the
 * option is left out and the finalize is priced as before. A pricer that
 * cannot be loaded prices nothing (the estimate quotes the finalize as
 * before), as the pricer does for a draft it cannot price.
 *
 * Build one per estimate: the cap counts the drafts this option is asked for.
 */
export function existingDraftsFor(userId: string | null | undefined): Pick<WorkflowEstimateOptions, "existingDrafts"> {
  if (!userId) return {}
  let pricer: Promise<ExistingDraftFinalizePricer> | undefined
  const asked = new Set<string>()
  const priceOf: ExistingDraftFinalizePricer = async (taskId) => {
    // Counted before any await, so the drafts priced are the first ones asked for.
    if (!asked.has(taskId)) {
      if (asked.size >= EXISTING_DRAFTS_PRICED_PER_ESTIMATE) return undefined
      asked.add(taskId)
    }
    try {
      pricer ??= import("./seedance-draft-finalize-credits.js").then((m) => m.existingDraftFinalizePricer(userId))
      return await (await pricer)(taskId)
    } catch (err) {
      console.warn("[seedance-draft-finalize] could not load the existing-draft pricer; the estimate quotes the finalize as before:", err)
      return undefined
    }
  }
  return { existingDrafts: { priceOf } }
}
