import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { hasAdmin } from "../lib/config.js"
import { checkIsAdmin } from "../lib/admin-check.js"
import { rejectProgrammaticAuth } from "../lib/api-auth-mode.js"
import { sendInternalError } from "../lib/http-errors.js"
import {
  clearProviderCredential,
  listProviderCredentialStates,
  setProviderCredential,
  setProviderOverride,
} from "../lib/provider-credentials.js"
import {
  PROVIDER_KEY_ENV,
  PROVIDER_KEY_IDS,
  resolveProviderKey,
  resolveProviderKeyRaw,
  getProviderKeyOverride,
  type ProviderKeyId,
} from "../lib/provider-keys-runtime.js"

/**
 * In-app provider credentials — the paste field behind every Install-health
 * tile (self-host editions only; registered next to setup-status).
 *
 *   GET    /v1/setup/provider-keys       -> [{ id, set, source }]  never a value
 *   PUT    /v1/setup/provider-keys/:id   { value }  store encrypted, live at once
 *   DELETE /v1/setup/provider-keys/:id   clear the app-managed key
 *
 * Who may write: a FIRST-PARTY session only (never an OAuth-app or personal
 * API token — a swapped KIE key is spend on the operator's account). On
 * community any signed-in user (single operator by design; a login already
 * controls app_settings and the nodaro.ai connection); where the edition has
 * admins, admins only.
 *
 * Env wins (lib/provider-keys-runtime.ts): a key set through the environment
 * is read-only here — the response names the variable to remove instead of
 * silently storing a value that would never be used.
 */

const bodySchema = z.object({
  value: z.string().min(1).max(4096),
  /** Explicit "Replace .env key": store the app key AND skip the env layer. */
  ignoreEnv: z.boolean().optional(),
})
const WRITE_MSG = "Provider keys can only be changed from the Nodaro editor, not with an API or app token."

function isKnown(id: string): id is ProviderKeyId {
  return (PROVIDER_KEY_IDS as readonly string[]).includes(id)
}

function stateOf(id: ProviderKeyId) {
  const r = resolveProviderKeyRaw(id)
  const o = getProviderKeyOverride(id)
  return {
    id,
    set: r !== null,
    source: r?.source ?? null,
    disabled: o.disabled === true,
    ignoreEnv: o.ignoreEnv === true,
  }
}

/** Shared write gate: signed in, first-party, admin where the edition has them. */
async function authorizeWrite(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!req.userId) {
    reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return false
  }
  if (rejectProgrammaticAuth(req, reply, WRITE_MSG)) return false
  if (hasAdmin() && !(await checkIsAdmin(req.userId))) {
    reply.status(403).send({ error: { code: "forbidden", message: "Only an admin can change provider keys on this edition" } })
    return false
  }
  return true
}

export async function providerKeysRoutes(app: FastifyInstance) {
  app.get("/v1/setup/provider-keys", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    return reply.send({ providers: listProviderCredentialStates() })
  })

  app.put<{ Params: { id: string } }>(
    "/v1/setup/provider-keys/:id",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!(await authorizeWrite(req, reply))) return
      const { id } = req.params
      if (!isKnown(id)) {
        return reply.status(404).send({ error: { code: "unknown_provider", message: `Unknown provider: ${id}` } })
      }
      const parsed = bodySchema.safeParse(req.body)
      if (!parsed.success || parsed.data.value.trim().length === 0) {
        return reply.status(400).send({ error: { code: "validation_error", message: "value must be a non-empty string (max 4096 chars)" } })
      }
      const current = resolveProviderKey(id)
      // The 409 stays the DEFAULT for a plain paste over an env key.
      // `ignoreEnv: true` is the explicit "Replace .env key" action (4b):
      // store the app key AND skip the env layer, so the operator can swap
      // a .env-managed key without editing files or restarting. Deleting
      // the app key later clears the flag — the env key honestly returns.
      if (current?.source === "env" && parsed.data.ignoreEnv !== true) {
        return reply.status(409).send({
          error: {
            code: "managed_by_env",
            message: `${PROVIDER_KEY_ENV[id]} is set in this install's environment, which takes precedence — remove it from .env (and restart), or use Replace to override it from here.`,
          },
        })
      }
      try {
        await setProviderCredential(id, parsed.data.value, req.userId ?? null)
        if (parsed.data.ignoreEnv === true) await setProviderOverride(id, { ignoreEnv: true })
        req.log.info({ provider: id, userId: req.userId, ignoreEnv: parsed.data.ignoreEnv === true }, "[provider-keys] key set")
        return reply.send(stateOf(id))
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to store the provider key")
      }
    },
  )

  app.delete<{ Params: { id: string } }>(
    "/v1/setup/provider-keys/:id",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!(await authorizeWrite(req, reply))) return
      const { id } = req.params
      if (!isKnown(id)) {
        return reply.status(404).send({ error: { code: "unknown_provider", message: `Unknown provider: ${id}` } })
      }
      const current = resolveProviderKey(id)
      if (current?.source === "env") {
        return reply.status(409).send({
          error: {
            code: "managed_by_env",
            message: `${PROVIDER_KEY_ENV[id]} is set in this install's environment — remove it from .env (and restart) instead.`,
          },
        })
      }
      try {
        await clearProviderCredential(id)
        // The app key carried the env override with it — removing the key
        // must let the .env value honestly return.
        if (getProviderKeyOverride(id).ignoreEnv) await setProviderOverride(id, { ignoreEnv: false })
        req.log.info({ provider: id, userId: req.userId }, "[provider-keys] key cleared")
        return reply.send(stateOf(id))
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to clear the provider key")
      }
    },
  )

  // Disable/enable a provider WITHOUT touching its key — the only control
  // that works on env-managed keys too (they are read-only by design). A
  // disabled provider resolves as absent everywhere (registration, chains,
  // coverage) while the tile still shows the key exists ("disabled").
  app.put<{ Params: { id: string } }>(
    "/v1/setup/provider-keys/:id/disabled",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!(await authorizeWrite(req, reply))) return
      const { id } = req.params
      if (!isKnown(id)) {
        return reply.status(404).send({ error: { code: "unknown_provider", message: `Unknown provider: ${id}` } })
      }
      const parsed = z.object({ disabled: z.boolean() }).safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", message: "disabled must be a boolean" } })
      }
      try {
        await setProviderOverride(id, { disabled: parsed.data.disabled })
        req.log.info({ provider: id, userId: req.userId, disabled: parsed.data.disabled }, "[provider-keys] provider toggled")
        return reply.send(stateOf(id))
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to toggle the provider")
      }
    },
  )
}
