import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import { supabase } from "../lib/supabase.js"
import { ALL_SCOPES } from "../lib/scopes.js"
import { invalidateDynamicOriginsCache } from "../lib/dynamic-origins.js"

const httpsUrl = z.string().url().refine((v) => v.startsWith("https://") || v.startsWith("http://localhost"), {
  message: "Must be https:// or http://localhost",
})

const originString = z.string().url().refine((v) => {
  try {
    const u = new URL(v)
    return u.pathname === "/" && u.search === "" && u.hash === ""
  } catch { return false }
}, { message: "Must be a bare origin (no path)" })

const createBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  homepageUrl: httpsUrl.optional(),
  logoUrl: httpsUrl.optional(),
  redirectUris: z.array(httpsUrl).min(1).max(10),
  allowedOrigins: z.array(originString).max(5).default([]),
  scopesRequested: z.array(z.enum(ALL_SCOPES)).min(1),
})

const updateBody = createBody.partial()
const idParams = z.object({ id: z.string().uuid() })

function generateClientId(): string {
  return `app_${randomBytes(16).toString("hex")}`
}

function generateClientSecret(): string {
  return `sec_${randomBytes(32).toString("hex")}`
}

async function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10)
}

function formatApp(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    logoUrl: row.logo_url ?? null,
    homepageUrl: row.homepage_url ?? null,
    redirectUris: row.redirect_uris ?? [],
    allowedOrigins: row.allowed_origins ?? [],
    scopesRequested: row.scopes_requested ?? [],
    clientId: row.client_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const MAX_APPS_PER_USER = 5

export async function developerAppRoutes(app: FastifyInstance) {
  app.post("/v1/developer-apps", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" } })
    }

    const { count } = await supabase
      .from("developer_apps")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", req.userId)
    if ((count ?? 0) >= MAX_APPS_PER_USER) {
      return reply.status(400).send({ error: { code: "limit_reached", message: `Maximum ${MAX_APPS_PER_USER} apps per user` } })
    }

    const clientId = generateClientId()
    const clientSecret = generateClientSecret()
    const clientSecretHash = await hashSecret(clientSecret)

    const { data, error } = await supabase
      .from("developer_apps")
      .insert({
        owner_user_id: req.userId,
        name: parsed.data.name,
        description: parsed.data.description,
        homepage_url: parsed.data.homepageUrl,
        logo_url: parsed.data.logoUrl,
        redirect_uris: parsed.data.redirectUris,
        allowed_origins: parsed.data.allowedOrigins,
        scopes_requested: parsed.data.scopesRequested,
        client_id: clientId,
        client_secret_hash: clientSecretHash,
      })
      .select("*")
      .single()

    if (error || !data) {
      return reply.status(500).send({ error: { code: "internal_error", message: error?.message ?? "Insert failed" } })
    }

    invalidateDynamicOriginsCache()

    return reply.status(201).send({
      data: { ...formatApp(data), clientSecret },
    })
  })

  app.get("/v1/developer-apps", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const { data, error } = await supabase
      .from("developer_apps")
      .select("*")
      .eq("owner_user_id", req.userId)
      .order("created_at", { ascending: false })
    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }
    return { data: (data ?? []).map(formatApp) }
  })

  app.get("/v1/developer-apps/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = idParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid id" } })
    }
    const { data, error } = await supabase
      .from("developer_apps")
      .select("*")
      .eq("id", parsed.data.id)
      .eq("owner_user_id", req.userId)
      .single()
    if (error || !data) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }
    return { data: formatApp(data) }
  })

  app.patch("/v1/developer-apps/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const idParsed = idParams.safeParse(req.params)
    if (!idParsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid id" } })
    }
    const bodyParsed = updateBody.safeParse(req.body)
    if (!bodyParsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: bodyParsed.error.issues[0]?.message ?? "Invalid request" } })
    }
    const updates: Record<string, unknown> = {}
    const b = bodyParsed.data
    if (b.name !== undefined) updates.name = b.name
    if (b.description !== undefined) updates.description = b.description
    if (b.homepageUrl !== undefined) updates.homepage_url = b.homepageUrl
    if (b.logoUrl !== undefined) updates.logo_url = b.logoUrl
    if (b.redirectUris !== undefined) updates.redirect_uris = b.redirectUris
    if (b.allowedOrigins !== undefined) updates.allowed_origins = b.allowedOrigins
    if (b.scopesRequested !== undefined) updates.scopes_requested = b.scopesRequested

    const { data, error } = await supabase
      .from("developer_apps")
      .update(updates)
      .eq("id", idParsed.data.id)
      .eq("owner_user_id", req.userId)
      .select("*")
      .single()

    if (error || !data) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }

    invalidateDynamicOriginsCache()
    return { data: formatApp(data) }
  })

  app.post("/v1/developer-apps/:id/rotate-secret", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = idParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid id" } })
    }
    const newSecret = generateClientSecret()
    const newHash = await hashSecret(newSecret)
    const { error } = await supabase
      .from("developer_apps")
      .update({ client_secret_hash: newHash })
      .eq("id", parsed.data.id)
      .eq("owner_user_id", req.userId)
    if (error) {
      return reply.status(404).send({ error: { code: "not_found", message: "App not found" } })
    }
    return { clientSecret: newSecret }
  })

  app.delete("/v1/developer-apps/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = idParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid id" } })
    }
    const { error } = await supabase
      .from("developer_apps")
      .delete()
      .eq("id", parsed.data.id)
      .eq("owner_user_id", req.userId)
    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }
    invalidateDynamicOriginsCache()
    return { success: true }
  })
}

// Internal helpers used by oauth.ts (Task 6)
export async function findAppByClientId(clientId: string) {
  const { data } = await supabase
    .from("developer_apps")
    .select("id, owner_user_id, client_id, client_secret_hash, redirect_uris, allowed_origins, scopes_requested, status, name, description, logo_url, homepage_url, kind")
    .eq("client_id", clientId)
    .eq("status", "active")
    .single()
  return data
}

export async function verifyClientSecret(clientSecretHash: string, plaintext: string): Promise<boolean> {
  return bcrypt.compare(plaintext, clientSecretHash)
}
