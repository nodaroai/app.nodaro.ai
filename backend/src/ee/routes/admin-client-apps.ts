import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"

/**
 * Admin management of the `client_apps` registry — the apps built on the Nodaro
 * SDK, and whether each one's workflows are user-facing.
 *
 * `workflows_listed` drives THE visibility rule for the user's workflow list: a
 * workflow shows iff it is native (`app_slug IS NULL`) or its app is listed.
 * Studio's workflows are first-class objects the user opens here (listed);
 * voice-changer-pro's are private per-conversion storage that would be junk in
 * the list (not listed). Unregistered apps are hidden — the rule fails closed.
 *
 * The registry table itself is CORE (the workflow list can't render without it);
 * only this management surface is ee/.
 */

const toggleBody = z.object({
  workflowsListed: z.boolean(),
})

interface ClientAppRow {
  slug: string
  name: string
  workflows_listed: boolean
  created_at: string
}

export async function adminClientAppsRoutes(app: FastifyInstance) {
  // GET /v1/admin/client-apps — the registry, plus how many workflows each app
  // has actually written. The count is what makes the setting legible: it shows
  // at a glance how many rows a toggle would add to, or remove from, every
  // user's workflow list.
  app.get("/v1/admin/client-apps", { preHandler: requireAdmin }, async (_req, reply) => {
    const { data, error } = await supabase
      .from("client_apps")
      .select("slug, name, workflows_listed, created_at")
      .order("slug", { ascending: true })

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const rows = (data ?? []) as ClientAppRow[]

    // One HEAD count per app. The registry holds a handful of rows, so this is
    // a couple of cheap index-only counts on idx_workflows_app_slug.
    const counts = await Promise.all(
      rows.map(async (row) => {
        const { count, error: countError } = await supabase
          // tenant-scope-ignore: deliberate cross-tenant count, admin-gated by requireAdmin.
          .from("workflows")
          .select("id", { count: "exact", head: true })
          .eq("app_slug", row.slug)
        return countError ? null : (count ?? 0)
      }),
    )

    return {
      data: rows.map((row, i) => ({
        slug: row.slug,
        name: row.name,
        workflowsListed: row.workflows_listed,
        // null when the count query failed — the UI renders "—" rather than a
        // misleading zero.
        workflowCount: counts[i],
        createdAt: row.created_at,
      })),
    }
  })

  // PATCH /v1/admin/client-apps/:slug — flip whether this app's workflows are
  // listed in app.nodaro.ai. One UPDATE re-classifies every one of the app's
  // workflows, which is the whole point of holding the flag on the app rather
  // than on each row.
  app.patch("/v1/admin/client-apps/:slug", { preHandler: requireAdmin }, async (req, reply) => {
    const { slug } = req.params as { slug: string }

    const bodyResult = toggleBody.safeParse(req.body)
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyResult.error.issues[0]?.message ?? "Invalid body",
        },
      })
    }

    const { data, error } = await supabase
      .from("client_apps")
      .update({ workflows_listed: bodyResult.data.workflowsListed })
      .eq("slug", slug)
      .select("slug, name, workflows_listed")
      .maybeSingle()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Only apps that exist can be toggled — no upsert. An unregistered slug is
    // hidden by the visibility rule anyway; quietly creating a registry entry
    // here would be a confusing way to make one appear.
    if (!data) {
      return reply.status(404).send({
        error: { code: "not_found", message: `Client app '${slug}' not found` },
      })
    }

    const row = data as ClientAppRow
    return {
      data: {
        slug: row.slug,
        name: row.name,
        workflowsListed: row.workflows_listed,
      },
    }
  })
}
