import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import {
  DOMAIN_RE,
  IMPORT_SOURCE_STATUSES,
  ImportSourceVersionError,
  listImportSourcePolicies,
  normalizeDomain,
  policiesVersion,
  replaceImportSourcePolicies,
} from "../../lib/import-source-policy.js"

/**
 * Admin → Settings → Import sources (migration 578; lib/import-source-policy.ts):
 * the sites a link may come from and what was decided about each. Admin
 * session only; every save is audited. A site with no row is approved. The
 * list answers with its `version`; a save sends it back and is refused
 * (409 `import_sources_changed`) when the list moved since.
 */
const policyBody = z.strictObject({
  domain: z
    .string()
    .transform(normalizeDomain)
    .pipe(z.string().regex(DOMAIN_RE, "A domain such as example.com (punycode for an international name)")),
  status: z.enum(IMPORT_SOURCE_STATUSES),
  note: z.string().trim().max(500).nullable().optional(),
})

const listBody = z.strictObject({ policies: z.array(policyBody).max(200), version: z.string().max(40) })

export async function adminImportSourcesRoutes(app: FastifyInstance) {
  app.get("/v1/admin/import-sources", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const policies = await listImportSourcePolicies({ fresh: true })
      return { data: policies, version: policiesVersion(policies) }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the import sources")
    }
  })

  app.put("/v1/admin/import-sources", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = listBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const domains = parsed.data.policies.map((p) => p.domain)
    if (new Set(domains).size !== domains.length) {
      return reply.status(400).send({ error: { code: "validation_error", message: "A domain is listed twice" } })
    }
    try {
      const policies = await replaceImportSourcePolicies(parsed.data.policies, req.userId ?? null, parsed.data.version)
      await audit(req, "update_import_source_policies", "import_source_policies", "all", {
        domains: policies.map((p) => `${p.domain}=${p.status}`),
      })
      return { data: policies, version: policiesVersion(policies) }
    } catch (e) {
      if (e instanceof ImportSourceVersionError) return reply.status(409).send({ error: { code: e.code, message: e.message } })
      return sendInternalError(reply, req, e, "Failed to save the import sources")
    }
  })
}
