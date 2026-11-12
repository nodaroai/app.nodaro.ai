/**
 * Who reaches a published app or component on a deployment that does not allow
 * public work (`outputs.allowPublic: false`, `surfaceAllowsPublicOutputs`),
 * decided 2026-11-11. There an app or a component is its creator's alone:
 *
 *  - an app's page (`GET /v1/app/:slug`, an admin keeps a preview, as on a
 *    template's page), its social card and its embed answer everyone else as
 *    for an app that does not exist;
 *  - starting, resuming, restoring or re-rendering a run of someone else's app
 *    is refused the same way (a person's own past runs stay readable);
 *  - a component runs for its creator, and for the ORCHESTRATOR lane — a full
 *    run of a workflow that holds the component node, whoever owns the
 *    component (`parentExecutionIdOf`: the node executor's internal call names
 *    its execution). Any other caller — MCP `run_component`, a direct call, the
 *    editor's "Run this node" — is answered as for a component that does not
 *    exist.
 *
 * With public work allowed every check here returns before reading anything,
 * so every answer is what it was. `lib/__tests__/public-outputs-reads-totality.test.ts`
 * holds each route and tool that serves an app or a component to these checks.
 */
import type { FastifyRequest } from "fastify"
import { supabase } from "./supabase.js"
import { surfaceAllowsPublicOutputs } from "./surface-profile.js"
import { hasAdmin } from "./config.js"
import { checkIsAdmin } from "./admin-check.js"
import { parentExecutionIdOf } from "./concurrency-lanes/parent-execution.js"

/** The answer for an app that does not exist, as the app routes give it. */
export const APP_NOT_FOUND = { error: { code: "not_found", message: "App not found" } } as const

/** Whether the signed-in viewer is a platform admin; false on a failed lookup (it must never widen access). */
async function viewerIsAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId || !hasAdmin()) return false
  try {
    return await checkIsAdmin(userId)
  } catch {
    return false
  }
}

/** With the row in hand: whether the app or component of `creatorId` is withheld from `userId`. */
export function publishedAppWithheld(userId: string | undefined, creatorId: unknown): boolean {
  if (surfaceAllowsPublicOutputs()) return false
  return !userId || typeof creatorId !== "string" || userId !== creatorId
}

/**
 * By its slug: whether the app is withheld from `userId`. One read of the
 * slug's creator, and only when public work is not allowed. An unknown slug is
 * withheld too — the route answers it as missing either way, so the answer
 * cannot tell the two apart. `adminPreview` lets an admin through (the page only).
 */
export async function publishedAppSlugWithheld(slug: string, userId: string | undefined, opts: { adminPreview?: boolean } = {}): Promise<boolean> {
  if (surfaceAllowsPublicOutputs()) return false
  const { data } = await supabase
    .from("published_apps")
    .select("creator_id")
    .eq("slug", slug)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle()
  const creatorId = (data as { creator_id?: unknown } | null)?.creator_id
  if (!publishedAppWithheld(userId, creatorId)) return false
  return !(opts.adminPreview && data && (await viewerIsAdmin(userId)))
}

/**
 * By a run of the runner's own (`app_runs.id`, `runner_id`): whether the app
 * that run belongs to is withheld from them. For a route that acts on a run
 * without reading its app (Restore). A run that is not theirs is left to the
 * route, which answers it as missing as it always has.
 */
export async function publishedAppRunWithheld(runId: string, userId: string): Promise<boolean> {
  if (surfaceAllowsPublicOutputs()) return false
  const { data } = await supabase
    .from("app_runs")
    .select("published_apps!app_id(creator_id)")
    .eq("id", runId)
    .eq("runner_id", userId)
    .maybeSingle()
  const app = (data as { published_apps?: { creator_id?: unknown } | null } | null)?.published_apps
  if (!app) return false
  return publishedAppWithheld(userId, app.creator_id)
}

/**
 * A component, with its row in hand: withheld unless the caller is its creator
 * or the call is the orchestrator's run of a workflow node
 * (`parentExecutionIdOf`, believed on the internal lane only).
 */
export function componentWithheld(req: Pick<FastifyRequest, "headers" | "authKind" | "userId">, creatorId: unknown): boolean {
  if (surfaceAllowsPublicOutputs()) return false
  if (parentExecutionIdOf(req) !== undefined) return false
  return publishedAppWithheld(req.userId, creatorId)
}
