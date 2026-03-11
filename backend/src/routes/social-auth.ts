import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { generateAuthUrl, validateState, exchangeCodeForTokens, type SocialPlatform } from "../services/social/oauth.js"
import { encryptToken, decryptToken } from "../services/social/encryption.js"

const PLATFORMS = ["instagram", "tiktok", "youtube", "linkedin", "x", "facebook"] as const

export async function socialAuthRoutes(app: FastifyInstance) {
  // GET /v1/social/auth-url?platform=instagram
  app.get("/v1/social/auth-url", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })

    const { platform } = req.query as { platform?: string }
    if (!platform || !PLATFORMS.includes(platform as SocialPlatform)) {
      return reply.status(400).send({ error: { code: "invalid_platform", message: "Invalid platform" } })
    }

    const url = generateAuthUrl(platform as SocialPlatform, userId)
    return { url }
  })

  // GET /v1/social/callback/:platform — public route (redirected from OAuth provider)
  app.get("/v1/social/callback/:platform", async (req, reply) => {
    const { platform } = req.params as { platform: string }
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string }

    if (error || !code || !state) {
      return reply.type("text/html").send(errorHtml("Authorization was denied or failed."))
    }

    const stateData = validateState(state)
    if (!stateData) {
      return reply.type("text/html").send(errorHtml("Invalid or expired state. Please try again."))
    }

    if (stateData.platform !== platform) {
      return reply.type("text/html").send(errorHtml("Platform mismatch."))
    }

    try {
      const tokens = await exchangeCodeForTokens(platform as SocialPlatform, code, stateData.codeVerifier)

      // Fetch user info from platform
      const userInfo = await fetchPlatformUserInfo(platform as SocialPlatform, tokens.accessToken)

      // Encrypt tokens
      const accessTokenEncrypted = encryptToken(tokens.accessToken)
      const refreshTokenEncrypted = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null
      const tokenExpiresAt = tokens.expiresIn
        ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
        : null

      // Upsert connection (same platform account updates tokens, different account creates new row)
      const { error: dbError } = await supabase
        .from("social_connections")
        .upsert({
          user_id: stateData.userId,
          platform,
          platform_user_id: userInfo.id,
          platform_username: userInfo.username,
          platform_avatar_url: userInfo.avatarUrl,
          display_name: userInfo.username || platform,
          access_token_encrypted: accessTokenEncrypted,
          refresh_token_encrypted: refreshTokenEncrypted,
          token_expires_at: tokenExpiresAt,
          scopes: tokens.scopes || [],
          metadata: userInfo.metadata || {},
          updated_at: new Date().toISOString(),
        }, {
          onConflict: "user_id,platform,platform_user_id",
        })

      if (dbError) {
        app.log.error({ dbError }, "Failed to save social connection")
        return reply.type("text/html").send(errorHtml("Failed to save connection."))
      }

      return reply.type("text/html").send(successHtml(platform, userInfo.username || "Connected"))
    } catch (err) {
      app.log.error({ err }, "OAuth callback error")
      const errMsg = err instanceof Error ? err.message : "Failed to complete authorization."
      return reply.type("text/html").send(errorHtml(errMsg, getErrorHint(platform, errMsg)))
    }
  })

  // GET /v1/social/connections — list user's connections
  app.get("/v1/social/connections", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })

    const { data, error } = await supabase
      .from("social_connections")
      .select("id, platform, platform_user_id, platform_username, platform_avatar_url, display_name, created_at, updated_at, token_expires_at, scopes")
      .eq("user_id", userId)

    if (error) return reply.status(500).send({ error: { code: "internal_error" } })
    return { connections: data || [] }
  })

  // DELETE /v1/social/connections/:id — disconnect a specific connection
  app.delete("/v1/social/connections/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })

    const { id } = req.params as { id: string }

    const { error } = await supabase
      .from("social_connections")
      .delete()
      .eq("user_id", userId)
      .eq("id", id)

    if (error) return reply.status(500).send({ error: { code: "internal_error" } })
    return { success: true }
  })
}

async function fetchPlatformUserInfo(
  platform: SocialPlatform,
  accessToken: string,
): Promise<{ id: string; username?: string; avatarUrl?: string; metadata?: Record<string, unknown> }> {
  switch (platform) {
    case "instagram": {
      // Try /me/accounts first (works for direct page admins)
      const pagesRes = await fetch(
        `https://graph.facebook.com/v25.0/me/accounts?fields=instagram_business_account{id,username,profile_picture_url}&access_token=${accessToken}`,
      )
      const pagesData = await pagesRes.json() as Record<string, unknown>
      const pages = pagesData.data as Array<{ instagram_business_account?: { id: string; username: string; profile_picture_url: string } }> | undefined
      let igAccount = pages?.[0]?.instagram_business_account

      // Fallback: for business-managed pages, discover via /me/businesses
      if (!igAccount) {
        igAccount = await findIgAccountViaBusiness(accessToken)
      }

      if (!igAccount) throw new Error("No Instagram Business account found. Make sure your Instagram is linked to a Facebook Page.")
      return {
        id: igAccount.id,
        username: igAccount.username,
        avatarUrl: igAccount.profile_picture_url,
        metadata: { instagram_user_id: igAccount.id },
      }
    }
    case "facebook": {
      // Try /me/accounts first (works for direct page admins)
      const pagesRes = await fetch(
        `https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token,picture&access_token=${accessToken}`,
      )
      const pagesData = await pagesRes.json() as Record<string, unknown>
      const pages = pagesData.data as Array<{ id: string; name: string; access_token: string; picture?: { data?: { url: string } } }> | undefined
      let page = pages?.[0]

      // Fallback: for business-managed pages, discover via /me/businesses
      if (!page) {
        page = await findPageViaBusiness(accessToken)
      }

      if (!page) throw new Error("No Facebook pages found. Make sure you have a Facebook Page in your Business Portfolio.")
      return {
        id: page.id,
        username: page.name,
        avatarUrl: page.picture?.data?.url,
        metadata: { page_id: page.id, page_access_token: page.access_token ? encryptToken(page.access_token) : undefined },
      }
    }
    case "youtube": {
      const res = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      const data = await res.json() as { items: Array<{ id: string; snippet: { title: string; thumbnails: { default: { url: string } } } }> }
      const channel = data.items?.[0]
      if (!channel) throw new Error("No YouTube channel found.")
      return {
        id: channel.id,
        username: channel.snippet.title,
        avatarUrl: channel.snippet.thumbnails.default.url,
        metadata: { channel_id: channel.id },
      }
    }
    case "linkedin": {
      const res = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = await res.json() as { sub: string; name?: string; picture?: string }
      return {
        id: data.sub,
        username: data.name,
        avatarUrl: data.picture,
        metadata: { person_urn: `urn:li:person:${data.sub}` },
      }
    }
    case "x": {
      const res = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = await res.json() as { data: { id: string; username: string; profile_image_url?: string } }
      return {
        id: data.data.id,
        username: `@${data.data.username}`,
        avatarUrl: data.data.profile_image_url,
      }
    }
    case "tiktok": {
      const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = await res.json() as { data: { user: { open_id: string; display_name: string; avatar_url: string } } }
      return {
        id: data.data.user.open_id,
        username: data.data.user.display_name,
        avatarUrl: data.data.user.avatar_url,
      }
    }
  }
}

// Fallback: discover pages via /me/businesses for business-managed pages
// where /me/accounts returns empty (common with Facebook Login for Business)
async function findPageViaBusiness(accessToken: string): Promise<{ id: string; name: string; access_token: string; picture?: { data?: { url: string } } } | undefined> {
  const bizRes = await fetch(`https://graph.facebook.com/v25.0/me/businesses?fields=id,name&access_token=${accessToken}`)
  const bizData = await bizRes.json() as { data?: Array<{ id: string; name: string }> }
  if (!bizData.data?.length) return undefined

  for (const biz of bizData.data) {
    const pagesRes = await fetch(
      `https://graph.facebook.com/v25.0/${biz.id}/owned_pages?fields=id,name,access_token,picture&access_token=${accessToken}`,
    )
    const pagesData = await pagesRes.json() as { data?: Array<{ id: string; name: string; access_token: string; picture?: { data?: { url: string } } }> }
    if (pagesData.data?.[0]) return pagesData.data[0]
  }
  return undefined
}

async function findIgAccountViaBusiness(accessToken: string): Promise<{ id: string; username: string; profile_picture_url: string } | undefined> {
  const bizRes = await fetch(`https://graph.facebook.com/v25.0/me/businesses?fields=id,name&access_token=${accessToken}`)
  const bizData = await bizRes.json() as { data?: Array<{ id: string; name: string }> }
  if (!bizData.data?.length) return undefined

  for (const biz of bizData.data) {
    const pagesRes = await fetch(
      `https://graph.facebook.com/v25.0/${biz.id}/owned_pages?fields=instagram_business_account{id,username,profile_picture_url}&access_token=${accessToken}`,
    )
    const pagesData = await pagesRes.json() as { data?: Array<{ instagram_business_account?: { id: string; username: string; profile_picture_url: string } }> }
    const igAccount = pagesData.data?.find(p => p.instagram_business_account)?.instagram_business_account
    if (igAccount) return igAccount
  }
  return undefined
}

function getErrorHint(platform: string, errorMessage: string): string | undefined {
  if (platform === "instagram" && errorMessage.includes("No Instagram Business account")) {
    return `<h3>How to fix this</h3>
<p>Instagram requires a <strong>Professional account</strong> (Business or Creator) to connect. It's free and takes 30 seconds:</p>
<ol>
  <li>Open the Instagram app</li>
  <li>Go to <strong>Settings → Account type and tools</strong></li>
  <li>Tap <strong>Switch to Professional account</strong></li>
  <li>Choose <strong>Creator</strong> (recommended)</li>
  <li>Link it to any Facebook Page (you can create a basic one)</li>
  <li>Come back here and try connecting again</li>
</ol>`
  }
  if (platform === "facebook" && errorMessage.includes("No Facebook pages found")) {
    return `<h3>How to fix this</h3>
<p>Facebook publishing requires a <strong>Facebook Page</strong>. To create one:</p>
<ol>
  <li>Go to <a href="https://www.facebook.com/pages/create" target="_blank">facebook.com/pages/create</a></li>
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

function successHtml(platform: string, username: string): string {
  const safePlatform = escapeHtml(platform)
  const safeUsername = escapeHtml(username)
  return `<!DOCTYPE html><html><body>
<h2>Connected to ${safePlatform}!</h2>
<p>Account: ${safeUsername}</p>
<p>You can close this window.</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "social-auth-success", platform: ${JSON.stringify(platform)} }, "*");
  }
  setTimeout(() => window.close(), 2000);
</script>
</body></html>`
}

function errorHtml(message: string, hint?: string): string {
  const safeMessage = escapeHtml(message)
  const safeHint = hint ? escapeHtml(hint) : ""
  return `<!DOCTYPE html><html><head>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
  h2 { color: #dc2626; }
  .hint { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin-top: 16px; }
  .hint h3 { margin: 0 0 8px; font-size: 14px; color: #0369a1; }
  .hint ol { margin: 8px 0 0; padding-left: 20px; font-size: 14px; line-height: 1.6; }
</style>
</head><body>
<h2>Connection Failed</h2>
<p>${safeMessage}</p>
${safeHint ? `<div class="hint">${safeHint}</div>` : "<p>You can close this window and try again.</p>"}
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "social-auth-error", message: ${JSON.stringify(message)} }, "*");
  }
</script>
</body></html>`
}
