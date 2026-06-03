import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"

/**
 * GET /v1/me — the canonical identity / token-introspection endpoint.
 *
 * The standard "who is this token's user" lookup, like GitHub `/user` or
 * Google `/userinfo`. Authentication-only: ANY valid bearer token resolves to
 * its owner's identity — both first-party Supabase JWTs and developer-app
 * OAuth tokens (the auth middleware sets `req.userId` for both). There is
 * deliberately NO scope gate: the token itself proves identity, the scope
 * catalog has no identity/profile scope, and inventing one would be unwanted
 * surface. Finer PII scoping can be layered later if a real need appears.
 *
 * Returns IDENTITY, not settings — `{ id, email, displayName, avatarUrl, tier }`.
 * Mutable preferences live at `/v1/user/settings`; do not duplicate them here.
 */
export async function meRoutes(app: FastifyInstance) {
  app.get("/v1/me", async (req, reply) => {
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }

    // `profiles` has no `display_name` column (see database.types.ts): the
    // human-readable name lives in `full_name`. `subscription_tier` is
    // nullable, so coalesce to "free" to keep `tier` a non-null string.
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, avatar_url, subscription_tier")
      .eq("id", userId)
      .single()

    if (error || !profile) {
      return reply.status(404).send({ error: "Profile not found" })
    }

    return reply.send({
      data: {
        id: profile.id,
        email: profile.email,
        displayName: profile.full_name ?? null,
        avatarUrl: profile.avatar_url ?? null,
        tier: profile.subscription_tier ?? "free",
      },
    })
  })
}
