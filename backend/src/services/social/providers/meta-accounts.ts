import { encryptToken } from "../encryption.js"
import type { AccountChoice, PlatformUserInfo } from "./types.js"

/**
 * Shared Meta (Facebook/Instagram) account discovery for the between-steps
 * picker. Replaces the old silent first-pick (`pages[0]` /
 * `.find(...instagram_business_account)`) with FULL lists merged from both
 * discovery paths — `/me/accounts` (direct page admins) and
 * `/me/businesses -> owned_pages` (business-managed pages, common with
 * Facebook Login for Business) — deduped by id.
 */

const GRAPH = "https://graph.facebook.com/v25.0"

interface FbPage {
  id: string
  name: string
  access_token: string
  picture?: { data?: { url: string } }
  instagram_business_account?: { id: string; username: string; profile_picture_url?: string }
}

async function graphGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${accessToken}`)
  const data = (await res.json()) as T & { error?: { message?: string } }
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(`Meta Graph error: ${data.error.message || "unknown"}`)
  }
  return data
}

const PAGE_FIELDS = "id,name,access_token,picture,instagram_business_account{id,username,profile_picture_url}"

/** All pages visible to this login, from both discovery paths, deduped. */
export async function listAllPages(accessToken: string): Promise<FbPage[]> {
  const byId = new Map<string, FbPage>()

  const direct = await graphGet<{ data?: FbPage[] }>(`me/accounts?fields=${PAGE_FIELDS}`, accessToken)
  for (const p of direct.data ?? []) byId.set(p.id, p)

  const biz = await graphGet<{ data?: Array<{ id: string }> }>("me/businesses?fields=id,name", accessToken)
  for (const b of biz.data ?? []) {
    const owned = await graphGet<{ data?: FbPage[] }>(`${b.id}/owned_pages?fields=${PAGE_FIELDS}`, accessToken)
    for (const p of owned.data ?? []) {
      if (!byId.has(p.id)) byId.set(p.id, p)
    }
  }

  return [...byId.values()]
}

/** The FB user id behind this login — stored as `root_internal_id`. */
export async function fetchRootId(accessToken: string): Promise<string | undefined> {
  try {
    const me = await graphGet<{ id?: string }>("me?fields=id", accessToken)
    return me.id
  } catch {
    return undefined
  }
}

export async function listFacebookChoices(accessToken: string): Promise<AccountChoice[]> {
  const rootId = await fetchRootId(accessToken)
  return (await listAllPages(accessToken)).map((p) => ({
    id: p.id,
    name: p.name,
    avatarUrl: p.picture?.data?.url,
    rootId,
  }))
}

export async function listInstagramChoices(accessToken: string): Promise<AccountChoice[]> {
  const rootId = await fetchRootId(accessToken)
  return (await listAllPages(accessToken))
    .filter((p) => p.instagram_business_account)
    .map((p) => ({
      id: p.instagram_business_account!.id,
      name: `@${p.instagram_business_account!.username}`,
      avatarUrl: p.instagram_business_account!.profile_picture_url,
      rootId,
    }))
}

export async function finalizeFacebookAccount(accessToken: string, accountId: string): Promise<PlatformUserInfo> {
  const page = (await listAllPages(accessToken)).find((p) => p.id === accountId)
  if (!page) throw new Error("Selected Facebook Page is no longer available.")
  return {
    id: page.id,
    username: page.name,
    avatarUrl: page.picture?.data?.url,
    metadata: {
      page_id: page.id,
      page_access_token: page.access_token ? encryptToken(page.access_token) : undefined,
    },
  }
}

export async function finalizeInstagramAccount(accessToken: string, accountId: string): Promise<PlatformUserInfo> {
  const page = (await listAllPages(accessToken)).find((p) => p.instagram_business_account?.id === accountId)
  const ig = page?.instagram_business_account
  if (!ig) throw new Error("Selected Instagram account is no longer available.")
  return {
    id: ig.id,
    username: ig.username,
    avatarUrl: ig.profile_picture_url,
    metadata: { instagram_user_id: ig.id },
  }
}

/** Error messages preserved verbatim — routes/social-auth.ts keys its fix-it hints off them. */
export const NO_IG_ACCOUNT_MSG =
  "No Instagram Business account found. Make sure your Instagram is linked to a Facebook Page."
export const NO_FB_PAGE_MSG =
  "No Facebook pages found. Make sure you have a Facebook Page in your Business Portfolio."
