import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertSyncJob } from "../lib/insert-job.js"
import { sendInternalError } from "../lib/http-errors.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { safeFetch } from "../lib/safe-fetch.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { canRunWorkflow } from "../lib/workflow-access.js"
import { HttpCredentialError, credentialedWebhookNodes, resolveHttpAuthHeaders, type ResolvedHttpAuth } from "../lib/http-credentials.js"
import { completedJobColumns } from "../lib/job-status.js"
import { markJobFailed } from "../lib/job-failure.js"

const sendSchema = z.object({
  url: safeUrlSchema,
  payload: z.record(z.string(), z.unknown()),
  workflowId: z.string().uuid().optional(),
  /** A stored credential (`/v1/http-credentials`) to send with. Requires `workflowId`. */
  credentialId: z.string().uuid().optional(),
  forcePrivate: z.boolean().optional(),
})

function isBlockedUpstreamUrlError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.startsWith("safeFetch: blocked") ||
    error.message.includes("private/reserved IP")
  )
}

/**
 * The DETAIL a failed credentialed send may carry (after "Webhook POST
 * failed: "). safeFetch's own refusals are fixed text of ours (a host at most,
 * never a header value); anything else — an undici error, a socket error — is
 * replaced by a fixed word, because a transport error message can embed the
 * request it was building.
 */
function credentialedFailureMessage(err: unknown): string {
  if (err instanceof Error && err.message.startsWith("safeFetch: blocked")) return err.message
  return "transport error"
}

export async function webhookOutputRoutes(app: FastifyInstance) {
  app.post("/v1/webhook-output/send", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = sendSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten().fieldErrors })
    }

    const { url, payload, credentialId, workflowId } = parsed.data
    const userId = req.userId

    // A stored credential resolves for the WORKFLOW OWNER (plan D7), so a
    // credentialed send has to name the workflow it belongs to — the caller's
    // identity alone does not say whose key may travel.
    let auth: ResolvedHttpAuth | null = null
    if (credentialId) {
      if (!workflowId) {
        return reply.status(400).send({
          error: { code: "credential_requires_workflow", message: "A stored credential can only be sent from a saved workflow: pass workflowId." },
        })
      }
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      const { data: workflow } = await supabase
        // tenant-scope-ignore: authorization follows immediately, below.
        .from("workflows")
        .select("id, user_id, nodes")
        .eq("id", workflowId)
        .maybeSingle()
      if (!workflow || !(await canRunWorkflow(userId, workflowId))) {
        return reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
      }
      // The credential has to be the one a Webhook Output of THIS workflow
      // carries: being allowed to run one of the owner's workflows is not a
      // licence to fire any of the owner's credentials at any payload.
      const onGraph = credentialedWebhookNodes(
        workflow.nodes as ReadonlyArray<{ id: string; type?: string; data?: Record<string, unknown> }> | null,
      ).some((use) => use.credentialId === credentialId)
      if (!onGraph) {
        return reply.status(400).send({
          error: {
            code: "credential_not_in_workflow",
            message: "Save the workflow with this credential picked on the Webhook Output node, then send again.",
          },
        })
      }
      const ownerId = workflow.user_id as string
      try {
        // Owner-initiated = the owner's own BROWSER session. A personal API
        // token or an OAuth app token also sets req.userId to the owner, so
        // the token kind is part of the answer (plan D3).
        auth = await resolveHttpAuthHeaders(credentialId, ownerId, url, {
          ownerInitiated: req.authKind === "jwt" && userId === ownerId,
        })
      } catch (err) {
        if (err instanceof HttpCredentialError) {
          return reply.status(400).send({ error: { code: err.code, message: err.message } })
        }
        return sendInternalError(reply, req, err, "Failed to resolve the webhook credential")
      }
    }
    const credentialed = auth !== null

    // Create job record. The header value never enters input_data — only the id.
    const { data: job, error: jobError } = await insertSyncJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        provider: "webhook-output",
        input_data: buildJobInputData(parsed.data, "webhook-output"),
      })

    if (jobError || !job) {
      // Through sendInternalError, so a request-gate BLOCK answers the
      // documented 422 `job_blocked` with the policy's own message instead of
      // a 500 the SDK retries with backoff (F10). A genuine insert failure
      // still 500s, now in the documented `{error:{code,message}}` shape.
      return sendInternalError(reply, req, jobError, "Failed to create job")
    }

    try {
      // safeFetch: this endpoint returns the response body (first 2000
      // chars) back to the caller — a direct read-oracle if the target
      // URL resolves to an internal HTTP service. safeUrlSchema catches
      // literal private IPs at the Zod boundary; safeFetch catches
      // hostnames that resolve to private IPs at connect time.
      const response = await safeFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs: 30_000,
        // Auth rides the credential lane, never `headers`: safeFetch holds it
        // to https, to the binding on every hop, and drops it on a
        // cross-origin redirect (plan D6).
        ...(auth ? { credentialHeaders: auth.headers, credentialBinding: auth.binding ?? undefined } : {}),
      })

      const rawBody = await response.text().catch(() => "")
      const statusCode = response.status
      // With a credential attached the body is NOT returned, stored or shown:
      // plenty of targets reflect the request headers back (plan D10).
      const responseBody = credentialed ? "" : rawBody.slice(0, 2000)

      if (!response.ok) {
        await markJobFailed(job.id, { error_message: `Webhook POST failed (${statusCode})`, extra: { output_data: { success: false, statusCode, responseBody, ...(credentialed ? { credentialId } : {}) } } })

        return reply.status(502).send({
          jobId: job.id,
          success: false,
          statusCode,
          responseBody,
          error: `Webhook POST failed (${statusCode})`,
        })
      }

      await supabase
        .from("jobs")
        .update({
          status: "completed",
          ...completedJobColumns(),
          output_data: { success: true, statusCode, responseBody, ...(credentialed ? { credentialId } : {}) },
        })
        .eq("id", job.id)

      return reply.send({ jobId: job.id, success: true, statusCode, responseBody })
    } catch (err) {
      const message = credentialed
        ? credentialedFailureMessage(err)
        : err instanceof Error ? err.message : "Unknown error"
      await markJobFailed(job.id, { error_message: `Webhook POST failed: ${message}`, extra: { output_data: { success: false, statusCode: 0, responseBody: "" } } })

      if (isBlockedUpstreamUrlError(err)) {
        return reply.status(400).send({
          jobId: job.id,
          success: false,
          statusCode: 0,
          responseBody: "",
          error: credentialed ? message : "Webhook URL resolves to a blocked address",
        })
      }

      return reply.status(502).send({
        jobId: job.id,
        success: false,
        statusCode: 0,
        responseBody: "",
        error: `Webhook POST failed: ${message}`,
      })
    }
  })
}
