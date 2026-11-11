import type { FastifyReply, FastifyRequest } from "fastify"
import { FILM_PIPELINE_FEATURE } from "./availability-override.js"
import { requireNodeAvailable } from "./availability-viewer.js"

/**
 * The film pipeline's availability door for a pipeline route family
 * (routes/pipelines.ts, routes/scene-helpers.ts): `film-pipeline` is a
 * gateable feature (lib/availability-override.ts), listed in `nodes.allow` /
 * `nodes.deny` and Admin → Availability like a node.
 *
 * Every POST starts or continues a pipeline's work (creation, branch, fork,
 * approvals, edits, regenerations, retries, stage chat, scene helpers), so
 * every POST except `/cancel` is refused with the credit guard's 403
 * `node_not_available` while this deployment does not offer the feature to the
 * caller — registered as the family's FIRST preHandler, so before any other
 * check and before anything is reserved. GETs, the PATCH that switches a run
 * to manual (it only stops auto-approving) and `/cancel` pass, so a pipeline
 * started before the feature was withheld can still be followed and stopped.
 * On a deployment with no node lists and no override nothing here refuses.
 *
 * A request is not the only way a pipeline goes on: an auto-mode run, the
 * reconcile cron and a resume drive it with none. The engine asks the same
 * question before every stage it runs (ee/pipelines/engine.ts), as the
 * workflow orchestrator asks a node's availability before each node.
 */
export function filmPipelineAvailabilityHook(): (req: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void> {
  const gate = requireNodeAvailable(FILM_PIPELINE_FEATURE)
  return async (req, reply) => {
    if (req.method !== "POST") return
    const route = req.routeOptions?.url ?? req.url.split("?")[0] ?? ""
    if (route.endsWith("/cancel")) return
    return gate(req, reply)
  }
}
