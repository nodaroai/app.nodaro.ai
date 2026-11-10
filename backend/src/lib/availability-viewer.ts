import type { FastifyReply, FastifyRequest } from "fastify"
import {
  ADMIN_VIEWER,
  USER_VIEWER,
  availabilityChecksFor,
  deniedNodeRejectionMessage,
  findDeniedNodeTypes,
  isNodeDenied,
  nodeNotAvailableError,
  type AvailabilityViewer,
} from "./surface-deny.js"
import { ROUTE_GATES_GENERATION } from "./availability-override.js"
import { hasAdmin } from "./config.js"
import { childStepNodeType } from "./child-step-node.js"

/**
 * Who is asking? — turns a user id into the `AvailabilityViewer` that
 * lib/surface-deny.ts's node predicates require.
 *
 * ONE DEFINITION OF ADMIN. The answer comes from `checkIsAdmin`, the same
 * lookup that guards every admin route, keyed on the USER and not on the
 * credential: an
 * orchestrator-internal call carries only `body.userId` (no role), and
 * `req.userRole` is stamped on the JWT path alone — keying on either would make
 * an admin's scheduled run or DAG run lose a node their browser session keeps.
 *
 * FAIL-CLOSED. No user id, or a lookup that throws, is a USER: an admin-check
 * outage must narrow availability, never widen it.
 *
 * REVOCATION LAG. `checkIsAdmin` caches its verdict per PROCESS for five
 * minutes, and `invalidateAdminCache` only reaches the process that served the
 * role change — so a demoted admin keeps a withheld node for up to that long
 * on another API replica or in the standalone orchestrator. Same bound as
 * every admin route; what is retained here is the ability to run a node the
 * deployment has not released, not access to anyone's data.
 *
 * NO ADMIN PANEL, NO ADMINS. On an edition without one (`hasAdmin()` false)
 * nobody can have withheld a node and nobody gets the exception, whatever a
 * `profiles.role` cell happens to say.
 *
 * NOT IN surface-deny.ts ON PURPOSE. `admin-check.ts` imports supabase at
 * module scope, and surface-deny's import chain has to stay free of it (see the
 * long note in availability-override.ts). The import below is dynamic for the
 * same reason — this module is reached from middleware/credit-guard.ts, which
 * most route suites load with config and credits mocked.
 *
 * NO LOOKUP ON THE COMMON PATH. Every helper asks the cheap sync question first
 * ("is this node hidden from users at all?") and resolves the admin only when
 * the answer is yes — on a deployment that hides nothing, none of this touches
 * the database.
 */
export async function viewerForUser(userId: string | null | undefined): Promise<AvailabilityViewer> {
  if (!userId) return USER_VIEWER
  try {
    if (!hasAdmin()) return USER_VIEWER
    const { checkIsAdmin } = await import("./admin-check.js")
    return (await checkIsAdmin(userId)) ? ADMIN_VIEWER : USER_VIEWER
  } catch (err) {
    console.error("[availability-viewer] admin lookup failed — treating the caller as a user:", (err as Error).message)
    return USER_VIEWER
  }
}

/** The viewer a check on ONE node type needs (the sync run-time check in
 *  payload-builder receives it through `PayloadBuildContext.viewer`). */
export async function viewerForNode(type: string, userId: string | null | undefined): Promise<AvailabilityViewer> {
  return isNodeDenied(type, USER_VIEWER) ? viewerForUser(userId) : USER_VIEWER
}

/** True when this deployment does not offer `type` to THIS user. */
export async function isNodeDeniedForUser(type: string, userId: string | null | undefined): Promise<boolean> {
  if (!isNodeDenied(type, USER_VIEWER)) return false
  return isNodeDenied(type, await viewerForUser(userId))
}

/**
 * What a node of `hostType`, configured as `data`, may not use for THIS user —
 * the label a refusal names, or undefined. Covers the node's own type and a
 * capability it hosts that another node governs (Web Scrape's Instagram source
 * follows the Instagram node — lib/surface-deny.ts). `data` is the node's data
 * or the direct route's body: same keys. `gateSince` is the asking door's
 * gating generation (`isNodeDenied`).
 */
export async function deniedCapabilityForUser(
  hostType: string,
  data: unknown,
  userId: string | null | undefined,
  gateSince = 0,
): Promise<string | undefined> {
  const hiddenFromUsers = availabilityChecksFor(hostType, data).filter((c) => isNodeDenied(c.governedBy, USER_VIEWER, gateSince))
  if (hiddenFromUsers.length === 0) return undefined
  const viewer = await viewerForUser(userId)
  return hiddenFromUsers.find((c) => isNodeDenied(c.governedBy, viewer, gateSince))?.label
}

/**
 * The refusal label for a request a route runs as ANY of `types` (one, nearly
 * always; Publish to Social's route runs the platform's own post node or the
 * unified one — lib/route-node-gate.ts), or undefined when one of them is
 * available to THIS user. Names the first type's refusal.
 */
export async function deniedRouteCapabilityForUser(
  types: readonly string[],
  data: unknown,
  userId: string | null | undefined,
  gateSince = 0,
): Promise<string | undefined> {
  let first: string | undefined
  for (const type of types) {
    const denied = await deniedCapabilityForUser(type, data, userId, gateSince)
    if (denied === undefined) return undefined
    first ??= denied
  }
  return first
}

/** Marks the preHandler {@link requireNodeAvailable} builds, with the node it asks about. */
export const NODE_AVAILABILITY_GATE: unique symbol = Symbol.for("nodaro.nodeAvailabilityGate")

/**
 * A preHandler that refuses (403 `node_not_available`, the credit guard's
 * shape) when `type` is not available to the caller — for a route that starts
 * a node's run without passing that node's credit guard itself (a trend run is
 * composed here and dispatched to Nodaro Motion, `cast-swap`, as an internal
 * request). Asked as a door of route gating (`ROUTE_GATES_GENERATION`): an
 * override stored before such doors existed never decided it.
 */
export function requireNodeAvailable(
  type: string,
): ((req: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void>) & { readonly [NODE_AVAILABILITY_GATE]: string } {
  // RETURNS the reply on a refusal: in a Fastify async hook that is what halts
  // the lifecycle (a bare `await reply.send()` lets the handler run anyway).
  const gate = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> => {
    // A step a plugin engine's job sends is gated as its parent's node, as the credit guard gates it.
    const childNode = await childStepNodeType(req)
    const denied =
      childNode !== undefined
        ? await deniedCapabilityForUser(childNode, {}, req.userId, ROUTE_GATES_GENERATION)
        : await deniedCapabilityForUser(type, req.body, req.userId, ROUTE_GATES_GENERATION)
    if (denied) {
      return reply.code(403).send({ error: { code: "node_not_available", message: deniedNodeRejectionMessage([denied]) } })
    }
  }
  return Object.assign(gate, { [NODE_AVAILABILITY_GATE]: type })
}

/** Throws the coded `node_not_available` error when this deployment does not
 *  offer this node — or the capability it is configured to use — to THIS user.
 *  The orchestrator's one door (`executeNode`). */
export async function assertNodeAvailableForUser(
  type: string,
  userId: string | null | undefined,
  data?: unknown,
): Promise<void> {
  const denied = await deniedCapabilityForUser(type, data, userId)
  if (denied) throw nodeNotAvailableError([denied])
}

/** The node types in `nodes` this deployment does not offer to THIS user. */
export async function findDeniedNodeTypesForUser(
  nodes: ReadonlyArray<{ type?: unknown }> | undefined,
  userId: string | null | undefined,
): Promise<string[]> {
  const hiddenFromUsers = findDeniedNodeTypes(nodes, USER_VIEWER)
  if (hiddenFromUsers.length === 0) return hiddenFromUsers
  const viewer = await viewerForUser(userId)
  return viewer.admin ? findDeniedNodeTypes(nodes, viewer) : hiddenFromUsers
}
