// @registry-lookup looks up the label of each node type it is given (NODE_REGISTRY), never the table
/**
 * A use-case run whose built chain holds a step the caller may not run (a
 * node withheld on this deployment — Speaker Map before its release, which a
 * run on several cameras needs) is refused up front, 403, before any row or
 * hold (decided 2026-10-17). Without it the run would start, charge
 * Transcribe and Audio Sync, and fail at that step's own deny check.
 *
 * Asked over the graph the run will execute: the run and estimate routes'
 * prepared graph (after the probes, so a sound-only recording that builds no
 * Speaker Map is never refused for one), and a continuation's remaining steps.
 *
 * Also the one viewer gate of several recordings (decided 2026-10-19,
 * `usecaseMulticamAvailable`): both engines and the estimates read several
 * recordings and a Master audio only for a viewer who may use Speaker Map, so
 * a run of the canvas never reaches these refusals for it; a caller that asks
 * for several itself is refused before anything is probed
 * (`usecaseMulticamDenial`).
 */
import { MULTICAM_SPEAKER_MAP_TYPE, isUseCaseNodeType, usecaseDescriptor, usecaseDistinctMaster, type UseCaseNodeType } from "@nodaro/render-rules"
import { isNodeDeniedForUser } from "../availability-viewer.js"
import { isNodeDenied, USER_VIEWER } from "../surface-deny.js"

/**
 * Whether `userId` may run a use-case node on several recordings or a Master
 * audio (decided 2026-10-19): only while Speaker Map — the step that tells
 * who is on which camera — is available to them (admins, while it is hidden
 * from users). Otherwise a node reads its first recording only, exactly as
 * before multicam (`usecaseRunMaxRecordings`). An answer that cannot be read
 * is "no": the run as before, never a refusal.
 */
export async function usecaseMulticamAvailable(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  try {
    return !(await isNodeDeniedForUser(MULTICAM_SPEAKER_MAP_TYPE, userId))
  } catch {
    return false
  }
}

/**
 * Whether an estimate of `nodes` made for `userId` prices a use-case node on
 * every recording it reads and its Master audio (`WorkflowEstimateOptions.multicam`):
 * the viewer's own answer (`usecaseMulticamAvailable`) — the user a run of
 * that quote would run as (decided 2026-10-19). Asked only when the graph
 * holds a use-case node that can read several; any other graph is priced as it
 * always was, with no availability read.
 */
export async function usecaseMulticamEstimateFor(
  nodes: ReadonlyArray<{ readonly type?: unknown }>,
  userId: string | null | undefined,
): Promise<boolean> {
  return takesSeveralRecordings(nodes) && (await usecaseMulticamAvailable(userId))
}

/**
 * Whether a figure shown to EVERYONE — a published app's, component's or
 * template's stored listing — prices a use-case node of `nodes` on several
 * recordings (decided 2026-10-20): only while Speaker Map is available to a
 * general user, the run any user of the listing would get. Never the
 * publisher's own answer: an admin's listing quotes the one-recording run
 * while Speaker Map is withheld from users, and every listing turns multicam
 * once it is released to all. Sync: the deployment's availability for a
 * user, no per-user read.
 */
export function usecaseMulticamForEveryone(nodes: ReadonlyArray<{ readonly type?: unknown }>): boolean {
  return takesSeveralRecordings(nodes) && !isNodeDenied(MULTICAM_SPEAKER_MAP_TYPE, USER_VIEWER)
}

/** The graph holds a use-case node that can read several recordings. */
function takesSeveralRecordings(nodes: ReadonlyArray<{ readonly type?: unknown }>): boolean {
  return nodes.some((n) => typeof n.type === "string" && isUseCaseNodeType(n.type) && usecaseDescriptor(n.type).maxRecordings > 1)
}

/**
 * The refusal for a request that asks for several recordings or a Master audio
 * itself (a REST, SDK or MCP caller: both engines send one recording to a
 * viewer who may not run several) while Speaker Map is not available to its
 * caller, or null (decided 2026-10-19). Asked before anything is probed.
 */
export async function usecaseMulticamDenial(
  type: UseCaseNodeType,
  body: { readonly mediaUrls: readonly string[]; readonly masterAudioUrl?: string },
  userId: string,
): Promise<UseCaseInnerDenial | null> {
  const asks = body.mediaUrls.length > 1 || !!usecaseDistinctMaster(body.masterAudioUrl, body.mediaUrls)
  if (!asks || (await usecaseMulticamAvailable(userId))) return null
  return {
    status: 403,
    code: "node_not_available",
    message: `${usecaseDescriptor(type).label} on several recordings or with a Master audio is not available on this deployment yet. Send one recording.`,
  }
}

export interface UseCaseInnerDenial {
  readonly status: 403
  readonly code: "node_not_available"
  readonly message: string
}

/** The node types' names as the node list shows them (the registry's labels); a type it does not know, as written. */
async function labelsOf(types: readonly string[]): Promise<string[]> {
  // Loaded only to word a refusal: the registry is large and a refusal is rare.
  const { NODE_REGISTRY } = await import("../node-registry.js")
  return types.map((t) => NODE_REGISTRY.find((n) => n.type === t)?.label ?? t)
}

/** The refusal for running `nodes` (a use-case node of `type`'s chain, or the part of it a continuation runs) as `userId`, or null. */
export async function usecaseInnerDenial(
  type: UseCaseNodeType,
  nodes: ReadonlyArray<{ readonly type: string }>,
  userId: string,
): Promise<UseCaseInnerDenial | null> {
  const denied: string[] = []
  for (const t of new Set(nodes.map((n) => n.type))) if (await isNodeDeniedForUser(t, userId)) denied.push(t)
  if (denied.length === 0) return null
  const names = (await labelsOf(denied)).join(", ")
  const verb = denied.length > 1 ? "are" : "is"
  return {
    status: 403,
    code: "node_not_available",
    message: `${usecaseDescriptor(type).label} needs ${names} for this run, which ${verb} not available on this deployment.`,
  }
}
