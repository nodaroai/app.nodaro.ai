import type { FastifyReply, FastifyRequest } from "fastify"
import { requireAppScope } from "../scope-prehandler.js"

/**
 * Who may change a user's node presets (create, update, delete, import,
 * reorder, favorites, groups): the editor's browser session, the user's own
 * personal API key, and an OAuth app the user granted `assets:write` — the
 * scope that covers every other write to the user's own library (saved posts,
 * collections, sessions). Reads stay on `presets:read`.
 *
 * Refused, and before anything is written:
 *   - an OAuth app without `assets:write` (`requireAppScope`);
 *   - the deployment's billing integration key — a machine credential for the
 *     billing surface only. The auth hook already confines it to
 *     `/v1/deployment-billing/`; refusing it here too keeps that a second,
 *     independent defence;
 *   - a personal key limited to some workflows, by the root guard
 *     (middleware/token-workflow-scope.ts): these routes declare no
 *     `workflowScope`, so such a key never reaches them. Keep it that way.
 */
async function refuseBillingKey(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  if (req.billingKey) {
    return reply.status(403).send({
      error: { code: "forbidden", message: "A billing integration key cannot change node presets." },
    })
  }
}

export const presetWriteAccess = [refuseBillingKey, requireAppScope("assets:write")]

/**
 * Per-credential write rate. Twice the 30 a minute the other library writes
 * allow, because the editor drives these interactively — a reorder on every
 * drop in the Manage dialog, a favorite on every star — and a person tidying
 * their presets must never meet a 429.
 */
export const PRESET_WRITE_LIMIT = { rateLimit: { max: 60, timeWindow: "1 minute" } }
/** A bulk import writes up to 500 presets in one call. */
export const PRESET_IMPORT_LIMIT = { rateLimit: { max: 10, timeWindow: "1 minute" } }
