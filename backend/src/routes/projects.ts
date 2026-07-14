import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { checkIsAdmin } from "../lib/admin-check.js"
import { ensureDefaultProject } from "../lib/default-project.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import {
  clientAppVisibilityFilter,
  getListedAppSlugs,
  inferAppSlugFromSettings,
} from "../lib/client-app-stamp.js"

const projectIdParams = z.object({
  id: z.string().uuid(),
})

const createProjectBody = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

const updateProjectBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  })

const PROJECT_COLS =
  "id, user_id, name, description, settings, is_default, created_at, updated_at"

/**
 * True when a PostgREST error means `projects.app_slug` does not exist yet — a
 * DB that has not applied migration 256. Lets the admin viewAll list degrade to
 * an unfiltered query (still renders) if the backend deploys ahead of the
 * migration. Codes: 42703 (undefined_column) / PGRST204 (schema-cache miss).
 * Backend mirror of the frontend `isAppSlugColumnMissing`.
 */
function isAppSlugColumnMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === "42703" || error.code === "PGRST204") return true
  return typeof error.message === "string" && error.message.includes("app_slug")
}

function toProjectResponse(row: Record<string, unknown>, ownerEmail?: string) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    settings: row.settings,
    isDefault: row.is_default === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(ownerEmail !== undefined && { ownerEmail }),
  }
}

export async function projectRoutes(app: FastifyInstance) {
  // List projects for authenticated user (or all projects for admin with ?viewAll=true)
  app.get("/v1/projects", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const query = req.query as Record<string, string>
    const viewAll = query.viewAll === "true"

    // Admin view: return all projects with owner emails
    if (viewAll) {
      const isAdmin = await checkIsAdmin(req.userId)
      if (!isAdmin) {
        return reply.status(403).send({
          error: { code: "forbidden", message: "Admin access required" },
        })
      }

      // Client-app projects (voice-changer-pro's dedicated project) are hidden
      // from the admin "all users" list BY DEFAULT — the same rule the dashboard
      // applies to everyone, admins included. `?includeClientApps=true` (honored
      // only on this admin-gated path) lifts the exclusion so an admin who opts
      // in via the client-apps screen toggle can see them. Native OR a listed
      // app; an unknown/unregistered slug stays hidden.
      const includeClientApps = query.includeClientApps === "true"
      const listedFilter = includeClientApps
        ? null
        : clientAppVisibilityFilter(await getListedAppSlugs())

      const runViewAll = (withFilter: boolean) => {
        let q = supabase.from("projects").select(PROJECT_COLS)
        if (withFilter && listedFilter) q = q.or(listedFilter)
        return q.order("created_at", { ascending: false })
      }

      let result = await runViewAll(!includeClientApps)
      // Backend deployed ahead of migration 256 (no projects.app_slug) → degrade
      // to unfiltered so the admin view still renders.
      if (result.error && isAppSlugColumnMissing(result.error)) {
        result = await runViewAll(false)
      }
      const { data, error } = result

      if (error) {
        return sendInternalError(reply, req, error, "Failed to fetch projects")
      }

      const rows = data ?? []
      // Fetch owner emails
      const userIds = [...new Set(rows.map((r) => r.user_id as string))]
      const emailMap = new Map<string, string>()
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", userIds)
        for (const p of profiles ?? []) {
          emailMap.set(p.id as string, p.email as string)
        }
      }

      return {
        data: rows.map((row) =>
          toProjectResponse(row, emailMap.get(row.user_id as string) ?? "Unknown"),
        ),
        currentUserId: req.userId,
      }
    }

    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_COLS)
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to fetch projects")
    }

    return { data: (data ?? []).map((row) => toProjectResponse(row)) }
  })

  // Create project
  app.post("/v1/projects", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = createProjectBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { name, description, settings } = parsed.data

    // Classify the project's origin (see client-app-stamp.ts). A client app that
    // creates its per-user project writes its settings marker at birth (vcp's
    // ensureVcpProject sets `settings.vcp`), so stamp `app_slug` from it — that is
    // what keeps the "Voice Changer Pro" project out of the dashboard's project
    // list. NULL = native (created in app.nodaro.ai itself).
    const appSlug = await inferAppSlugFromSettings(settings)

    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: req.userId,
        name,
        description: description ?? null,
        settings: settings ?? {},
        app_slug: appSlug,
      })
      .select(PROJECT_COLS)
      .single()

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create project")
    }

    return reply.status(201).send({ data: toProjectResponse(data) })
  })

  // Get project by ID
  app.get("/v1/projects/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = projectIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid project ID",
        },
      })
    }

    const { id } = parsed.data

    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_COLS)
      .eq("id", id)
      .eq("user_id", req.userId)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Project not found" },
        })
      }
      return sendInternalError(reply, req, error, "Failed to fetch project")
    }

    return { data: toProjectResponse(data) }
  })

  // Update project
  app.patch("/v1/projects/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = projectIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message:
            paramsParsed.error.issues[0]?.message ?? "Invalid project ID",
        },
      })
    }

    const bodyParsed = updateProjectBody.safeParse(req.body)
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyParsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { id } = paramsParsed.data
    const { name, description, settings } = bodyParsed.data

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (settings !== undefined) updates.settings = settings

    const { data, error } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", id)
      .eq("user_id", req.userId)
      .select(PROJECT_COLS)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Project not found" },
        })
      }
      return sendInternalError(reply, req, error, "Failed to update project")
    }

    // Late origin stamping: a client app may reveal its settings marker on an
    // update (vcp's ensureProjectVcpSettings back-fills `settings.vcp` on an old
    // project that predates it). Guarded on `app_slug IS NULL` so a native or
    // already-classified project is never re-labelled; best-effort so a stamp
    // hiccup never fails a save that already succeeded.
    if (settings !== undefined) {
      const inferred = await inferAppSlugFromSettings(settings)
      if (inferred) {
        const { error: stampErr } = await supabase
          .from("projects")
          .update({ app_slug: inferred })
          .eq("id", id)
          .eq("user_id", req.userId)
          .is("app_slug", null)
        if (stampErr) {
          req.log.warn({ err: stampErr, projectId: id }, "project app_slug stamp failed")
        }
      }
    }

    return { data: toProjectResponse(data) }
  })

  // Delete project
  app.delete("/v1/projects/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = projectIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid project ID",
        },
      })
    }

    const { id } = parsed.data

    // Reject the default project up-front so the user sees a friendly 409
    // rather than a 500 from the BEFORE DELETE trigger (which is the hard
    // safety net for direct-DB or service-role bypass).
    const { data: target, error: lookupError } = await supabase
      .from("projects")
      .select("id, is_default")
      .eq("id", id)
      .eq("user_id", req.userId)
      .single()

    if (lookupError) {
      if (lookupError.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Project not found" },
        })
      }
      return sendInternalError(reply, req, lookupError, "Failed to delete project")
    }

    if (target.is_default === true) {
      return reply.status(409).send({
        error: {
          code: "default_project",
          message:
            "Cannot delete the default workspace. Rename it instead or move workflows to another project.",
        },
      })
    }

    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", id)
      .eq("user_id", req.userId)

    if (error) {
      return sendInternalError(reply, req, error, "Failed to delete project")
    }

    return { success: true }
  })

  // Ensure (lazy-create) the caller's default project. Idempotent — returns
  // the existing default if there is one. Used by the SDK / CLI / MCP; the
  // frontend calls the `ensure_default_project` RPC directly via Supabase JS
  // for a single round-trip without the backend hop.
  app.post("/v1/projects/ensure-default", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const result = await ensureDefaultProject(req.userId)
    if ("error" in result) {
      return sendInternalError(reply, req, result.error, "Failed to ensure default project")
    }

    return reply.status(result.created ? 201 : 200).send({
      data: toProjectResponse(result.project),
    })
  })
}
