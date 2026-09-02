import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { resolveTemplate, applyTemplate } from "../config/prompt-templates.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate, extractProvider } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { buildFaceTemplateInputs, containsMinorAgeHint } from "@nodaro/prompts"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

const generateFaceBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  // Free-text style (matches the entity save route + DB; a narrow enum would 400 inherited styles like "cinematic").
  style: z.string().max(50).optional(),
  prompt: z.string().max(4000).optional(),
  userPrompt: z.string().max(8000).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  provider: z.string().optional().default("nano-banana"),
  userId: z.string().uuid().optional(),
})

export async function generateFaceRoutes(app: FastifyInstance) {
  app.post("/v1/generate-face", { preHandler: creditGuard((req) => extractProvider(req.body, "nano-banana")) }, async (req, reply) => {
    const parsed = generateFaceBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { name, description, style, prompt: clientPrompt, sourceImageUrl } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = parsed.data.provider

    // Use client-provided prompt (which includes flow+user template resolution)
    // or fall back to server-side template resolution (for direct API calls)
    let prompt: string
    if (clientPrompt) {
      prompt = clientPrompt
    } else {
      let userTemplates: Record<string, string> = {}
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("prompt_templates")
          .eq("id", userId)
          .single()
        userTemplates = (profile?.prompt_templates as Record<string, string>) ?? {}
      } catch {
        // Ignore - use system defaults
      }

      const template = resolveTemplate("face-generation", userTemplates)
      prompt = applyTemplate(template, buildFaceTemplateInputs({ name, description, style }))
    }

    // ────────────────────────────────────────────────────────────────────────
    // W1-a minor-age floor — the generate-face lane.
    //
    // This route feeds `makeEntityImageHandler("generate-face")`, the SAME
    // entity-image chokepoint the character lanes use, with a prompt the CLIENT
    // built. It had no age signal at all, so a face request carrying the
    // incident wording reached the provider with the floor switched off while
    // the character lane next to it was covered.
    //
    // There is no structured picker value on this lane (a face has no `person`
    // field on the row or in the body), so the text signal is the whole signal
    // — `containsMinorAgeHint` over the assembled prompt PLUS every free-text
    // field the assembly consumes. The raw fields ride along rather than
    // relying on `prompt` alone because the "face-generation" template is
    // user- and flow-overridable: an override that drops `{description}` would
    // otherwise hide the age from the detector while the description still
    // reaches the model through some other surface. Joined with a sentence
    // break so no needle can be formed ACROSS a field boundary.
    //
    // Not a bare-word check (see `containsMinorAgeHint`), so an adult face
    // request stays byte-identical.
    // ────────────────────────────────────────────────────────────────────────
    const subjectMinor = containsMinorAgeHint(
      [prompt, name, description, parsed.data.userPrompt, style]
        .filter((t): t is string => typeof t === "string" && t.length > 0)
        .join(". "),
    )

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        // `subjectMinor` is persisted, not just enqueued: a floored job has to
        // be auditable from the row alone.
        input_data: { ...buildJobInputData(parsed.data, "generate-face"), prompt, subjectMinor },
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("generate-face", {
      jobId: job.id,
      prompt,
      sourceImageUrl,
      provider: parsed.data.provider,
      // W1-a: arms the minor-age-floor policy at the entity image chokepoint
      // (`makeEntityImageHandler` destructures `subjectMinor` for every job
      // name it serves, this one included). Absent → identity.
      subjectMinor,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
