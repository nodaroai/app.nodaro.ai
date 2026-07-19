import { randomBytes } from "node:crypto"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { rejectProgrammaticAuth } from "../lib/api-auth-mode.js"
import { supabase } from "../lib/supabase.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { encryptToken, decryptToken } from "../services/social/encryption.js"
import { generateAuthUrl, exchangeCodeForTokens, type TokenSet } from "../services/social/oauth.js"
import { getProvider, missingEnv, PROVIDERS, providerPublicInfo } from "../services/social/providers/registry.js"
import type { AccountChoice, PlatformUserInfo, SocialProvider } from "../services/social/providers/types.js"
import {
  consumeOAuthState,
  consumePendingSelection,
  savePendingSelection,
} from "../services/social/state-store.js"

// No social scope exists — block OAuth apps from managing the owner's connections
// (sever links / inject a bot credential). Personal-token SDK + JWT still allowed.
const SOCIAL_NO_OAUTH_MSG = "Social account management is not available to OAuth apps."

export async function socialAuthRoutes(app: FastifyInstance) {
  // GET /v1/social/providers — registry metadata + per-deployment availability.
  // The frontend grid, SDK, and MCP derive the network list from this; nothing
  // is hidden — unconfigured providers come back with available:false and the
  // missing env var NAMES (never values) plus a docs hint.
  app.get("/v1/social/providers", async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized" } })
    return { providers: Object.values(PROVIDERS).map(providerPublicInfo) }
  })

  // GET /v1/social/auth-url?platform=instagram
  app.get("/v1/social/auth-url", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })

    const { platform } = req.query as { platform?: string }
    const provider = platform ? getProvider(platform) : null
    if (!provider) {
      return reply.status(400).send({ error: { code: "invalid_platform", message: "Invalid platform" } })
    }

    // Connect-time availability gate (§2.5) — never rely on frontend filtering.
    const missing = missingEnv(provider)
    if (missing.length > 0) {
      return reply.status(400).send({
        error: {
          code: "provider_not_configured",
          message: `${provider.label} is not configured on this deployment. Missing env: ${missing.join(", ")}.`,
          missingEnv: missing,
          ...(provider.setupHint ? { setupHint: provider.setupHint } : {}),
        },
      })
    }

    if (provider.connectKind === "bot_token") {
      return reply.status(400).send({
        error: { code: "invalid_platform", message: `${provider.label} connects via POST /v1/social/${provider.id}/connect, not OAuth.` },
      })
    }
    if (provider.connectKind === "custom_fields") {
      return reply.status(400).send({
        error: { code: "invalid_platform", message: `${provider.label} connects via POST /v1/social/connect/custom, not OAuth.` },
      })
    }
    if (provider.connectKind !== "oauth2" && provider.connectKind !== "oauth2_between_steps") {
      return reply.status(400).send({
        error: { code: "invalid_platform", message: `${provider.label} does not use the OAuth popup flow.` },
      })
    }

    const url = await generateAuthUrl(provider, userId)
    return { url }
  })

  // GET /v1/social/callback/:platform — public route (redirected from OAuth provider)
  app.get("/v1/social/callback/:platform", async (req, reply) => {
    const { platform } = req.params as { platform: string }
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string }

    if (error || !code || !state) {
      return reply.type("text/html").send(errorHtml("Authorization was denied or failed."))
    }

    const stateData = await consumeOAuthState(state)
    if (!stateData) {
      return reply.type("text/html").send(errorHtml("Invalid or expired state. Please try again."))
    }
    if (stateData.providerId !== platform) {
      return reply.type("text/html").send(errorHtml("Platform mismatch."))
    }
    const provider = getProvider(platform)
    if (!provider) {
      return reply.type("text/html").send(errorHtml("Unknown platform."))
    }

    try {
      const tokens = await exchangeCodeForTokens(provider, code, stateData.codeVerifier)

      if (provider.connectKind === "oauth2_between_steps") {
        return await handleBetweenSteps(app, reply, provider, stateData.userId, tokens)
      }

      if (!provider.fetchUserInfo) {
        throw new Error(`Provider ${provider.id} is missing fetchUserInfo`)
      }
      const userInfo = await provider.fetchUserInfo(tokens.accessToken)
      const saveErr = await saveConnection(stateData.userId, provider.id, userInfo, tokens)
      if (saveErr) {
        app.log.error({ saveErr }, "Failed to save social connection")
        return reply.type("text/html").send(errorHtml("Failed to save connection."))
      }
      return reply.type("text/html").send(successHtml(provider.id, userInfo.username || "Connected"))
    } catch (err) {
      app.log.error({ err }, "OAuth callback error")
      const errMsg = err instanceof Error ? err.message : "Failed to complete authorization."
      return reply.type("text/html").send(errorHtml(errMsg, getErrorHint(platform, errMsg)))
    }
  })

  // POST /v1/social/connect/finalize — completes a between-steps account pick.
  // Public route: the popup runs unauthenticated on the backend origin, so the
  // one-time pending token (random 32 bytes, 10-min TTL, Redis) IS the auth —
  // same pattern as webhook tokens / upload-proxy. Tokens never reach the
  // browser; they stay encrypted in Redis until this call.
  app.post("/v1/social/connect/finalize", async (req, reply) => {
    const schema = z.object({ token: z.string().min(16), accountId: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid finalize request" } })
    }

    const pending = await consumePendingSelection(parsed.data.token)
    if (!pending) {
      return reply.status(400).send({
        error: { code: "expired", message: "Selection expired. Please connect again." },
      })
    }

    const provider = getProvider(pending.providerId)
    const chosen = pending.accounts.find((a) => a.id === parsed.data.accountId)
    if (!provider?.finalizeAccount || !chosen) {
      return reply.status(400).send({
        error: { code: "invalid_account", message: "Selected account is not part of this connection." },
      })
    }

    try {
      const accessToken = decryptToken(pending.accessTokenEncrypted)
      const userInfo = await provider.finalizeAccount(accessToken, chosen.id)
      const tokens: TokenSet = {
        accessToken,
        refreshToken: pending.refreshTokenEncrypted ? decryptToken(pending.refreshTokenEncrypted) : undefined,
        expiresIn: pending.expiresIn,
        scopes: pending.scopes,
      }
      const saveErr = await saveConnection(pending.userId, provider.id, userInfo, tokens, chosen.rootId)
      if (saveErr) {
        req.log.error({ saveErr }, "Failed to save social connection (finalize)")
        return reply.status(500).send({ error: { code: "internal_error", message: "Failed to save connection." } })
      }
      return { success: true, platform: provider.id, username: userInfo.username || "Connected" }
    } catch (err) {
      req.log.error({ err }, "Social finalize error")
      const message = err instanceof Error ? err.message : "Failed to complete connection."
      return reply.status(500).send({ error: { code: "finalize_failed", message } })
    }
  })

  // POST /v1/social/connect/custom — custom_fields networks (API key / app
  // password / instance login). The provider's FieldSpec list drives both the
  // frontend form AND this validation, so the two cannot drift.
  app.post("/v1/social/connect/custom", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })
    if (rejectProgrammaticAuth(req, reply, SOCIAL_NO_OAUTH_MSG, { allowPersonalToken: true })) return

    const schema = z.object({ platform: z.string().min(1), fields: z.record(z.string(), z.string()) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid connect request" } })
    }

    const provider = getProvider(parsed.data.platform)
    if (!provider || provider.connectKind !== "custom_fields" || !provider.connectWithFields || !provider.customFields) {
      return reply.status(400).send({ error: { code: "invalid_platform", message: "Invalid platform" } })
    }

    // Validate against the provider's own FieldSpec list.
    const normalized: Record<string, string> = {}
    for (const spec of provider.customFields()) {
      const value = (parsed.data.fields[spec.key] ?? spec.defaultValue ?? "").trim()
      if (!value) {
        return reply.status(400).send({
          error: { code: "validation_error", message: `${spec.label} is required` },
        })
      }
      if (spec.validation && !new RegExp(spec.validation).test(value)) {
        return reply.status(400).send({
          error: { code: "validation_error", message: `${spec.label} is invalid` },
        })
      }
      // SSRF gate on user-supplied instance hosts (bluesky service, wordpress
      // domain, lemmy instance): same safeUrlSchema as user media URLs.
      if (spec.validation?.startsWith("^https?") && !safeUrlSchema.safeParse(value).success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: `${spec.label} must be a public https URL` },
        })
      }
      normalized[spec.key] = value
    }

    try {
      const { userInfo, accessToken } = await provider.connectWithFields(normalized)
      const saveErr = await saveConnection(userId, provider.id, userInfo, { accessToken })
      if (saveErr) {
        req.log.error({ saveErr }, "Failed to save social connection (custom fields)")
        return reply.status(500).send({ error: { code: "internal_error" } })
      }
      return { success: true, platform: provider.id, username: userInfo.username ?? provider.label }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect."
      return reply.status(400).send({ error: { code: "connect_failed", message } })
    }
  })

  // GET /v1/social/connections — list user's connections
  app.get("/v1/social/connections", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })

    const { data, error } = await supabase
      .from("social_connections")
      // reconnect_needed is what surfaces the "Reconnect" chip — providers whose
      // tokens can't self-heal (capabilities.refresh === "reconnect") get marked
      // by executePublish(). Dropping it from this list silently blinds the UI.
      .select("id, platform, platform_user_id, platform_username, platform_avatar_url, display_name, created_at, updated_at, token_expires_at, scopes, reconnect_needed")
      .eq("user_id", userId)

    if (error) return reply.status(500).send({ error: { code: "internal_error" } })
    return { connections: data || [] }
  })

  // DELETE /v1/social/connections/:id — disconnect a specific connection
  app.delete("/v1/social/connections/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })
    // No social scope exists — block OAuth apps from severing the owner's social links.
    if (rejectProgrammaticAuth(req, reply, SOCIAL_NO_OAUTH_MSG, { allowPersonalToken: true })) return

    const { id } = req.params as { id: string }

    const { error } = await supabase
      .from("social_connections")
      .delete()
      .eq("user_id", userId)
      .eq("id", id)

    if (error) return reply.status(500).send({ error: { code: "internal_error" } })
    return { success: true }
  })

  // POST /v1/social/telegram/connect — Direct bot token connection (no OAuth)
  app.post("/v1/social/telegram/connect", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })
    // No social scope exists — block OAuth apps from injecting a bot credential.
    if (rejectProgrammaticAuth(req, reply, SOCIAL_NO_OAUTH_MSG, { allowPersonalToken: true })) return

    const schema = z.object({ botToken: z.string().min(10) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid bot token" } })
    }

    const { botToken } = parsed.data

    // Validate token via Telegram getMe API
    let botInfo: { id: number; first_name: string; username?: string }
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
      const data = await res.json() as { ok: boolean; result?: { id: number; first_name: string; username?: string }; description?: string }
      if (!data.ok || !data.result) {
        return reply.status(400).send({ error: { code: "invalid_token", message: data.description || "Invalid bot token" } })
      }
      botInfo = data.result
    } catch {
      return reply.status(500).send({ error: { code: "telegram_error", message: "Failed to validate bot token" } })
    }

    // Encrypt and store
    const accessTokenEncrypted = encryptToken(botToken)

    const { error: upsertErr } = await supabase
      .from("social_connections")
      .upsert({
        user_id: userId,
        platform: "telegram",
        platform_user_id: String(botInfo.id),
        platform_username: botInfo.username || botInfo.first_name,
        display_name: botInfo.first_name,
        access_token_encrypted: accessTokenEncrypted,
        refresh_token_encrypted: null,
        token_expires_at: null,
        scopes: [],
        metadata: {},
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,platform,platform_user_id" })

    if (upsertErr) {
      app.log.error({ upsertErr }, "Failed to save Telegram connection")
      return reply.status(500).send({ error: { code: "internal_error" } })
    }

    return { success: true, botName: botInfo.first_name, botUsername: botInfo.username }
  })
}

/**
 * Between-steps continuation: 0 accounts -> the provider-specific fix-it
 * error; exactly 1 -> finalize immediately (same UX as before); more than 1 ->
 * park the encrypted tokens + account list in Redis and render the picker in
 * this backend-served popup. No more silent first-account pick.
 */
async function handleBetweenSteps(
  app: FastifyInstance,
  reply: import("fastify").FastifyReply,
  provider: SocialProvider,
  userId: string,
  tokens: TokenSet,
) {
  if (!provider.listAccounts || !provider.finalizeAccount) {
    throw new Error(`Provider ${provider.id} is missing between-steps handlers`)
  }

  const accounts = await provider.listAccounts(tokens.accessToken)

  if (accounts.length === 0) {
    const msg = provider.noAccountsMessage ?? `No connectable ${provider.label} accounts found.`
    return reply.type("text/html").send(errorHtml(msg, getErrorHint(provider.id, msg)))
  }

  if (accounts.length === 1) {
    const userInfo = await provider.finalizeAccount(tokens.accessToken, accounts[0]!.id)
    const saveErr = await saveConnection(userId, provider.id, userInfo, tokens, accounts[0]!.rootId)
    if (saveErr) {
      app.log.error({ saveErr }, "Failed to save social connection")
      return reply.type("text/html").send(errorHtml("Failed to save connection."))
    }
    return reply.type("text/html").send(successHtml(provider.id, userInfo.username || "Connected"))
  }

  const token = randomBytes(32).toString("base64url")
  await savePendingSelection(token, {
    providerId: provider.id,
    userId,
    accessTokenEncrypted: encryptToken(tokens.accessToken),
    refreshTokenEncrypted: tokens.refreshToken ? encryptToken(tokens.refreshToken) : undefined,
    expiresIn: tokens.expiresIn,
    scopes: tokens.scopes,
    accounts,
  })
  return reply.type("text/html").send(pickerHtml(provider, token, accounts))
}

async function saveConnection(
  userId: string,
  platform: string,
  userInfo: PlatformUserInfo,
  tokens: TokenSet,
  rootInternalId?: string,
): Promise<unknown> {
  const { error } = await supabase
    .from("social_connections")
    .upsert({
      user_id: userId,
      platform,
      platform_user_id: userInfo.id,
      platform_username: userInfo.username,
      platform_avatar_url: userInfo.avatarUrl,
      display_name: userInfo.username || platform,
      access_token_encrypted: encryptToken(tokens.accessToken),
      refresh_token_encrypted: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
      token_expires_at: tokens.expiresIn
        ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
        : null,
      scopes: tokens.scopes || [],
      metadata: userInfo.metadata || {},
      in_between_steps: false,
      reconnect_needed: false,
      root_internal_id: rootInternalId ?? null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id,platform,platform_user_id",
    })
  return error
}

function getErrorHint(platform: string, errorMessage: string): string | undefined {
  if (platform === "instagram" && errorMessage.includes("No Instagram Business account")) {
    return `<h3>How to fix this</h3>
<p>Instagram requires a <strong>Professional account</strong> (Business or Creator) to connect. It's free and takes 30 seconds:</p>
<ol>
  <li>Open the Instagram app or go to <a href="https://www.instagram.com/accounts/edit/" target="_blank" rel="noopener">Instagram Settings</a></li>
  <li>Go to <strong>Settings &rarr; Account type and tools</strong></li>
  <li>Tap <strong>Switch to Professional account</strong></li>
  <li>Choose <strong>Creator</strong> (recommended)</li>
  <li>Link it to any Facebook Page (<a href="https://www.facebook.com/pages/create" target="_blank" rel="noopener">create one here</a> if you don't have one)</li>
  <li>Come back here and try connecting again</li>
</ol>`
  }
  if (platform === "facebook" && errorMessage.includes("No Facebook pages found")) {
    return `<h3>How to fix this</h3>
<p>Facebook publishing requires a <strong>Facebook Page</strong>. To create one:</p>
<ol>
  <li>Go to <a href="https://www.facebook.com/pages/create" target="_blank" rel="noopener">facebook.com/pages/create</a></li>
  <li>Choose a name and category for your Page</li>
  <li>Complete the setup</li>
  <li>Come back here and try connecting again</li>
</ol>`
  }
  return undefined
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const PAGE_STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
  h2 { margin-bottom: 4px; }
  .sub { color: #6b7280; margin-top: 0; }
  .account { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 16px; margin: 8px 0; border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; cursor: pointer; font-size: 15px; text-align: left; }
  .account:hover { border-color: #6366f1; background: #f5f3ff; }
  .account img { width: 32px; height: 32px; border-radius: 50%; }
  .account[disabled] { opacity: .5; cursor: wait; }
  .err { color: #dc2626; }
`

function pickerHtml(provider: SocialProvider, token: string, accounts: AccountChoice[]): string {
  const items = accounts
    .map((a) => {
      const img = a.avatarUrl ? `<img src="${escapeHtml(a.avatarUrl)}" alt="">` : ""
      return `<button class="account" data-id="${escapeHtml(a.id)}">${img}<span>${escapeHtml(a.name)}</span></button>`
    })
    .join("\n")
  return `<!DOCTYPE html><html><head><style>${PAGE_STYLE}</style></head><body>
<h2>Choose an account</h2>
<p class="sub">This login has ${accounts.length} ${escapeHtml(provider.label)} accounts. Pick the one to connect:</p>
${items}
<p class="err" id="err" hidden></p>
<script>
  const token = ${JSON.stringify(token)};
  document.querySelectorAll(".account").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".account").forEach((b) => b.setAttribute("disabled", ""));
      try {
        const res = await fetch("/v1/social/connect/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, accountId: btn.dataset.id }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error((data.error && data.error.message) || "Failed to connect.");
        document.body.innerHTML = "<h2>Connected!</h2><p>Account: " + (data.username || "") + "</p><p>You can close this window.</p>";
        if (window.opener) {
          window.opener.postMessage({ type: "social-auth-success", platform: data.platform }, window.location.origin);
        }
        setTimeout(() => window.close(), 2000);
      } catch (e) {
        const err = document.getElementById("err");
        err.textContent = e.message;
        err.hidden = false;
        document.querySelectorAll(".account").forEach((b) => b.removeAttribute("disabled"));
      }
    });
  });
</script>
</body></html>`
}

function successHtml(platform: string, username: string): string {
  const safePlatform = escapeHtml(platform)
  const safeUsername = escapeHtml(username)
  return `<!DOCTYPE html><html><body>
<h2>Connected to ${safePlatform}!</h2>
<p>Account: ${safeUsername}</p>
<p>You can close this window.</p>
<script>
  // Target window.location.origin (not "*") so a parent that navigates away
  // mid-flow can't receive this message on a foreign origin.
  if (window.opener) {
    window.opener.postMessage({ type: "social-auth-success", platform: ${JSON.stringify(platform)} }, window.location.origin);
  }
  setTimeout(() => window.close(), 2000);
</script>
</body></html>`
}

function errorHtml(message: string, hint?: string): string {
  const safeMessage = escapeHtml(message)
  const safeHint = hint || ""
  return `<!DOCTYPE html><html><head>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
  h2 { color: #dc2626; }
  .hint { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin-top: 16px; }
  .hint h3 { margin: 0 0 8px; font-size: 14px; color: #0369a1; }
  .hint ol { margin: 8px 0 0; padding-left: 20px; font-size: 14px; line-height: 1.6; }
  .hint a { color: #0369a1; text-decoration: underline; }
</style>
</head><body>
<h2>Connection Failed</h2>
<p>${safeMessage}</p>
${safeHint ? `<div class="hint">${safeHint}</div>` : "<p>You can close this window and try again.</p>"}
<script>
  // Target window.location.origin (not "*") so error details aren't leaked
  // to a foreign origin if the opener navigated away mid-flow.
  if (window.opener) {
    window.opener.postMessage({ type: "social-auth-error", message: ${JSON.stringify(message)} }, window.location.origin);
  }
</script>
</body></html>`
}
