import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { supabase } from "../lib/supabase.js"
import { sendInternalError } from "../lib/http-errors.js"
import { extractWorkflowId } from "../lib/request-helpers.js"
import { isAnonymousRoute } from "./auth.js"

/**
 * Personal API keys limited to some workflows (`api_tokens.workflow_ids`).
 *
 * Such a key is for running those workflows: it may run them, read them and
 * their inputs, and follow their runs. That is what the API docs promise ("a
 * scoped token can run and inspect only those workflows, and any other
 * workflow answers 403 forbidden"), and everything else answers 403 too.
 *
 * The refusal is the structure, not a list. A route reaches a limited key
 * only by declaring, in its own registration, which workflow it touches:
 *
 *     app.get("/v1/workflows/:id", { config: { workflowScope: { workflowParam: "id" } } }, handler)
 *
 * so a route added tomorrow (a private plugin's included) stays closed to a
 * limited key until someone decides otherwise. A key with no workflows listed
 * is the account's full-access key and passes untouched, as do browser
 * sessions, app tokens, billing keys and internal calls.
 *
 * Routes that take no credential at all treat a limited key as no key: the
 * request goes on as an anonymous one. Refusing it would protect nothing (the
 * same request without the header is answered anyway), and keeping the key's
 * identity would hand those routes' signed-in extras to it (your app runs on
 * `/v1/app/:slug/runs`, for one).
 *
 * Runs before every route's own preHandlers (a root hook, registered right
 * after the auth hook), so a refused run reserves no credits and writes no row.
 * Behavior: `__tests__/token-workflow-scope.test.ts`; which real routes are
 * declared: `__tests__/token-workflow-scope-routes.test.ts`.
 */
export type WorkflowScope =
  /** The workflow id is this path parameter, and must be one of the key's. */
  | { readonly workflowParam: string }
  /** A run id is this path parameter: a workflow run, or a single-node job
   *  (the run routes answer for both). The workflow it ran must be one of the
   *  key's. */
  | { readonly executionParam: string }
  /** The handler applies the key's list itself: it narrows a list to it, or
   *  checks a workflow id it reads from the body or query
   *  (`limitedKeyWorkflows`). */
  | "handler"

declare module "fastify" {
  interface FastifyContextConfig {
    /** How a personal API key limited to some workflows may use this route.
     *  Undeclared = refused for such a key (middleware/token-workflow-scope.ts). */
    workflowScope?: WorkflowScope
  }
}

/** The workflows the caller's key is limited to, or null when the caller is
 *  not a limited key (any other credential, or a key with no list). */
export function limitedKeyWorkflows(req: FastifyRequest): readonly string[] | null {
  if (req.authKind !== "api_token") return null
  const ids = req.apiToken?.workflowIds ?? []
  return ids.length > 0 ? ids : null
}

export const LIMITED_KEY_MESSAGE =
  "This API key is limited to specific workflows, and this request is outside them. " +
  "Use a key without a workflow limit for anything else."

export function refuseLimitedKey(reply: FastifyReply): FastifyReply {
  return reply.status(403).send({ error: { code: "forbidden", message: LIMITED_KEY_MESSAGE } })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function paramOf(req: FastifyRequest, name: string): string | undefined {
  const value = (req.params as Record<string, unknown> | undefined)?.[name]
  return typeof value === "string" ? value : undefined
}

type RunLookup = { readonly workflowId: string | null } | "not_found" | { readonly error: unknown }

/** The workflow a run of this user's ran: a workflow run first, then a
 *  single-node job (the same two places the run routes read). */
async function workflowOfRun(runId: string, userId: string): Promise<RunLookup> {
  for (const table of ["workflow_executions", "jobs"] as const) {
    const { data, error } = await supabase
      .from(table)
      .select("workflow_id")
      .eq("id", runId)
      .eq("user_id", userId)
      .maybeSingle()
    if (error) return { error }
    if (data) return { workflowId: (data as { workflow_id: string | null }).workflow_id }
  }
  return "not_found"
}

/** Must be registered after the auth hook, which identifies the key. */
export function registerTokenWorkflowScopeGuard(app: FastifyInstance): void {
  app.addHook("preHandler", async (req, reply) => {
    const allowed = limitedKeyWorkflows(req)
    if (!allowed) return
    // No route matched: the 404 answer is the same for every caller.
    if (!req.routeOptions.url) return

    const scope = req.routeOptions.config?.workflowScope
    if (!scope) {
      if (isAnonymousRoute(req.method, req.url)) {
        req.userId = undefined
        req.authKind = undefined
        req.apiToken = undefined
        return
      }
      return refuseLimitedKey(reply)
    }

    // A route the key may use can still be handed another workflow in the
    // body (`workflowId`, which hooks after this one read, the sequence guard
    // among them): only one of the key's.
    const named = extractWorkflowId(req.body)
    if (named !== null && !allowed.includes(named)) return refuseLimitedKey(reply)

    if (scope === "handler") return
    if ("workflowParam" in scope) {
      const id = paramOf(req, scope.workflowParam)
      if (id !== undefined && allowed.includes(id)) return
      return refuseLimitedKey(reply)
    }
    const runId = paramOf(req, scope.executionParam)
    const found = runId !== undefined && UUID.test(runId) ? await workflowOfRun(runId, req.userId!) : "not_found"
    if (found === "not_found") {
      return reply.status(404).send({ error: { code: "not_found", message: "Execution not found" } })
    }
    if ("error" in found) return sendInternalError(reply, req, found.error, "Failed to check the execution")
    if (found.workflowId !== null && allowed.includes(found.workflowId)) return
    return refuseLimitedKey(reply)
  })
}
