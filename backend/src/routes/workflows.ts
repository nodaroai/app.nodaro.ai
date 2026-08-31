import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { hasCredits, hasOrganizations } from "../lib/config.js"
import { findCloudOnlyNodeTypes, cloudOnlyRejectionMessage } from "../lib/cloud-only-nodes.js"
import { findDeniedNodeTypes, deniedNodeRejectionMessage } from "../lib/surface-deny.js"
import { z } from "zod"
import { stripExportContent, stripTransientRuntimeData, validateSubWorkflowRoutes, WORKFLOW_VISIBILITIES, type WorkflowExport } from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { ensureDefaultProject, PERSONAL_SPACE_DISABLED_ERROR } from "../lib/default-project.js"
import { getPluginServices } from "../lib/private-plugins/load.js"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { requireScope } from "../lib/scopes.js"
import type { Scope } from "../lib/scopes.js"
import { checkIsAdmin } from "../lib/admin-check.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { sendNotFound } from "../lib/scoped-delete.js"
import { refuseIfWorkspaceArchived } from "../lib/orgs-context.js"
import {
  accessAtLeast,
  canChangeWorkflowVisibility,
  canDeleteWorkflow,
  canRunWorkflow,
  canShareWorkflow,
  workflowAccessFromRow,
  type AccessLevel,
} from "../lib/workflow-access.js"
import { auditWorkflowDeleted } from "../lib/orgs-audit.js"
import {
  touchesStudioPublishFlag,
  changesStudioPublishFlag,
} from "../lib/studio-audience.js"
import { loadWorkflowFor, toAccessRow } from "../lib/workflow-route-access.js"
import type { WorkflowAccessRow } from "../lib/private-plugins/types.js"
import {
  asObjectArray,
  collectAssetIds,
  fetchExportAssets,
  reCreateAssets,
  remapNodeAssetIds,
  workflowExportSchema,
} from "../lib/workflow-assets.js"
import type { CreatedAssetMap } from "../lib/workflow-assets.js"
import { migrateGenerateImageHandles } from "../lib/generate-image-handle-migration.js"
import { findUnroutableMedia, rehostForeignMedia } from "../lib/media-portability.js"
import {
  clientAppVisibilityFilter,
  getListedAppSlugs,
  inferAppSlugFromSettings,
} from "../lib/client-app-stamp.js"
import { deleteWorkflowWithPrivateMedia } from "../lib/workflow-delete.js"
import { settledWithLimit } from "../lib/settled-with-limit.js"

const workflowIdParams = z.object({
  id: z.string().uuid(),
})

const projectIdParams = z.object({
  projectId: z.string().uuid(),
})

const WorkflowSummary = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    projectId: z.string().uuid().nullable(),
    userId: z.string().uuid(),
    folderId: z.string().uuid().nullable().optional(),
    description: z.string().nullable().optional(),
    isTemplate: z.boolean().optional(),
    version: z.number().int().optional(),
    thumbnailUrl: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("WorkflowSummary")

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/projects/{projectId}/workflows",
  description: "List the authenticated user's workflows for a given project.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      projectId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "List of workflows",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(WorkflowSummary),
          }),
        },
      },
    },
    401: { description: "Unauthorized" },
  },
})

const createWorkflowBody = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional(),
  folderId: z.string().uuid().nullable().optional(),
  nodes: z.array(z.record(z.string(), z.unknown())).optional(),
  edges: z.array(z.record(z.string(), z.unknown())).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  sourcePrompt: z.string().max(10000).optional(),
})

// Project-less create. `projectId` is optional; when omitted the server
// resolves the caller's default project (lazy-creating one if needed).
/**
 * Studio's slug in `client_apps`. The only slug the platform names directly
 * (it has a dedicated dashboard tab + the legacy `?studio=true` param); every
 * other client app is handled generically through the registry.
 */
const STUDIO_APP_SLUG = "studio"

const createWorkflowFlatBody = createWorkflowBody.extend({
  projectId: z.string().uuid().optional(),
  // Which client app is creating this workflow (SDK callers: 'studio',
  // 'voice-changer-pro', …). Omitted = native, created in app.nodaro.ai itself.
  // Validated against the client_apps registry below — an unknown slug is a 400,
  // never a silently-unclassified row.
  appSlug: z.string().min(1).max(64).optional(),
})

const updateWorkflowBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  // Setting projectId moves the workflow to a different project owned by the
  // caller. folder_id is auto-cleared in that case since folders are scoped
  // to a single project (FK ON DELETE SET NULL would orphan otherwise).
  projectId: z.string().uuid().optional(),
  folderId: z.string().uuid().nullable().optional(),
  // Who else in the workspace can reach this workflow. Not an edit — see the
  // handler, which asks a different question of a different authority before
  // writing it.
  visibility: z.enum(WORKFLOW_VISIBILITIES).optional(),
  nodes: z.array(z.record(z.string(), z.unknown())).optional(),
  edges: z.array(z.record(z.string(), z.unknown())).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  sourcePrompt: z.string().max(10000).optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  // Optimistic concurrency token — when supplied, the row is updated
  // ONLY if its current `updated_at` matches. Mismatches return 409
  // with the actual current `updated_at` so the caller can refetch and
  // merge. Mirrors the MCP `update_workflow_json` contract; safe to
  // omit on legacy callers (last-write-wins fallback).
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  // Integer CAS against workflows.version (bumped by DB trigger on every
  // content change — migration 218). Preferred over expectedUpdatedAt:
  // monotonic, precision-proof, tamper-proof.
  expectedVersion: z.number().int().min(1).optional(),
  // Delta-save protocol (P3, migration 219): id-keyed whole-node/edge delta
  // applied atomically against baseVersion by apply_workflow_delta. Mutually
  // exclusive with every full-body content field above.
  delta: z
    .object({
      baseVersion: z.number().int().min(1),
      upsertNodes: z.array(z.record(z.string(), z.unknown())).optional(),
      deleteNodeIds: z.array(z.string()).optional(),
      upsertEdges: z.array(z.record(z.string(), z.unknown())).optional(),
      deleteEdgeIds: z.array(z.string()).optional(),
      set: z
        .object({
          name: z.string().min(1).max(200).optional(),
          settings: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
    })
    .optional(),
})

/** ids of an upsert array; null when any element lacks a string id. */
function deltaIds(arr: ReadonlyArray<Record<string, unknown>> | undefined): string[] | null {
  if (!arr) return []
  const ids: string[] = []
  for (const item of arr) {
    if (typeof item.id !== "string" || item.id.length === 0) return null
    ids.push(item.id)
  }
  return ids
}

const listWorkflowsQuery = z.object({
  limit: z
    .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(1).max(500))
    .optional(),
  // Admin-only: return every user's workflows (mirrors GET /v1/projects?viewAll=true).
  viewAll: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  // Scope the list to one client app's workflows (workflows.app_slug).
  app: z.string().min(1).max(64).optional(),
  // Legacy alias for `?app=studio`, kept so existing callers (the dashboard's
  // "Studio Workflows" tab) keep working. Resolved into `app` below.
  studio: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  // Admin-only, viewAll-only: lift the default client-app exclusion so the
  // "all users" list includes unlisted client-app rows (voice-changer-pro
  // conversions). Honored only on the admin-gated viewAll path, and only when
  // the list is NOT already scoped to one `app`. Off by default.
  includeClientApps: z
    .string()
    .optional()
    .transform((v) => v === "true"),
})

const exportWorkflowQuery = z.object({
  assets: z
    .string()
    .optional()
    .transform((v) => v === "true"),
})

const importWorkflowBody = z.object({
  projectId: z.string().uuid(),
  workflow_json: workflowExportSchema,
})

const moveWorkflowBody = z.object({
  projectId: z.string().uuid(),
})

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/workflows/{id}/move",
  description:
    "Move a workflow into another project. Authorized by the workflows:write scope — a move is a workflow write, not a permission of its own.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: { "application/json": { schema: moveWorkflowBody } },
    },
  },
  responses: {
    200: { description: "The moved workflow, plus any collaborator grants the move dropped" },
    400: { description: "The workflow is already in that project" },
    403: { description: "Not permitted to move this workflow there" },
    404: { description: "Workflow or project not found" },
    409: { description: "Blocked — the work belongs to an assignment, or the workspace is archived" },
  },
})

const createSubWorkflowBody = z.object({
  name: z.string().min(1).max(200).default("Sub-workflow"),
})

/**
 * How many shared workflows one person can be handed at once.
 *
 * Capped rather than paged, matching the collaborator roster it is the other
 * side of: being individually named on more than this many workflows is not a
 * list problem, it is a sign the work belongs in a workspace. Revisit together
 * with that roster if either ever runs into the ceiling.
 */
const SHARED_WITH_ME_LIMIT = 200

/** How many access lookups the shared-with-me judging runs at once. */
const SHARED_WITH_ME_CONCURRENCY = 8

// `workspace_id` and `visibility` are selected on BOTH projections because the
// access seam needs them off any row a route already loaded — without them
// every converted route would have to re-read the workflow just to ask who may
// touch it, on the hottest path in the product. They are mapped out too:
// the editor's share controls need to know which scope a workflow is in and
// who it is currently open to.
const WORKFLOW_META_COLS =
  "id, project_id, user_id, workspace_id, visibility, folder_id, name, description, is_template, version, thumbnail_url, created_at, updated_at"

const WORKFLOW_FULL_COLS =
  "id, project_id, user_id, workspace_id, visibility, folder_id, name, description, is_template, version, thumbnail_url, source_prompt, nodes, edges, settings, parent_workflow_id, app_slug, created_at, updated_at"

function toWorkflowMeta(row: Record<string, unknown>) {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    workspaceId: row.workspace_id ?? null,
    visibility: row.visibility ?? "private",
    folderId: row.folder_id,
    name: row.name,
    description: row.description,
    isTemplate: row.is_template,
    version: row.version,
    thumbnailUrl: row.thumbnail_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toWorkflowFull(row: Record<string, unknown>) {
  return {
    ...toWorkflowMeta(row),
    sourcePrompt: row.source_prompt,
    nodes: row.nodes,
    edges: row.edges,
    settings: row.settings,
    parentWorkflowId: row.parent_workflow_id ?? null,
    // Client app that created this workflow; null = native. Lets an SDK caller
    // read back the classification it asked for.
    appSlug: row.app_slug ?? null,
  }
}

// ── small response helpers ─────────────────────────────────────────────────
// All handlers return errors in `{ error: { code, message, ... } }` shape.
// These helpers keep the early-return ladders short and consistent.

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({
    error: { code: "unauthorized", message: "Authentication required" },
  })
}

function validationError(reply: FastifyReply, message: string) {
  return reply
    .status(400)
    .send({ error: { code: "validation_error", message } })
}

function notFound(reply: FastifyReply, message: string) {
  return reply.status(404).send({ error: { code: "not_found", message } })
}

/**
 * Verify an `appSlug` exists in the `client_apps` registry.
 *
 * Unknown slugs are rejected at write time (400) rather than stored: a row whose
 * app is unregistered would be invisible everywhere (the workflow-list rule
 * fails closed on unknown slugs), so silently accepting one would hand the
 * caller a workflow they can never see. Better to tell them immediately. The DB
 * has the same FK constraint; this turns its 500 into an actionable 400.
 */
async function clientAppExists(slug: string): Promise<{ ok: boolean; error?: unknown }> {
  const { data, error } = await supabase
    .from("client_apps")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle()
  if (error) return { ok: false, error }
  return { ok: data !== null }
}

/**
 * Decide a new workflow's `app_slug` (its origin) at create time.
 *
 * Precedence: an explicit body `appSlug` wins (already validated); else the
 * settings marker (`settings.vcp` → voice-changer-pro, etc.); else INHERIT the
 * project's slug, so a bare create inside a client app's project is classified
 * as that app's from birth.
 *
 * The project's own slug is passed IN rather than read here. It used to be a
 * second, `user_id`-scoped read of the same project the route had just
 * addressed — which meant that inside a workspace, where the project belongs
 * to the admin who made it and not to the caller, the read missed and every
 * workflow a member created came out unclassified. `resolveProjectScope` now
 * reads the project once, for both questions.
 */
async function resolveCreateAppSlug(
  settings: unknown,
  explicitSlug: string | null,
  projectAppSlug: string | null,
): Promise<string | null> {
  if (explicitSlug) return explicitSlug
  const fromSettings = await inferAppSlugFromSettings(settings)
  if (fromSettings) return fromSettings
  return projectAppSlug
}

/**
 * May this caller work inside this project?
 *
 * The two project-addressed routes cannot use the header the way a flat list
 * does. They already name a project, and the project's own workspace is the
 * answer to which scope they are in — so the question is whether the caller's
 * current scope and the project's scope are the same one.
 *
 * Inside a workspace: the project must belong to THAT workspace. Membership
 * was already established by the context hook, which refuses a workspace the
 * caller does not belong to before any route runs, so belonging to the
 * workspace is enough here.
 *
 * Outside one: the project must be the caller's own AND personal. A workspace
 * project must never be reachable without its header — if it were, the header
 * would stop being the thing that selects scope and become decoration.
 *
 * A miss returns null and the caller answers 404 "Project not found", the
 * same answer a project that does not exist gets: which of the two it was is
 * not something a stranger should be able to tell apart.
 */
async function resolveProjectScope(
  req: FastifyRequest,
  userId: string,
  projectId: string,
): Promise<{ id: string; appSlug: string | null } | null> {
  const { data, error } = await supabase
    // This read IS the scope check: it fetches the project unfiltered and
    // decides below, because inside a workspace the owning user is not the
    // caller.
    // tenant-scope-ignore: the decision is made in TypeScript, not the query.
    .from("projects")
    .select("id, app_slug, user_id, workspace_id")
    .eq("id", projectId)
    .maybeSingle()
  if (error || !data) return null

  const project = data as { id: string; app_slug: string | null; user_id: string; workspace_id: string | null }
  const inScope = req.workspaceId
    ? project.workspace_id === req.workspaceId
    : project.user_id === userId && project.workspace_id === null
  if (!inScope) return null
  return { id: project.id, appSlug: project.app_slug }
}

/** A move that must not happen, in the shape the route sends back. */
interface MoveRefusal {
  readonly status: 400 | 403 | 404 | 409
  readonly code: string
  readonly message: string
}

/**
 * The database could not answer, so no decision was reached.
 *
 * Distinct from a refusal on purpose: reporting a read failure as "not found"
 * is a lie that looks like a normal outcome, so nothing pages, nothing is
 * logged with a stack, and the caller retries against a 404 forever.
 */
interface MoveUndecided {
  readonly dbError: unknown
}

interface MoveAuthorized {
  readonly workflow: { id: string; userId: string; workspaceId: string | null; projectId: string | null }
  readonly targetProject: { id: string; userId: string; workspaceId: string | null }
}

function isMoveRefusal(r: MoveOutcome): r is MoveRefusal {
  return "code" in r
}

function isMoveUndecided(r: MoveOutcome): r is MoveUndecided {
  return "dbError" in r
}

type MoveOutcome = MoveRefusal | MoveUndecided | MoveAuthorized

/**
 * May this caller move this workflow into this project?
 *
 * ONE rule, in one place, for both ways a move can be asked for — the move
 * endpoint and the older `PATCH { projectId }`. Two implementations of a
 * question this consequential would drift, and the one nobody remembered
 * would be the permissive one.
 *
 * The decision itself is delegated: inside an organization the answer depends
 * on workspace roles on BOTH sides, which is the settings owner's knowledge,
 * not core's. When no plugin provides it, the fallback is exactly what this
 * route did before workspaces existed — the workflow and the target project
 * must both be the caller's own — so community and business are unchanged.
 *
 * Note the target-project check the fallback makes: owning the WORKFLOW is
 * not enough. Without the second half a caller could park their work inside
 * a stranger's project, which they cannot see into but can delete.
 */
async function authorizeWorkflowMove(
  req: FastifyRequest,
  userId: string,
  workflowId: string,
  targetProjectId: string,
): Promise<MoveOutcome> {
  const { data: wfRow, error: wfErr } = await supabase
    // Loads the facts the move decision is made from. A workspace admin may
    // move work they do not own, so filtering by user_id here would decide
    // the question before asking it.
    // tenant-scope-ignore: authorization follows, below.
    .from("workflows")
    .select("id, user_id, workspace_id, project_id, assignment_id")
    .eq("id", workflowId)
    .maybeSingle()
  if (wfErr) return { dbError: wfErr }
  if (!wfRow) return { status: 404, code: "not_found", message: "Workflow not found" }

  const { data: projRow, error: projErr } = await supabase
    // As above — the target project's owner is an INPUT to the decision, not
    // a filter on it.
    // tenant-scope-ignore: authorization follows, below.
    .from("projects")
    .select("id, user_id, workspace_id")
    .eq("id", targetProjectId)
    .maybeSingle()
  if (projErr) return { dbError: projErr }
  if (!projRow) return { status: 404, code: "not_found", message: "Project not found" }

  const workflow = {
    id: wfRow.id as string,
    userId: wfRow.user_id as string,
    workspaceId: (wfRow.workspace_id as string | null) ?? null,
    projectId: (wfRow.project_id as string | null) ?? null,
  }
  const targetProject = {
    id: projRow.id as string,
    userId: projRow.user_id as string,
    workspaceId: (projRow.workspace_id as string | null) ?? null,
  }

  // AUTHORIZATION FIRST, and the business refusals after it.
  //
  // The other order reads more naturally and leaks: "already in that project"
  // and "belongs to an assignment" are facts ABOUT the workflow, so answering
  // them before deciding whether the caller may touch it turns this endpoint
  // into an oracle. Anyone holding two ids could learn which project a
  // stranger's workflow sits in (400 vs 403) and whether it was submitted
  // for an assignment (409 vs 403), without ever being allowed to move it.
  const orgs = getPluginServices().orgs
  const verdict = orgs?.canMoveWorkflow
    ? await orgs.canMoveWorkflow({ userId, workflow, targetProject })
    : { allowed: workflow.userId === userId && targetProject.userId === userId }

  if (!verdict.allowed) {
    return { status: 403, code: "not_permitted", message: "You cannot move this workflow there" }
  }

  // Moving INTO an archived workspace is a write to it. Moving OUT of one is
  // allowed and deliberately so: rescuing your work is the reason someone
  // opens an archived workspace at all.
  //
  // Core can only see this for the workspace the REQUEST selected, which is
  // the one a client moving into it would be in. A move into some other
  // archived workspace is not visible from here, and is refused by the
  // authorization above declining a workspace the caller is not working in.
  if (req.workspaceArchived && targetProject.workspaceId === req.workspaceId) {
    return {
      status: 409,
      code: "workspace_archived",
      message: "This workspace is archived. Unarchive it to add new work.",
    }
  }

  // Work handed in against an assignment stops being freely movable: moving it
  // out from under the assignment is how a submission loses its context.
  // A second condition — whether it has already been submitted — belongs with
  // the submissions tables, which do not exist yet; this is deliberately not a
  // query against a table nobody has created.
  if ((wfRow as { assignment_id: string | null }).assignment_id !== null) {
    return {
      status: 409,
      code: "move_blocked",
      message: "This work was created for an assignment and cannot be moved.",
    }
  }

  if (workflow.projectId === targetProject.id) {
    return { status: 400, code: "validation_error", message: "The workflow is already in that project" }
  }

  return { workflow, targetProject }
}

/**
 * Grants that do not survive a move between scopes.
 *
 * A collaborator grant was issued about one place. Carrying it into another
 * silently would keep someone reading work that has moved somewhere they have
 * no standing, so a move that CHANGES scope clears the grants and reports who
 * lost access — the caller has to be able to see what their move cost.
 *
 * Only when the scope actually changes: moving between two projects of the
 * same workspace disturbs nothing. Clearing all of them rather than keeping
 * whoever also belongs to the target is the under-approximation on purpose —
 * it can drop a grant that could have been kept, and never keeps one that
 * should have gone. Grants do not exist yet; whoever builds them narrows this.
 */
async function dropStaleCollaborators(
  req: FastifyRequest,
  workflowId: string,
  fromWorkspaceId: string | null,
  toWorkspaceId: string | null,
): Promise<Array<{ userId: string; name: string | null }>> {
  if (fromWorkspaceId === toWorkspaceId) return []

  // ONE statement, and the rows it returns are the rows it actually removed.
  //
  // Read-then-delete reported what it INTENDED to drop: a failed delete still
  // answered "these three people lost access" while all three kept it. A
  // response that is wrong about who can see something is worse than an
  // error, because nobody goes looking.
  const { data, error } = await supabase
    // Reached only after the move was authorized; these are the grants ON
    // that workflow, whoever holds them.
    // tenant-scope-ignore: the authorized move is the authorization.
    .from("workflow_collaborators")
    .delete()
    .eq("workflow_id", workflowId)
    .select("user_id")

  if (error) {
    // The move itself already committed, so this cannot be unwound. Say so
    // loudly and claim nothing: grants that outlive a move into another
    // workspace are a real access-control leak, and the only thing worse
    // than one is one nobody noticed.
    req.log.error({ err: error, workflowId }, "[workflows/move] collaborator grants survived the move")
    return []
  }

  const droppedIds = (data ?? []).map((r) => r.user_id as string)
  if (droppedIds.length === 0) return []

  // Named, not just listed as ids: "3 people lost access" is not something
  // anyone can act on.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", droppedIds)
  const names = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? null]))
  return droppedIds.map((id) => ({ userId: id, name: names.get(id) ?? null }))
}

/**
 * Resolve the caller's userId, gate the request on a scope when an OAuth
 * developer-app token is in play, and return the userId. Returns `null` when
 * the request was already terminated by sending an auth/scope error.
 */
function authorize(
  req: FastifyRequest,
  reply: FastifyReply,
  scope?: Scope,
): string | null {
  if (!req.userId) {
    unauthorized(reply)
    return null
  }
  if (scope && req.appAuthorization) {
    const err = requireScope(req.appAuthorization.scopes, scope)
    if (err) {
      reply.status(err.statusCode).send(err.body)
      return null
    }
  }
  return req.userId
}

function parseWith<S extends z.ZodTypeAny>(
  reply: FastifyReply,
  schema: S,
  input: unknown,
  fallback: string,
): z.infer<S> | null {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data
  validationError(reply, parsed.error.issues[0]?.message ?? fallback)
  return null
}

/** Postgrest "no rows" code returned by `.single()`. */
const PGRST_NOT_FOUND = "PGRST116"

function checkSubWorkflowShape(
  reply: FastifyReply,
  nodes: unknown,
): boolean {
  if (!Array.isArray(nodes)) return true // nothing to validate
  const result = validateSubWorkflowRoutes(nodes as Parameters<typeof validateSubWorkflowRoutes>[0])
  if (result.ok) return true
  reply.status(400).send({
    error: {
      code: "invalid_sub_workflow",
      message: "Sub-workflow boundary nodes are not in a valid shape",
      details: result.errors,
    },
  })
  return false
}

export async function workflowRoutes(app: FastifyInstance) {
  // List workflows for a project
  app.get("/v1/projects/:projectId/workflows", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return

    const params = parseWith(reply, projectIdParams, req.params, "Invalid project ID")
    if (!params) return

    // A PROJECT-scoped list: the project's own scope is the answer, so this
    // must NOT filter by workspace_id — a workspace project's workflows belong
    // in this list. Whether the caller may address this project at all is the
    // question resolveProjectScope answers.
    if (!(await resolveProjectScope(req, userId, params.projectId))) {
      return sendNotFound(reply, "Project not found")
    }

    // `.eq("user_id")` STAYS, including inside a workspace. Dropping it would
    // turn this into "every member's work in this project", which is a
    // visibility decision this route cannot make yet — the resolver that knows
    // which of a workspace's workflows a given member may see arrives with the
    // access work, and none of the levers it reads exist yet. A scope may
    // under-show and be widened later; it may never over-show and be narrowed.
    const { data, error } = await supabase
      // tenant-scope-ignore: project-scoped list; the project carries the scope.
      .from("workflows")
      .select(WORKFLOW_META_COLS)
      .eq("project_id", params.projectId)
      .eq("user_id", userId)
      .is("parent_workflow_id", null)
      .order("created_at", { ascending: false })

    if (error) return sendInternalError(reply, req, error, "Failed to fetch workflows")
    return { data: (data ?? []).map(toWorkflowMeta) }
  })

  // Create workflow in a project
  app.post("/v1/projects/:projectId/workflows", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const params = parseWith(reply, projectIdParams, req.params, "Invalid project ID")
    if (!params) return

    const body = parseWith(reply, createWorkflowBody, req.body, "Invalid request")
    if (!body) return

    if (body.nodes && !checkSubWorkflowShape(reply, body.nodes)) return

    if (refuseIfWorkspaceArchived(req, reply)) return

    // Until now this route verified NOTHING about the project it was handed —
    // the only project read was the tolerant slug lookup, which by design
    // never blocks a create. So the row landed in whatever project id the
    // caller named, including one belonging to somebody else: their own
    // workflow, parked in a stranger's project, invisible to that stranger
    // (their list filters by user_id) but destroyed with it if they ever
    // deleted the project. Scoping the create closes that as a side effect of
    // asking the question workspaces made unavoidable.
    const project = await resolveProjectScope(req, userId, params.projectId)
    if (!project) return sendNotFound(reply, "Project not found")

    // Import / template / SDK writes never pass through the node pickers, so
    // this is where a Cloud-only node would otherwise slip into an edition
    // that can't run it.
    if (!hasCredits()) {
      const cloudOnly = findCloudOnlyNodeTypes(body.nodes as ReadonlyArray<{ type?: unknown }> | undefined)
      if (cloudOnly.length > 0) {
        return validationError(reply, cloudOnlyRejectionMessage(cloudOnly))
      }
    }
    // Deployment surface deny (B1) applies on every edition the gate is open for
    // (business+), so it sits beside the Cloud-only guard, not inside it.
    const deniedNodes = findDeniedNodeTypes(body.nodes as ReadonlyArray<{ type?: unknown }> | undefined)
    if (deniedNodes.length > 0) {
      return validationError(reply, deniedNodeRejectionMessage(deniedNodes))
    }


    if (body.nodes && body.edges) {
      body.edges = migrateGenerateImageHandles(
        body.nodes as unknown as ReadonlyArray<{ id: string; type?: string }>,
        body.edges as unknown as ReadonlyArray<{ id: string; source: string; target: string; targetHandle?: string | null }>,
      ) as unknown as typeof body.edges
    }

    // Classify the row's origin (see client-app-stamp.ts). This route carries no
    // `appSlug` field, so infer from the settings marker; failing that, INHERIT
    // the project's slug — a workflow created inside a client app's project (e.g.
    // voice-changer-pro's per-user project) is that app's, even when the create
    // itself is bare (vcp creates the conversion, then writes settings.vcp on the
    // first PATCH). Inheriting here stamps it at birth so there is no window in
    // which it shows as native. The project read is tolerant: an unowned/ missing
    // project leaves the slug NULL and the insert proceeds as before.
    const scopedAppSlug = await resolveCreateAppSlug(body.settings, null, project.appSlug)

    const { data, error } = await supabase
      .from("workflows")
      .insert({
        project_id: params.projectId,
        user_id: userId,
        name: body.name,
        description: body.description ?? null,
        folder_id: body.folderId ?? null,
        nodes: body.nodes ?? [],
        edges: body.edges ?? [],
        settings: body.settings ?? {},
        source_prompt: body.sourcePrompt ?? null,
        app_slug: scopedAppSlug,
      })
      .select(WORKFLOW_FULL_COLS)
      .single()

    if (error) return sendInternalError(reply, req, error, "Failed to create workflow")
    return reply.status(201).send({ data: toWorkflowFull(data) })
  })

  // List ALL workflows owned by the caller, across every project. Used by
  // the SDK / CLI / MCP for a flat view; the frontend's "My Workflows" tab
  // hits Supabase directly for one fewer hop.
  //
  // `?app=<slug>` scopes the list to one client app's workflows (`?studio=true`
  // is a legacy alias for `?app=studio`).
  //
  // DO NOT CHANGE THE DEFAULT. With no `app` param this returns EVERYTHING the
  // caller owns, native and client-app rows alike. voice-changer-pro lists its
  // own conversions through exactly this call with no param — making the default
  // "native only" (to mirror the dashboard's visibility rule) would blank vcp's
  // conversion list in production the moment it deployed. That flip is Phase 2
  // and is gated on an SDK release that sends `?app=voice-changer-pro`. Until
  // every deployed client passes its slug, the default stays permissive.
  app.get("/v1/workflows", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return

    const query = parseWith(reply, listWorkflowsQuery, req.query ?? {}, "Invalid query")
    if (!query) return
    const limit = query.limit ?? (query.viewAll ? 500 : 100)

    // `?studio=true` is the legacy spelling of `?app=studio`; an explicit `?app=`
    // wins if both are somehow sent.
    const appSlug = query.app ?? (query.studio ? STUDIO_APP_SLUG : undefined)

    // Admin "All users" view — mirrors GET /v1/projects?viewAll=true. Returns
    // every user's top-level workflows (optionally scoped to one client app)
    // with owner emails. Powers the dashboard "Studio Workflows" tab when an
    // admin flips the "All users" switch.
    if (query.viewAll) {
      const isAdmin = await checkIsAdmin(userId)
      if (!isAdmin) {
        return reply.status(403).send({
          error: { code: "forbidden", message: "Admin access required" },
        })
      }

      let allQuery = supabase
        // tenant-scope-ignore: deliberate cross-tenant read, admin-gated above.
        .from("workflows")
        .select(WORKFLOW_META_COLS)
        .is("parent_workflow_id", null)
        .order("updated_at", { ascending: false })
        .limit(limit)
      if (appSlug) {
        // Already scoped to one client app — the default exclusion is moot, and
        // `includeClientApps` has no effect here (you asked for exactly this app).
        allQuery = allQuery.eq("app_slug", appSlug)
      } else if (query.includeClientApps !== true) {
        // Unscoped "all workflows" view: hide client-app rows by default (native
        // OR a listed app), the same rule the dashboard applies for everyone.
        // `?includeClientApps=true` (admin-gated above) lifts it. workflows.app_slug
        // predates this work (migration 253), so no pre-migration fallback is
        // needed — unlike projects.app_slug.
        allQuery = allQuery.or(clientAppVisibilityFilter(await getListedAppSlugs()))
      }
      const { data, error } = await allQuery
      if (error) return sendInternalError(reply, req, error, "Failed to fetch workflows")

      const rows = data ?? []
      const ownerIds = [...new Set(rows.map((r) => r.user_id as string))]
      const emailMap = new Map<string, string>()
      if (ownerIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", ownerIds)
        for (const p of profiles ?? []) {
          emailMap.set(p.id as string, p.email as string)
        }
      }

      return {
        data: rows.map((row) => ({
          ...toWorkflowMeta(row),
          ownerEmail: emailMap.get(row.user_id as string) ?? "Unknown",
        })),
        currentUserId: userId,
      }
    }

    let listQuery = supabase
      .from("workflows")
      .select(WORKFLOW_META_COLS)
      .eq("user_id", userId)

    if (req.workspaceId) {
      // Workspace context: MY work inside this workspace.
      //
      // `.eq("user_id")` above stays deliberately. The finished rule is
      // "everything in this workspace that this member is allowed to see",
      // and the resolver that decides the second half does not exist yet —
      // every workflow is private by default, no collaborator grants have
      // ever been issued, and the settings that widen it have no consumer.
      // Dropping the filter now would not implement that rule; it would
      // implement "every workflow in the workspace, visibility ignored",
      // through the service role, on a route that never meets a row policy —
      // while a browser reading the same data through those policies would
      // give the narrower answer. One list, two answers, for as long as this
      // sat in front of the access work.
      //
      // So: a scope may under-show and be widened later; it may never
      // over-show and be narrowed later. This is a strict subset of what the
      // caller will be allowed to see, so widening it breaks nothing.
      listQuery = listQuery.eq("workspace_id", req.workspaceId)
    } else {
      // Personal context: mine, and only the rows that belong to no workspace.
      // BOTH halves are required. `user_id` alone would leak the caller's own
      // workspace work into their personal list the moment they join one — the
      // class's work showing up beside their private work, with no way to tell
      // which is which.
      listQuery = listQuery.is("workspace_id", null)
    }

    listQuery = listQuery
      .is("parent_workflow_id", null)
      .order("updated_at", { ascending: false })
      .limit(limit)
    if (appSlug) {
      listQuery = listQuery.eq("app_slug", appSlug)
    }
    const { data, error } = await listQuery

    if (error) return sendInternalError(reply, req, error, "Failed to fetch workflows")
    return { data: (data ?? []).map(toWorkflowMeta) }
  })

  // Project-less workflow create. Body.projectId is optional — when omitted
  // the workflow lands in the caller's default project (lazy-created if it
  // does not yet exist). Powers the dashboard "+ New Workflow" quick-create.
  app.post("/v1/workflows", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const body = parseWith(reply, createWorkflowFlatBody, req.body ?? {}, "Invalid request")
    if (!body) return

    if (body.nodes && !checkSubWorkflowShape(reply, body.nodes)) return

    // Import / template / SDK writes never pass through the node pickers, so
    // this is where a Cloud-only node would otherwise slip into an edition
    // that can't run it.
    if (!hasCredits()) {
      const cloudOnly = findCloudOnlyNodeTypes(body.nodes as ReadonlyArray<{ type?: unknown }> | undefined)
      if (cloudOnly.length > 0) {
        return validationError(reply, cloudOnlyRejectionMessage(cloudOnly))
      }
    }
    // Deployment surface deny (B1) applies on every edition the gate is open for
    // (business+), so it sits beside the Cloud-only guard, not inside it.
    const deniedNodes = findDeniedNodeTypes(body.nodes as ReadonlyArray<{ type?: unknown }> | undefined)
    if (deniedNodes.length > 0) {
      return validationError(reply, deniedNodeRejectionMessage(deniedNodes))
    }


    // Classify the row's origin. An unregistered slug is rejected here rather
    // than persisted — see clientAppExists.
    if (body.appSlug) {
      const app = await clientAppExists(body.appSlug)
      if (app.error) return sendInternalError(reply, req, app.error, "Failed to create workflow")
      if (!app.ok) {
        return validationError(
          reply,
          `Unknown appSlug '${body.appSlug}'. Register the app in client_apps first.`,
        )
      }
    }

    if (body.nodes && body.edges) {
      body.edges = migrateGenerateImageHandles(
        body.nodes as unknown as ReadonlyArray<{ id: string; type?: string }>,
        body.edges as unknown as ReadonlyArray<{ id: string; source: string; target: string; targetHandle?: string | null }>,
      ) as unknown as typeof body.edges
    }

    if (refuseIfWorkspaceArchived(req, reply)) return

    let projectId = body.projectId
    // The project's own slug, inherited when the caller gives neither an explicit
    // appSlug nor a settings marker (a bare create inside a client-app project).
    let projectAppSlug: string | null = null

    if (projectId) {
      // The ownership check used to be `.eq("user_id", userId)`, which is the
      // wrong question inside a workspace: the project there belongs to the
      // admin who created it, so a member creating in their own class project
      // was told it did not exist.
      const project = await resolveProjectScope(req, userId, projectId)
      if (!project) return notFound(reply, "Project not found")
      projectAppSlug = project.appSlug
    } else if (req.workspaceId) {
      // Inside a workspace, "no project given" means the WORKSPACE's landing
      // project, never the caller's personal default — sending a member's
      // class work to their private space is the one outcome the workspace
      // exists to prevent. The workspace owns that pointer, so the plugin is
      // asked for it rather than core learning the shape of a table it does
      // not own.
      const orgs = getPluginServices().orgs
      const landing = orgs?.workspaceDefaultProject
        ? await orgs.workspaceDefaultProject(req.workspaceId)
        : null
      if (!landing) {
        return reply.status(409).send({
          error: {
            code: "workspace_has_no_default_project",
            message: "This workspace has no default project. Name a project to create in.",
          },
        })
      }
      projectId = landing
    } else {
      // Resolve / lazy-create the default project (always native → slug stays NULL).
      const resolved = await ensureDefaultProject(userId)
      if ("error" in resolved) return sendInternalError(reply, req, resolved.error, "Failed to create workflow")
      if ("personalSpaceDisabled" in resolved) {
        return reply.status(403).send({ error: PERSONAL_SPACE_DISABLED_ERROR })
      }
      projectId = resolved.projectId
    }

    // Origin precedence: explicit appSlug (validated above) → settings marker →
    // inherited project slug → NULL (native, created in app.nodaro.ai itself).
    const appSlug =
      body.appSlug ?? (await inferAppSlugFromSettings(body.settings)) ?? projectAppSlug

    const { data, error } = await supabase
      .from("workflows")
      .insert({
        project_id: projectId,
        user_id: userId,
        name: body.name,
        description: body.description ?? null,
        folder_id: body.folderId ?? null,
        nodes: body.nodes ?? [],
        edges: body.edges ?? [],
        settings: body.settings ?? {},
        source_prompt: body.sourcePrompt ?? null,
        app_slug: appSlug,
      })
      .select(WORKFLOW_FULL_COLS)
      .single()

    if (error) return sendInternalError(reply, req, error, "Failed to create workflow")
    return reply.status(201).send({ data: toWorkflowFull(data) })
  })

  // Work somebody else shared with me, one workflow at a time.
  //
  // Grants only, and only on work that is NOT in a workspace this caller
  // belongs to. Workspace-visible work already appears in that workspace's own
  // lists, so including it here would show every shared class workflow twice —
  // once as "the class's", once as "shared with me" — and the second label
  // would be the less true of the two.
  //
  // Registered ahead of `/v1/workflows/:id` for readers; the router prefers a
  // static segment over a parameter either way, so `shared-with-me` is never
  // mistaken for an id.
  app.get("/v1/workflows/shared-with-me", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return

    // Nothing can have been shared where sharing does not exist: the routes
    // that write grants are registered behind the same flag. Answering from
    // here keeps the feature genuinely dark rather than merely empty — if the
    // switch is ever turned back off, this stops listing rather than
    // continuing to hand out what it granted.
    if (!hasOrganizations()) return { data: [] }

    const memberships = await req.orgs()
    const myWorkspaceIds = new Set(memberships.workspaces.map((w) => w.workspaceId))

    const { data, error } = await supabase
      // Keyed by the caller: these are the grants held BY them, which is the
      // whole question this route asks.
      // tenant-scope-ignore: `.eq("user_id", userId)` IS the tenant scope here.
      .from("workflow_collaborators")
      .select(`role, workflows!inner(${WORKFLOW_META_COLS})`)
      .eq("user_id", userId)
      // ORDERED before it is capped. A bare `.limit()` takes an arbitrary 200
      // rows and reorders them between requests, so sorting afterwards
      // produces "some 200 of your shared workflows, shuffled" rather than the
      // 200 most recent — and quietly hides recent work from anyone near the
      // ceiling.
      .order("updated_at", { referencedTable: "workflows", ascending: false })
      .limit(SHARED_WITH_ME_LIMIT)

    if (error) return sendInternalError(reply, req, error, "Failed to fetch shared workflows")

    // The workspace exclusion runs HERE and not in the query on purpose. Most
    // callers belong to no workspace at all, and PostgREST's `not.in` on an
    // empty list does not mean "exclude nothing" — it is the classic way to
    // write a filter that quietly matches wrongly. A `Set` cannot.
    const rows = (data ?? []) as unknown as Array<{
      role: string
      workflows: Record<string, unknown> | null
    }>
    const candidates = rows
      .filter((r) => r.workflows !== null)
      .filter((r) => {
        const workspaceId = (r.workflows!.workspace_id as string | null) ?? null
        return workspaceId === null || !myWorkspaceIds.has(workspaceId)
      })

    // A GRANT and ACCESS are not the same thing, and this list must show the
    // second one. The rule refuses over a live grant in more than one state —
    // a suspended membership, a workspace whose organization has been deleted
    // — and in each of those the row would otherwise sit here with its name
    // and thumbnail while opening it correctly 404s. A list of things you
    // cannot open is worse than an empty one, and this page is exactly where
    // somebody whose access was just revoked goes to look.
    //
    // Cheap where it matters: with no plugin this is pure computation on rows
    // already in hand, and the ceiling is `SHARED_WITH_ME_LIMIT`.
    // Capped concurrency: up to SHARED_WITH_ME_LIMIT rows, each an access
    // lookup, must not open that many database round trips at once. `failFast:
    // false` so one row's error drops that row rather than the whole list.
    const settled = await settledWithLimit(
      candidates.map((r) => async () => ({
        row: r,
        access: await workflowAccessFromRow(userId, toAccessRow(r.workflows!)),
      })),
      SHARED_WITH_ME_CONCURRENCY,
      undefined,
      false,
    )

    const shared = settled
      .filter((s): s is PromiseFulfilledResult<{ row: (typeof candidates)[number]; access: AccessLevel }> =>
        s.status === "fulfilled" && s.value.access !== "none",
      )
      .map((s) => ({ ...toWorkflowMeta(s.value.row.workflows!), grantedRole: s.value.row.role }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))

    return { data: shared }
  })

  // What may I do with this one workflow?
  //
  // The editor loads a workflow's CONTENT straight from Supabase, where the
  // row policies decide what it may read — but "may I write this" is a
  // different question and the policies answer it silently, by refusing a
  // save that has already been typed. So the canvas asks here on open, and
  // puts itself in read-only mode when the answer is `view`.
  //
  // Its own route rather than a field on the full GET, because that one
  // carries the entire graph: fetching a workflow's nodes and edges a second
  // time to read one word off the response would be a strange way to save a
  // request. `view` is the floor to ask at all — anyone who cannot see the
  // workflow gets the same 404 they get everywhere else.
  app.get("/v1/workflows/:id/access", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return

    const params = parseWith(reply, workflowIdParams, req.params, "Invalid workflow ID")
    if (!params) return

    const loaded = await loadWorkflowFor(
      req, reply, userId, params.id, "view",
      "id, user_id, workspace_id, visibility",
      "Failed to read workflow access",
    )
    if (!loaded.ok) return

    const facts = toAccessRow(loaded.row)
    // Everything the two surfaces need to render themselves honestly, answered
    // in one breath. `canShare` and `canChangeVisibility` are DIFFERENT
    // questions with different answers — a team workspace can let an editor
    // invite people while still reserving the class-wide switch for its
    // admins — and the dialog would show the wrong controls if it guessed one
    // from the other. `canRun` is separate again, because it is the only one
    // that can be false while the caller may still edit.
    const [canChangeVisibility, canShare, canRun] = await Promise.all([
      canChangeWorkflowVisibility(userId, params.id),
      canShareWorkflow(userId, params.id),
      canRunWorkflow(userId, params.id),
    ])

    return {
      data: {
        access: loaded.access,
        workspaceId: facts.workspace_id,
        visibility: facts.visibility,
        canChangeVisibility,
        canShare,
        canRun,
      },
    }
  })

  // Get workflow by ID
  app.get("/v1/workflows/:id", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return

    const params = parseWith(reply, workflowIdParams, req.params, "Invalid workflow ID")
    if (!params) return

    const loaded = await loadWorkflowFor(
      req, reply, userId, params.id, "view", WORKFLOW_FULL_COLS, "Failed to fetch workflow",
    )
    if (!loaded.ok) return

    // `access` rides along because the editor needs it the moment it opens the
    // workflow — a `view` answer is what puts the canvas in read-only mode.
    // Sent from here rather than fetched separately so the editor never has to
    // ask a second question about a workflow it just received, and so the two
    // answers cannot disagree with each other.
    return { data: { ...toWorkflowFull(loaded.row), access: loaded.access } }
  })

  // Public (share-by-link) read — NO auth (listed in auth.ts PUBLIC_ROUTES).
  // OPT-IN ONLY: returns a workflow solely when its owner explicitly shared it
  // (`settings.studio.shared === true`), and only a TRIMMED projection (no
  // user_id / project_id / owner PII). Powers studio.nodaro.ai's read-only
  // `/example/:id` viewer. An unshared or missing id 404s identically (no
  // existence oracle). NOT user-scoped by design — sharing is by unguessable id.
  app.get("/v1/public/workflows/:id", async (req, reply) => {
    const params = parseWith(reply, workflowIdParams, req.params, "Invalid workflow ID")
    if (!params) return

    const { data, error } = await supabase
      // tenant-scope-ignore: public share-by-link read, gated by the opt-in settings.studio.shared flag verified below (cross-tenant by design; a 404 hides unshared + missing alike)
      .from("workflows")
      .select(WORKFLOW_FULL_COLS)
      .eq("id", params.id)
      .single()

    if (error) {
      if (error.code === PGRST_NOT_FOUND) return notFound(reply, "Workflow not found")
      return sendInternalError(reply, req, error, "Failed to fetch workflow")
    }

    const full = toWorkflowFull(data)
    const settings = full.settings as { studio?: { shared?: unknown } } | null | undefined
    // NOTE: this is NOT the origin signal that `workflows.app_slug` replaced.
    // `settings.studio.shared` is a PER-ROW opt-in the owner sets to publish one
    // workflow by link — a fact neither `app_slug` (per-row origin) nor
    // `client_apps.workflows_listed` (per-app) can express. Do not "finish the
    // migration" by deleting this check: without it every workflow in the
    // database becomes readable by id, with no auth.
    if (settings?.studio?.shared !== true) {
      // Not shared → indistinguishable from not-found (don't leak existence).
      return notFound(reply, "Workflow not found")
    }

    // Trimmed public projection — only what the read-only viewer renders.
    return {
      data: {
        id: full.id,
        name: full.name,
        thumbnailUrl: full.thumbnailUrl,
        nodes: full.nodes,
        edges: full.edges,
        settings: full.settings,
      },
    }
  })

  // Update workflow
  app.patch("/v1/workflows/:id", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const params = parseWith(reply, workflowIdParams, req.params, "Invalid workflow ID")
    if (!params) return

    const body = parseWith(reply, updateWorkflowBody, req.body, "Invalid request")
    if (!body) return

    // Import / template / SDK writes never pass through the node pickers, so
    // this is where a Cloud-only node would otherwise slip into an edition
    // that can't run it.
    if (!hasCredits()) {
      const cloudOnly = findCloudOnlyNodeTypes(body.nodes as ReadonlyArray<{ type?: unknown }> | undefined)
      if (cloudOnly.length > 0) {
        return validationError(reply, cloudOnlyRejectionMessage(cloudOnly))
      }
    }
    // Deployment surface deny (B1) applies on every edition the gate is open for
    // (business+), so it sits beside the Cloud-only guard, not inside it.
    const deniedNodes = findDeniedNodeTypes(body.nodes as ReadonlyArray<{ type?: unknown }> | undefined)
    if (deniedNodes.length > 0) {
      return validationError(reply, deniedNodeRejectionMessage(deniedNodes))
    }

    if (body.delta) {
      // Mutually exclusive with full-body fields — a mixed request is
      // ambiguous about which representation wins.
      const mixed =
        body.nodes !== undefined || body.edges !== undefined || body.settings !== undefined ||
        body.name !== undefined || body.description !== undefined || body.folderId !== undefined ||
        body.projectId !== undefined || body.sourcePrompt !== undefined ||
        body.thumbnailUrl !== undefined || body.expectedUpdatedAt !== undefined ||
        body.expectedVersion !== undefined || body.visibility !== undefined
      if (mixed) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "delta is mutually exclusive with full-body fields" },
        })
      }
      const upsertNodeIds = deltaIds(body.delta.upsertNodes)
      const upsertEdgeIds = deltaIds(body.delta.upsertEdges)
      if (!upsertNodeIds || !upsertEdgeIds) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "every delta upsert needs a non-empty string id" },
        })
      }
      const dupNode = upsertNodeIds.length !== new Set(upsertNodeIds).size
      const dupEdge = upsertEdgeIds.length !== new Set(upsertEdgeIds).size
      const nodeOverlap = (body.delta.deleteNodeIds ?? []).some((id) => upsertNodeIds.includes(id))
      const edgeOverlap = (body.delta.deleteEdgeIds ?? []).some((id) => upsertEdgeIds.includes(id))
      if (dupNode || dupEdge || nodeOverlap || edgeOverlap) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "delta ids must be unique and delete/upsert sets disjoint" },
        })
      }

      // NOTE: sub-workflow route validation needs the FULL graph and is not
      // possible on a partial delta — the editor maintains the invariant
      // client-side, and the full-save path keeps the server-side check.
      //
      // AUTHORIZATION on this branch is the RPC's own, and deliberately so.
      // `apply_workflow_delta` asks SQL `workflow_access(w.id, v_uid) IN
      // ('own','edit')` inside its row lookup (migration 338) — the same rule
      // this route asks in TypeScript below, from the twin implementation the
      // parity job keeps honest. Adding a pre-check here would be a THIRD
      // reading of it, and would cost a second round trip on the hottest write
      // in the product, where this branch exists precisely to make one.
      //
      // The visible consequence, and it is accepted rather than overlooked: a
      // caller holding only `view` is refused here as 404 (the RPC's
      // not-found arm) and as 403 on the full-body branch below. Same refusal,
      // two shapes, because one of them is a row lock that never learned
      // whether the row was missing or merely closed to this caller.
      //
      // ONE exception, and it is not a second reading of the access rule: the
      // RPC authorizes at `edit`, and a delta may carry `set.settings`, which
      // can reach the public-publish flag (see `touchesStudioPublishFlag`).
      // That is an audience decision, not an edit, so it is asked of the
      // audience authority before the RPC is reached — the same question the
      // full-body branch asks about `visibility`.
      if (touchesStudioPublishFlag(body.delta.set?.settings)) {
        if (!(await canChangeWorkflowVisibility(userId, params.id))) {
          return reply.status(403).send({
            error: {
              code: "forbidden",
              message: "Only the owner or a workspace admin can change who this is shared with",
            },
          })
        }
      }
      const { data: rpcData, error: rpcError } = await supabase.rpc("apply_workflow_delta", {
        p_workflow_id: params.id,
        p_base_version: body.delta.baseVersion,
        // Server-side strip mirrors the full-body path: transient run-state
        // never persists, whichever protocol carries the nodes.
        p_upsert_nodes: stripTransientRuntimeData(
          (body.delta.upsertNodes ?? []) as Array<{ data?: Record<string, unknown> }>,
        ),
        p_delete_node_ids: body.delta.deleteNodeIds ?? [],
        p_upsert_edges: body.delta.upsertEdges ?? [],
        p_delete_edge_ids: body.delta.deleteEdgeIds ?? [],
        p_set: body.delta.set ?? null,
        p_user_id: userId,
      })
      if (rpcError) return sendInternalError(reply, req, rpcError, "Failed to update workflow")
      const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
        | { ok: boolean; version: number | null; updated_at: string | null }
        | undefined
      if (!row) return sendInternalError(reply, req, "apply_workflow_delta returned no row", "Failed to update workflow")
      if (!row.ok) {
        if (row.version == null) return notFound(reply, "Workflow not found")
        return reply.status(409).send({
          error: {
            code: "workflow_conflict",
            message: "Workflow was updated by another writer",
            currentVersion: row.version,
            currentUpdatedAt: row.updated_at,
          },
        })
      }
      return { data: { id: params.id, version: row.version, updatedAt: row.updated_at } }
    }

    if (body.nodes && !checkSubWorkflowShape(reply, body.nodes)) return

    // The full-body path's authorization. `edit` is the bar for changing the
    // canvas; `visibility` is asked separately below because it is not an edit.
    const loaded = await loadWorkflowFor(
      req, reply, userId, params.id, "edit", WORKFLOW_FULL_COLS, "Failed to update workflow",
    )
    if (!loaded.ok) return
    const target = toAccessRow(loaded.row)

    if (body.nodes && body.edges) {
      body.edges = migrateGenerateImageHandles(
        body.nodes as unknown as ReadonlyArray<{ id: string; type?: string }>,
        body.edges as unknown as ReadonlyArray<{ id: string; source: string; target: string; targetHandle?: string | null }>,
      ) as unknown as typeof body.edges
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (body.name !== undefined) updates.name = body.name
    if (body.description !== undefined) updates.description = body.description
    if (body.folderId !== undefined) updates.folder_id = body.folderId
    if (body.nodes !== undefined) {
      // Server-side strip of transient run-state (status/jobId/progress):
      // pre-P0 clients still send it, and persisted phantom "running" state
      // is what seeded false cross-tab conflicts. Results stay untouched.
      updates.nodes = stripTransientRuntimeData(body.nodes as Array<{ data?: Record<string, unknown> }>)
    }
    if (body.edges !== undefined) updates.edges = body.edges
    if (body.settings !== undefined) {
      // The full-body path HAS the stored row, so it can ask the narrower
      // question: is the public-publish flag actually being changed? An
      // ordinary save that carries the studio block through unchanged is an
      // edit and stays one.
      if (changesStudioPublishFlag(body.settings, loaded.row.settings)) {
        if (!(await canChangeWorkflowVisibility(userId, params.id))) {
          return reply.status(403).send({
            error: {
              code: "forbidden",
              message: "Only the owner or a workspace admin can change who this is shared with",
            },
          })
        }
      }
      updates.settings = body.settings
    }
    if (body.sourcePrompt !== undefined) updates.source_prompt = body.sourcePrompt
    if (body.thumbnailUrl !== undefined) updates.thumbnail_url = body.thumbnailUrl

    // Visibility is a different power from editing, asked of a different
    // authority: the creator, or an admin of the workspace the work lives in.
    // An editor may change the canvas all day and still not decide who the
    // class gets to see it — that would be publishing somebody else's work.
    //
    // Asked only when the field is actually present, so an ordinary save never
    // pays for a question it is not asking.
    if (body.visibility !== undefined) {
      if (target.workspace_id === null) {
        // Nothing to be visible TO. Storing the value would leave a field that
        // reads as a setting and governs nothing — worse than a refusal,
        // because the caller would believe they had shared something.
        return reply.status(400).send({
          error: {
            code: "not_workspace_scoped",
            message: "This workflow is not in a workspace, so it has no visibility to change.",
          },
        })
      }
      if (!(await canChangeWorkflowVisibility(userId, params.id))) {
        return reply.status(403).send({
          error: {
            code: "forbidden",
            message: "Only the owner or a workspace admin can change who this is shared with",
          },
        })
      }
      updates.visibility = body.visibility
    }

    // Cross-project move. This predates the move endpoint and keeps working,
    // but it goes through the SAME authorization — refusing it instead would
    // break clients that have always used it, and letting it keep its own,
    // narrower check would leave two answers to one question, with the older
    // and more permissive one winning by being forgotten.
    //
    // folder_id is nulled because folders are project-scoped and a stale id
    // would orphan the row. An explicit folderId in the same request takes
    // precedence and the FK validates it against the new project.
    // Kept in scope past the write: sharing the authorization is only half of
    // "one rule". A move that changes workspace also drops the collaborator
    // grants, and a path that authorizes identically but skips the
    // consequence is a second rule wearing the first one's name.
    let move: MoveAuthorized | null = null
    if (body.projectId !== undefined) {
      const verdict = await authorizeWorkflowMove(req, userId, params.id, body.projectId)
      if (isMoveUndecided(verdict)) {
        return sendInternalError(reply, req, verdict.dbError, "Failed to update workflow")
      }
      if (isMoveRefusal(verdict)) {
        return reply.status(verdict.status).send({
          error: { code: verdict.code, message: verdict.message },
        })
      }
      move = verdict
      updates.project_id = body.projectId
      if (body.folderId === undefined) updates.folder_id = null
    }

    let updateQuery = supabase
      // A workspace editor writing a class workflow is not the row's creator,
      // so this cannot be scoped by user_id any more.
      // tenant-scope-ignore: authorized by loadWorkflowFor(..., "edit") above.
      .from("workflows")
      .update(updates)
      .eq("id", params.id)
    if (body.expectedUpdatedAt) {
      updateQuery = updateQuery.eq("updated_at", body.expectedUpdatedAt)
    }
    if (body.expectedVersion !== undefined) {
      updateQuery = updateQuery.eq("version", body.expectedVersion)
    }

    const { data, error } = await updateQuery
      .select(WORKFLOW_FULL_COLS)
      .maybeSingle()

    // `.maybeSingle()` returns `{ data: null, error: null }` on 0 rows
    // (no PGRST116 to special-case). Any non-null error here is a real
    // DB failure — surface as 500.
    if (error) return sendInternalError(reply, req, error, "Failed to update workflow")
    if (!data) {
      // 0 rows matched. If the caller opted into optimistic concurrency,
      // the row exists but `updated_at` shifted (another tab/device wrote
      // first) — return 409 with the current `updated_at` so the caller
      // can refetch + merge. If the caller did NOT supply
      // expectedUpdatedAt, the row truly doesn't exist (or isn't owned).
      if (body.expectedUpdatedAt || body.expectedVersion !== undefined) {
        const { data: currentRow } = await supabase
          // Same reason as the update above — and it must match it exactly.
          // Left scoped by user_id, this re-read would miss for every workspace
          // editor, turning their perfectly ordinary save conflict into "your
          // workflow does not exist".
          // tenant-scope-ignore: authorized by loadWorkflowFor(..., "edit") above.
          .from("workflows")
          .select(WORKFLOW_FULL_COLS)
          .eq("id", params.id)
          .maybeSingle()
        const current = currentRow as Record<string, unknown> | null
        if (current?.updated_at) {
          return reply.status(409).send({
            error: {
              code: "workflow_conflict",
              message: "Workflow was updated by another writer",
              currentUpdatedAt: current.updated_at,
              currentVersion: (current as { version?: number }).version,
              // Full current record so a stale writer can merge-and-retry
              // without a follow-up GET (the studio merge-on-409 contract —
              // fetched only on the conflict path, never on happy saves).
              currentRecord: toWorkflowFull(current),
            },
          })
        }
      }
      return notFound(reply, "Workflow not found")
    }

    // Same consequence as the move endpoint, reported the same way. Reported
    // only when something was actually dropped, so a plain PATCH keeps the
    // response shape it has always had.
    if (move) {
      const droppedCollaborators = await dropStaleCollaborators(
        req,
        params.id,
        move.workflow.workspaceId,
        move.targetProject.workspaceId,
      )
      if (droppedCollaborators.length > 0) {
        return { data: toWorkflowFull(data), droppedCollaborators }
      }
    }

    // Late origin stamping: a client app (voice-changer-pro) creates a bare
    // conversion and writes its `settings.<key>` marker on the FIRST PATCH. If
    // this settings write reveals an app marker on a row that is still native
    // (app_slug NULL — e.g. it was created before this project was classified),
    // stamp it now so it drops out of the native workflow list. Guarded on
    // `app_slug IS NULL` so an already-classified row is never re-labelled, and
    // best-effort: the row is already saved, so a stamp hiccup must not 500 the
    // save (the next settings write, or the backfill, reclassifies it). An
    // app_slug-only update does not bump `version` (trigger 218), so this never
    // disturbs optimistic concurrency.
    if (body.settings !== undefined && (data.app_slug ?? null) === null) {
      const inferred = await inferAppSlugFromSettings(body.settings)
      if (inferred) {
        const { error: stampErr } = await supabase
          // As above: the save this follows was authorized by access, not by
          // ownership, so scoping the stamp by creator would silently skip it
          // for every workspace editor and leave the row unclassified.
          // tenant-scope-ignore: authorized by loadWorkflowFor(..., "edit") above.
          .from("workflows")
          .update({ app_slug: inferred })
          .eq("id", params.id)
          .is("app_slug", null)
        if (stampErr) {
          req.log.warn({ err: stampErr, workflowId: params.id }, "workflow app_slug stamp failed")
        } else {
          ;(data as Record<string, unknown>).app_slug = inferred
        }
      }
    }

    return { data: toWorkflowFull(data) }
  })

  // Delete workflow
  app.delete("/v1/workflows/:id", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const params = parseWith(reply, workflowIdParams, req.params, "Invalid workflow ID")
    if (!params) return

    // Deleting is its own question, not "edit and then some". A collaborator
    // holding an editor grant may change the work and must never be able to
    // end it — the grant was given to help with it. So `view` is only enough
    // to earn a 403 instead of a 404 here; the decision itself is
    // `canDeleteWorkflow`.
    const loaded = await loadWorkflowFor(
      req, reply, userId, params.id, "view",
      "id, user_id, workspace_id, visibility, name",
      "Failed to delete workflow",
    )
    if (!loaded.ok) return
    const row = toAccessRow(loaded.row)

    if (!(await canDeleteWorkflow(userId, params.id))) {
      return reply.status(403).send({
        error: {
          code: "forbidden",
          message: "Only the owner or a workspace admin can delete this workflow",
        },
      })
    }

    // Somebody other than the creator is deleting a workspace member's work.
    // That power exists ONLY through this route — the row policies admit the
    // creator and nobody else — and the reason it is granted here is that here
    // it can be attributed. So the entry is written BEFORE the delete and the
    // delete does not happen without it: after the row is gone there is
    // nothing left to refuse, and an unattributable deletion is exactly what
    // routing this through the application was meant to prevent.
    //
    // A personal workflow has no organization for an entry to belong to, and a
    // creator deleting their own work is not the case this guards, so neither
    // reaches it — both keep the behaviour they have always had.
    // A non-creator deleting a PERSONAL workflow has no organization for the
    // entry to belong to — and therefore no way to be recorded. Only a
    // platform admin can reach that combination (they resolve to `own`
    // everywhere), and it is the single most consequential delete in the
    // product: somebody else's private work, gone, with nobody's name on it.
    //
    // The invariant this route is built around is "a non-creator deletion is
    // recorded, or it does not happen". Where it cannot be recorded, it does
    // not happen — which is also exactly what this route answered before the
    // access rule widened it. The admin surfaces remain, and they audit.
    if (row.user_id !== userId && row.workspace_id === null) {
      req.log.warn(
        { workflowId: params.id, actorId: userId, creatorId: row.user_id },
        "[workflows/delete] refused: a personal workflow cannot be deleted on someone else's behalf",
      )
      return reply.status(403).send({
        error: {
          code: "forbidden",
          message: "Only the owner can delete this workflow",
        },
      })
    }

    const workspaceOfSomeoneElsesWork =
      row.user_id !== userId ? row.workspace_id : null
    if (workspaceOfSomeoneElsesWork !== null) {
      const recorded = await auditWorkflowDeleted({
        actorId: userId,
        workflowId: params.id,
        workflowName: (loaded.row.name as string | null) ?? "",
        workspaceId: workspaceOfSomeoneElsesWork,
        creatorId: row.user_id,
      })
      if (!recorded) {
        req.log.error(
          { workflowId: params.id, actorId: userId, workspaceId: workspaceOfSomeoneElsesWork },
          "[workflows/delete] refused: the audit entry could not be written",
        )
        return reply.status(503).send({
          error: {
            code: "audit_unavailable",
            message: "This deletion could not be recorded, so it was not performed. Try again later.",
          },
        })
      }
    }

    // Atomic, and it preserves a server-only cleanup manifest for private
    // Recast remux bases before the workflow -> jobs -> recast_audio_bases
    // cascade erases their database pointers.
    //
    // `userId` is the CREATOR's, not the caller's. The RPC filters its row by
    // `user_id = p_user_id`; called with the service role, that parameter is a
    // row filter and not an identity claim, and the caller's right to be here
    // was settled by `canDeleteWorkflow` two statements ago. Passing the
    // caller's id instead would silently no-op every admin deletion — the
    // filter would match nothing and the route would answer 404 for a workflow
    // it had just confirmed the caller may delete.
    let deleted: boolean
    try {
      deleted = await deleteWorkflowWithPrivateMedia({
        workflowId: params.id,
        userId: row.user_id,
        logger: req.log,
      })
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to delete workflow")
    }
    if (!deleted) return sendNotFound(reply, "Workflow not found")
    return { success: true }
  })

  // Export workflow as portable JSON bundle
  app.get("/v1/workflows/:id/export", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return

    const params = parseWith(reply, workflowIdParams, req.params, "Invalid workflow ID")
    if (!params) return

    const query = parseWith(reply, exportWorkflowQuery, req.query, "Invalid query")
    if (!query) return
    const includeAssets = query.assets

    const loaded = await loadWorkflowFor(
      req, reply, userId, params.id, "view", WORKFLOW_FULL_COLS, "Failed to export workflow",
    )
    if (!loaded.ok) return
    const wf = loaded.row

    const rawNodes = asObjectArray(wf.nodes)
    const result: WorkflowExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      name: wf.name as string,
      nodes: (includeAssets ? rawNodes : stripExportContent(rawNodes as any)) as any,
      edges: (wf.edges ?? []) as any,
      settings: (wf.settings ?? {}) as Record<string, unknown>,
    }

    if (includeAssets) {
      // Bundled assets stay scoped to the CALLER, not the workflow's creator.
      // Being allowed to read one workflow is not being allowed to walk out
      // with the characters and locations behind it — so a shared workflow
      // exported by a collaborator comes back with the graph and without the
      // entities they were never given. Deliberate; do not "fix" it by passing
      // the creator's id.
      const ids = collectAssetIds(rawNodes)
      const assetsResult = await fetchExportAssets(ids, userId)
      if ("error" in assetsResult) return sendInternalError(reply, req, assetsResult.error, "Failed to export workflow")
      result.assets = assetsResult
    }

    // Media another instance cannot fetch (a private host's own storage,
    // #866) — listed so the exporter hears it now, not at Run time elsewhere.
    // The bundled ENTITIES' images ride the same check (#1088): a character
    // whose portrait only this host can serve is as unportable as a still.
    const unreachableMedia = findUnroutableMedia(result.nodes, result.assets)
    if (unreachableMedia.length > 0) result.portability = { unreachableMedia }

    return reply.send(result)
  })

  // Import a workflow from a portable JSON bundle, re-creating bundled assets
  // (characters, objects, creatures, locations) under the caller's account.
  app.post("/v1/workflows/import", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const parsed = importWorkflowBody.safeParse(req.body)
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }

    const { projectId, workflow_json: wf } = parsed.data

    if (refuseIfWorkspaceArchived(req, reply)) return

    if (!(await resolveProjectScope(req, userId, projectId))) {
      return notFound(reply, "Project not found")
    }

    // Copy the bundle's media into the importer's own storage BEFORE anything
    // is created from it. The graph's media is the #866 case (foreign hosts);
    // the bundled ENTITIES' images are #1088's, and they are copied even when
    // they already sit on this instance — they are the EXPORTER's bytes, and
    // their delete / quarantine sweep / retention reaper answer to nobody
    // here. Both halves ride ONE pass, so a still and the chip pointing at it
    // are fetched and charged once. Never throws: what could not be copied is
    // in the report, and the workflow still lands.
    //
    // This runs before the workflow row exists because `reCreateAssets` must
    // insert rows that already point at the copies — the entity inserts were
    // always ahead of the workflow insert, so the copy joins them there.
    const {
      nodes: portableNodes,
      assets: portableAssets,
      report: importReport,
    } = await rehostForeignMedia(wf.nodes, userId, wf.assets ? { assets: wf.assets } : {})

    // Re-create bundled assets, mapping old DB id → the new row (node_id preserved).
    let assetIdMap: CreatedAssetMap = new Map()
    if (portableAssets) {
      const result = await reCreateAssets(portableAssets, userId, projectId)
      if (result instanceof Map) {
        assetIdMap = result
      } else {
        return sendInternalError(reply, req, result.error, "Failed to import workflow")
      }
    }

    // Node entity fields AND the `@`-chips bound in node data both follow the
    // re-created rows (#1088) — a chips-only graph (every studio production)
    // arrives bound instead of dangling.
    const remappedNodes = remapNodeAssetIds(portableNodes, assetIdMap)
    if (assetIdMap.size > 0) {
      // The map leaves the server so a client holding chips OUTSIDE the graph
      // can finish the same job (published wire contract).
      importReport.assetIdMap = Object.fromEntries(
        [...assetIdMap].map(([bundleId, created]) => [bundleId, created.id]),
      )
    }

    const migratedEdges = migrateGenerateImageHandles(
      remappedNodes as Array<{ id: string; type?: string }>,
      (wf.edges ?? []) as Array<{ id: string; source: string; target: string; sourceHandle: string | null; targetHandle: string | null }>,
    )

    const { data: newWorkflow, error: wfError } = await supabase
      .from("workflows")
      .insert({
        project_id: projectId,
        user_id: userId,
        name: wf.name,
        nodes: remappedNodes,
        edges: migratedEdges,
        settings: wf.settings ?? {},
        // Where this row came from. The importer is recorded as the original
        // author because the bundle format carries no author — adding one is
        // a change to a published wire contract, and an import from an
        // unsigned file cannot honestly claim anyone else wrote it.
        source_kind: "import",
        source_id: null,
        original_author_id: userId,
      })
      .select(WORKFLOW_FULL_COLS)
      .single()

    if (wfError || !newWorkflow) {
      return sendInternalError(reply, req, wfError, "Failed to create workflow")
    }

    const finalRow = newWorkflow as Record<string, unknown>

    return reply
      .status(201)
      .send({ data: toWorkflowFull(finalRow), importReport })
  })

  // Move a workflow into another project.
  //
  // Authorized by workflows:write — a move IS a workflow write, and a new
  // OAuth scope is a one-way door: ALL_SCOPES is published in
  // scopes_supported and handed to dynamically-registered clients, so a scope
  // added here can never be taken back.
  app.post("/v1/workflows/:id/move", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const params = parseWith(reply, workflowIdParams, req.params, "Invalid workflow ID")
    if (!params) return

    const body = parseWith(reply, moveWorkflowBody, req.body, "Invalid request")
    if (!body) return

    const verdict = await authorizeWorkflowMove(req, userId, params.id, body.projectId)
    if (isMoveUndecided(verdict)) {
      return sendInternalError(reply, req, verdict.dbError, "Failed to move workflow")
    }
    if (isMoveRefusal(verdict)) {
      return reply.status(verdict.status).send({
        error: { code: verdict.code, message: verdict.message },
      })
    }

    // folder_id is cleared for the same reason PATCH clears it: folders belong
    // to a project, so an id from the old one would orphan the row.
    const { data, error } = await supabase
      // A workspace admin moving a member's work is not the row's user_id,
      // so this cannot be scoped by it.
      // tenant-scope-ignore: authorizeWorkflowMove above is the authorization.
      .from("workflows")
      .update({ project_id: body.projectId, folder_id: null })
      .eq("id", params.id)
      .select(WORKFLOW_FULL_COLS)
      .single()

    if (error) return sendInternalError(reply, req, error, "Failed to move workflow")

    const droppedCollaborators = await dropStaleCollaborators(
      req,
      params.id,
      verdict.workflow.workspaceId,
      verdict.targetProject.workspaceId,
    )

    return reply.send({ data: toWorkflowFull(data), droppedCollaborators })
  })

  // Create a child sub-workflow under a parent
  app.post("/v1/workflows/:parentId/sub-workflows", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const params = parseWith(
      reply,
      z.object({ parentId: z.string().uuid() }),
      req.params,
      "Invalid parent workflow ID",
    )
    if (!params) return

    const body = parseWith(reply, createSubWorkflowBody, req.body ?? {}, "Invalid request")
    if (!body) return

    // The fifth create path, and the one the first pass missed. A sub-workflow
    // is a new workflow row like any other — it just inherits its project from
    // its parent instead of naming one — so an archived workspace has to
    // refuse it too, or "read-only" is only true of the four routes somebody
    // remembered.
    if (refuseIfWorkspaceArchived(req, reply)) return

    // Import / template / SDK writes never pass through the node pickers, so
    // this is where a Cloud-only node would otherwise slip into an edition
    // that can't run it.
    if (!hasCredits()) {
      const cloudOnly = findCloudOnlyNodeTypes((body as { nodes?: unknown }).nodes as ReadonlyArray<{ type?: unknown }> | undefined)
      if (cloudOnly.length > 0) {
        return validationError(reply, cloudOnlyRejectionMessage(cloudOnly))
      }
    }
    // Deployment surface deny (B1) applies on every edition the gate is open for
    // (business+), so it sits beside the Cloud-only guard, not inside it.
    const deniedNodes = findDeniedNodeTypes((body as { nodes?: unknown }).nodes as ReadonlyArray<{ type?: unknown }> | undefined)
    if (deniedNodes.length > 0) {
      return validationError(reply, deniedNodeRejectionMessage(deniedNodes))
    }

    // 1. Verify the caller may EDIT the parent + grab its project_id. A
    // sub-workflow is part of the parent's graph, so adding one is an edit of
    // it — which is why a workspace member may add one to class work they can
    // legitimately edit but did not create.
    const loadedParent = await loadWorkflowFor(
      req, reply, userId, params.parentId, "edit",
      "id, project_id, user_id, workspace_id, visibility",
      "Failed to create sub-workflow",
    )
    if (!loadedParent.ok) return
    const parent = loadedParent.row as {
      id: string
      project_id: string | null
      user_id: string
    }

    // 2. Seed a default route — one input + one output sharing a routeId
    const routeId = crypto.randomUUID()
    const seededNodes = [
      {
        id: `input_${routeId}`,
        type: "sub-workflow-input",
        position: { x: 100, y: 200 },
        data: {
          label: "Inputs",
          routeId,
          ports: [{ id: "in_1", name: "input", mediaType: "any" }],
        },
      },
      {
        id: `output_${routeId}`,
        type: "sub-workflow-output",
        position: { x: 900, y: 200 },
        data: {
          label: "Outputs",
          routeId,
          ports: [{ id: "out_1", name: "output", mediaType: "any" }],
          visibleOutputPortId: "out_1",
        },
      },
    ]

    const { data: child, error: childErr } = await supabase
      .from("workflows")
      .insert({
        project_id: parent.project_id,
        // The PARENT's creator, not the caller. A sub-workflow is a part of
        // its parent, not a work of its own: it lives in the parent's project,
        // it dies with the parent, and — the part that made this load-bearing
        // once editing stopped meaning ownership — the orchestrator resolves
        // sub-workflow references by the parent's owner. A child stamped with
        // a collaborator's id resolves to nothing, so the graph they just
        // built would fail at run time; and it would put a row they own inside
        // a project its owner cannot see into.
        user_id: parent.user_id,
        parent_workflow_id: parent.id,
        name: body.name,
        nodes: seededNodes,
        edges: [],
        settings: {},
      })
      .select(WORKFLOW_FULL_COLS)
      .single()

    if (childErr) return sendInternalError(reply, req, childErr, "Failed to create sub-workflow")

    return reply.status(201).send({ data: toWorkflowFull(child) })
  })

  // Run workflow — handled by workflow-execution.ts route
  // (POST /v1/workflows/:id/run is registered there)
}
