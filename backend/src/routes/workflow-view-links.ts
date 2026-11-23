/**
 * A workflow's view link, the owner's side (decided 2026-11-23):
 *
 *   GET    /v1/workflows/:id/view-link          the link's state
 *   POST   /v1/workflows/:id/view-link          turn it on (idempotent) { locale? }
 *   PATCH  /v1/workflows/:id/view-link          { indexable }
 *   POST   /v1/workflows/:id/view-link/export   save (or replace) the downloadable copy { includeAssets }
 *   DELETE /v1/workflows/:id/view-link/export   stop offering the copy
 *   DELETE /v1/workflows/:id/view-link          turn it off: the link and its embed stop answering
 *
 * The view link shows the canvas, read-only, to anyone who holds it
 * (routes/workflow-views.ts). It is separate from the presentation link
 * (routes/presentation.ts), which lets a viewer RUN the workflow.
 *
 * CREATOR-ONLY, like the presentation link and for the same reason: turning a
 * public link on is a disclosure decision, not an edit, so a collaborator
 * with edit access does not get it. Work in a workspace is not offered a view
 * link, as it is not offered a share link (routes/shares.ts). A deployment
 * that does not allow public work offers none either.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { sendInternalError } from "../lib/http-errors.js"
import { formatZodError } from "../lib/zod-error.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { surfaceAllowsPublicOutputs } from "../lib/surface-profile.js"
import { normalizeShareLocale } from "../lib/share-links/card-locale.js"
import { viewLinksTablePresent } from "../lib/workflow-view/table.js"
import {
  ViewLinkMissingError,
  ViewLinksUnavailableError,
  enableViewLink,
  readViewLinkOf,
  revokeViewLink,
  updateViewLink,
  readOwnWorkflow,
  viewLinkState,
  type OwnWorkflow,
} from "../lib/workflow-view/store.js"
import { buildViewExport } from "../lib/workflow-view/export-snapshot.js"
import { warmViewCard } from "../lib/workflow-view/card-content.js"
import { enableViewLinkBody, saveViewExportBody, updateViewLinkBody, viewWorkflowParams } from "../lib/workflow-view/schemas.js"
import "./workflow-view-links-docs.js"

const WRITE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }
/** Saving a copy reads the whole graph and its entities: fewer per minute. */
const EXPORT_LIMIT = { rateLimit: { max: 10, timeWindow: "1 minute" } }

type Refusal = "workspace" | "sharing_disabled"

const REFUSAL_MESSAGES: Readonly<Record<Refusal, string>> = {
  workspace: "A workflow in a workspace cannot be shared by link.",
  sharing_disabled: "Sharing by link is not available on this server.",
}

function badRequest(reply: FastifyReply, error: Parameters<typeof formatZodError>[0]) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
}

function notAvailable(reply: FastifyReply) {
  return reply.status(503).send({ error: { code: "not_available", message: "View links are not available on this server yet." } })
}

/**
 * The caller's own workflow (its creator), or null after an answer. Asks the
 * table gate first, so a database without the table answers 503 before any read.
 */
async function ownWorkflow(req: FastifyRequest, reply: FastifyReply): Promise<OwnWorkflow | null> {
  if (!req.userId) {
    reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return null
  }
  const params = viewWorkflowParams.safeParse(req.params)
  if (!params.success) {
    badRequest(reply, params.error)
    return null
  }
  if (!viewLinksTablePresent()) {
    notAvailable(reply)
    return null
  }
  const workflow = await readOwnWorkflow(req.userId, params.data.id)
  if (!workflow) {
    notFound(reply)
    return null
  }
  return workflow
}

/** Why the workflow may not be shown by link now, or null. */
function refusalOf(workflow: OwnWorkflow): Refusal | null {
  if (!surfaceAllowsPublicOutputs()) return "sharing_disabled"
  if (workflow.workspace_id) return "workspace"
  return null
}

function refuse(reply: FastifyReply, refusal: Refusal) {
  return reply.status(422).send({ error: { code: "share_not_allowed", reason: refusal, message: REFUSAL_MESSAGES[refusal] } })
}

/** The one catch every owner route ends in. */
function failed(req: FastifyRequest, reply: FastifyReply, err: unknown, message: string) {
  if (err instanceof ViewLinksUnavailableError) return notAvailable(reply)
  if (err instanceof ViewLinkMissingError) return reply.status(404).send({ error: { code: "not_found", message: "This workflow has no view link." } })
  return sendInternalError(reply, req, err, message)
}

export async function workflowViewLinkRoutes(app: FastifyInstance) {
  app.get("/v1/workflows/:id/view-link", { preHandler: requireAppScope("workflows:read") }, async (req, reply) => {
    try {
      const workflow = await ownWorkflow(req, reply)
      if (!workflow) return
      const row = await readViewLinkOf(workflow.id)
      return reply.send(viewLinkState(row && row.owner_id === workflow.user_id ? row : null))
    } catch (err) {
      return failed(req, reply, err, "Failed to read the view link")
    }
  })

  app.post("/v1/workflows/:id/view-link", { preHandler: requireAppScope("workflows:write"), config: WRITE_LIMIT }, async (req, reply) => {
    try {
      const body = enableViewLinkBody.safeParse(req.body ?? undefined)
      if (!body.success) return badRequest(reply, body.error)
      const workflow = await ownWorkflow(req, reply)
      if (!workflow) return
      const refusal = refusalOf(workflow)
      if (refusal) return refuse(reply, refusal)
      const row = await enableViewLink(workflow.id, workflow.user_id, normalizeShareLocale(body.data?.locale) ?? null)
      // The preview picture is rendered now, in the background.
      void warmViewCard({ link: row, workflow })
      return reply.send(viewLinkState(row))
    } catch (err) {
      return failed(req, reply, err, "Failed to turn the view link on")
    }
  })

  app.patch("/v1/workflows/:id/view-link", { preHandler: requireAppScope("workflows:write"), config: WRITE_LIMIT }, async (req, reply) => {
    try {
      const body = updateViewLinkBody.safeParse(req.body)
      if (!body.success) return badRequest(reply, body.error)
      const workflow = await ownWorkflow(req, reply)
      if (!workflow) return
      const row = await updateViewLink(workflow.id, workflow.user_id, { indexable: body.data.indexable })
      return reply.send(viewLinkState(row))
    } catch (err) {
      return failed(req, reply, err, "Failed to update the view link")
    }
  })

  app.post("/v1/workflows/:id/view-link/export", { preHandler: requireAppScope("workflows:write"), config: EXPORT_LIMIT }, async (req, reply) => {
    try {
      const body = saveViewExportBody.safeParse(req.body)
      if (!body.success) return badRequest(reply, body.error)
      const workflow = await ownWorkflow(req, reply)
      if (!workflow) return
      const refusal = refusalOf(workflow)
      if (refusal) return refuse(reply, refusal)
      // The copy belongs to a live link: no link, nothing to attach it to.
      const existing = await readViewLinkOf(workflow.id)
      if (!existing || existing.owner_id !== workflow.user_id) throw new ViewLinkMissingError()
      const now = new Date()
      const built = await buildViewExport(workflow, body.data.includeAssets, now)
      if (!built.ok) {
        return reply.status(413).send({ error: { code: "export_too_large", message: "This workflow is too large to offer as a download." } })
      }
      const row = await updateViewLink(workflow.id, workflow.user_id, {
        export_snapshot: built.snapshot,
        export_includes_assets: body.data.includeAssets,
        exported_at: now.toISOString(),
      })
      return reply.send(viewLinkState(row))
    } catch (err) {
      return failed(req, reply, err, "Failed to save the downloadable copy")
    }
  })

  app.delete("/v1/workflows/:id/view-link/export", { preHandler: requireAppScope("workflows:write"), config: WRITE_LIMIT }, async (req, reply) => {
    try {
      const workflow = await ownWorkflow(req, reply)
      if (!workflow) return
      const row = await updateViewLink(workflow.id, workflow.user_id, { export_snapshot: null, export_includes_assets: null, exported_at: null })
      return reply.send(viewLinkState(row))
    } catch (err) {
      return failed(req, reply, err, "Failed to remove the downloadable copy")
    }
  })

  app.delete("/v1/workflows/:id/view-link", { preHandler: requireAppScope("workflows:write"), config: WRITE_LIMIT }, async (req, reply) => {
    try {
      const workflow = await ownWorkflow(req, reply)
      if (!workflow) return
      await revokeViewLink(workflow.id)
      return reply.send(viewLinkState(null))
    } catch (err) {
      return failed(req, reply, err, "Failed to turn the view link off")
    }
  })
}
