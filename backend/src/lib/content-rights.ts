/**
 * Content rights: the declaration a person confirms before a link is imported,
 * the record of that confirmation, and the check a download makes against it
 * (migration 577). One funnel for every lane that fetches someone else's link:
 * the `/v1/download-video` route and a run's own download both CHECK a
 * confirmation before anything else can refuse them, and CONSUME it only once
 * the download is about to start (after its slot is taken), so a consumed
 * confirmation always has a download behind it.
 *
 * Enforcement follows the app setting `content_rights_required`. Off (the
 * default): a confirmation sent along is checked and consumed, one not sent
 * refuses nothing — the server ACCEPTS before it REQUIRES, so every client can
 * add its checkbox at its own pace. On: a download without a valid
 * confirmation is refused with `rights_confirmation_required`. A run's own
 * download (`video-link-fetch-deps.ts`) sends none yet, so the setting must
 * stay off until runs carry one (a later change).
 *
 * A confirmation is good for one download of the same link (normalized), by
 * the same account, under the current declaration, within an hour. Consuming
 * it is an INSERT into `rights_events` under a partial unique index, so two
 * downloads racing on one confirmation cannot both pass.
 */
import { createHash } from "node:crypto"
import { detectVideoLinkPlatform } from "@nodaro/shared/video"
import { supabase } from "./supabase.js"
import { getAppSettings } from "./app-settings.js"

/** How long a confirmation may wait for its download. */
export const CONFIRMATION_TTL_MS = 60 * 60 * 1000

export type RightsLane = "editor" | "app" | "api" | "mcp" | "admin" | "run" | "route"

export type ContentRightsErrorCode =
  | "rights_confirmation_required"
  | "rights_confirmation_not_found"
  | "rights_confirmation_mismatch"
  | "rights_confirmation_stale"
  | "rights_confirmation_expired"
  | "rights_confirmation_used"

export class ContentRightsError extends Error {
  constructor(readonly code: ContentRightsErrorCode, message: string) {
    super(message)
    this.name = "ContentRightsError"
  }
}

export interface RightsDeclaration {
  version: number
  text: string
  hash: string
}

export interface ConfirmationRecord {
  id: string
  userId: string | null
  runnerUserId: string | null
  declarationVersion: number
  normalizedUrl: string
  createdAt: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ── normalization ────────────────────────────────────────────────────────────

/** Decoration the social sites add to a shared link; never part of which video it is. */
const SOCIAL_TRACKING_PARAMS = new Set(["si", "feature", "fbclid", "igsh", "igshid", "ref", "ref_src", "s", "t", "_r"])

/** `host` is `domain` or one of its subdomains — never `notdomain`. */
function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * The link as a download is matched against it: lowercase host (with its
 * port), no fragment, no trailing slash, the query sorted. On a known social
 * site the `www.` / `m.` prefix and the share-tracking parameters go too, so
 * the same video pasted twice with different decoration matches; a direct
 * file link keeps every parameter (often a signature or an expiry).
 */
export function normalizeSourceUrl(raw: string): string {
  const url = new URL(raw.trim())
  const social = detectVideoLinkPlatform(raw) !== "unknown"
  const host = social ? url.host.toLowerCase().replace(/^(www|m)\./, "") : url.host.toLowerCase()
  const params = [...url.searchParams.entries()].filter(([k]) => !social || (!k.toLowerCase().startsWith("utm_") && !SOCIAL_TRACKING_PARAMS.has(k.toLowerCase())))
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : ""
  const path = url.pathname.replace(/\/+$/, "") || "/"
  return `${url.protocol}//${host}${path}${query}`
}

/** The platform and the video's own id, where the link's shape says them. */
export function identifySource(raw: string): { platform: string | null; videoId: string | null } {
  const platform = detectVideoLinkPlatform(raw)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { platform: platform === "unknown" ? null : platform, videoId: null }
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "")
  let videoId: string | null = null
  if (host === "youtu.be") videoId = url.pathname.split("/")[1] || null
  else if (hostIs(host, "youtube.com")) videoId = url.searchParams.get("v") ?? /\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,})/.exec(url.pathname)?.[1] ?? null
  else if (hostIs(host, "tiktok.com")) videoId = /\/video\/(\d+)/.exec(url.pathname)?.[1] ?? null
  else if (hostIs(host, "instagram.com")) videoId = /\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/.exec(url.pathname)?.[1] ?? null
  return { platform: platform === "unknown" ? null : platform, videoId }
}

// ── the declaration ──────────────────────────────────────────────────────────

let cachedDeclaration: { value: RightsDeclaration; at: number } | null = null
/** Short on purpose: after a new version every replica must agree within seconds, or a confirm and its download disagree on "stale". */
const DECLARATION_CACHE_MS = 5_000

/** The current declaration (the highest version), cached a few seconds. */
export async function currentDeclaration(): Promise<RightsDeclaration> {
  if (cachedDeclaration && Date.now() - cachedDeclaration.at < DECLARATION_CACHE_MS) return cachedDeclaration.value
  const { data, error } = await supabase
    .from("rights_declarations")
    .select("version, text, text_hash")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`[content-rights] declaration read failed: ${error.message}`)
  if (!data) throw new Error("[content-rights] no declaration is seeded")
  const row = data as { version: number; text: string; text_hash: string }
  const value = { version: row.version, text: row.text, hash: row.text_hash }
  cachedDeclaration = { value, at: Date.now() }
  return value
}

/** Tests and an admin's new declaration version drop the cache. */
export function forgetDeclarationCache(): void {
  cachedDeclaration = null
}

/** Whether a download without a confirmation is refused (app setting, off by default). */
export async function contentRightsRequired(): Promise<boolean> {
  return (await getAppSettings()).content_rights_required
}

// ── confirmations ────────────────────────────────────────────────────────────

export interface CreateConfirmationInput {
  userId: string
  url: string
  declarationVersion: number
  lane: RightsLane
  kind?: "checkbox" | "standing" | "derived"
  runnerUserId?: string | null
  appId?: string | null
  authorizationId?: string | null
  /** The caller's address as `lib/client-address.ts` resolved it; stored on the record. */
  clientAddress?: string | null
  userAgent?: string | null
  email?: string | null
  requestId?: string | null
}

/**
 * Records a confirmation of the CURRENT declaration and answers its id. A
 * stale version (the text changed under the client) is refused: the person
 * must see the new text.
 */
export async function createConfirmation(input: CreateConfirmationInput): Promise<{ id: string; declarationVersion: number; expiresAt: string }> {
  const declaration = await currentDeclaration()
  if (input.declarationVersion !== declaration.version) {
    throw new ContentRightsError("rights_confirmation_stale", "The declaration changed; read the current text and confirm again.")
  }
  const source = identifySource(input.url)
  const email = input.email ?? (await accountEmail(input.userId))
  const { data, error } = await supabase
    .from("content_rights_confirmations")
    .insert({
      user_id: input.userId,
      runner_user_id: input.runnerUserId ?? null,
      app_id: input.appId ?? null,
      authorization_id: input.authorizationId ?? null,
      kind: input.kind ?? "checkbox",
      declaration_version: declaration.version,
      declaration_hash: declaration.hash,
      source_url: input.url,
      normalized_url: normalizeSourceUrl(input.url),
      platform: source.platform,
      platform_video_id: source.videoId,
      ip: input.clientAddress ?? null,
      user_agent: input.userAgent?.slice(0, 1000) ?? null,
      email,
      lane: input.lane,
    })
    .select("id, created_at")
    .single()
  if (error || !data) throw new Error(`[content-rights] confirmation insert failed: ${error?.message ?? "no row"}`)
  const row = data as { id: string; created_at: string }
  await recordEvent({ confirmationId: row.id, kind: "confirmed", lane: input.lane, requestId: input.requestId ?? null })
  return { id: row.id, declarationVersion: declaration.version, expiresAt: new Date(Date.parse(row.created_at) + CONFIRMATION_TTL_MS).toISOString() }
}

/** The account's email as it is now (the record keeps it as it was then); null when unknown. */
async function accountEmail(userId: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle()
  const email = (data as { email?: unknown } | null)?.email
  return typeof email === "string" ? email : null
}

export async function readConfirmation(id: string): Promise<ConfirmationRecord | null> {
  if (!UUID_RE.test(id)) return null
  const { data, error } = await supabase
    .from("content_rights_confirmations")
    .select("id, user_id, runner_user_id, declaration_version, normalized_url, created_at")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(`[content-rights] confirmation read failed: ${error.message}`)
  if (!data) return null
  const row = data as { id: string; user_id: string | null; runner_user_id: string | null; declaration_version: number; normalized_url: string; created_at: string }
  return { id: row.id, userId: row.user_id, runnerUserId: row.runner_user_id, declarationVersion: row.declaration_version, normalizedUrl: row.normalized_url, createdAt: row.created_at }
}

export interface RightsEventInput {
  confirmationId: string
  kind: "confirmed" | "consumed" | "download_completed" | "download_failed"
  lane?: string | null
  requestId?: string | null
  downloadId?: string | null
  detail?: Record<string, unknown> | null
}

/** Appends one event; answers false when a `consumed` event exists already (the one-use lock). */
export async function recordEvent(input: RightsEventInput): Promise<boolean> {
  const { error } = await supabase.from("rights_events").insert({
    confirmation_id: input.confirmationId,
    kind: input.kind,
    lane: input.lane ?? null,
    request_id: input.requestId ?? null,
    download_id: input.downloadId ?? null,
    detail: input.detail ?? null,
  })
  if (error) {
    if (error.code === "23505") return false
    throw new Error(`[content-rights] event insert failed: ${error.message}`)
  }
  return true
}

export interface CheckRightsInput {
  url: string
  userId: string
  confirmationId?: string | null
  lane: RightsLane
}

/**
 * The READ half of the check every download makes, before anything else can
 * refuse it. With a confirmation id: it must exist, be this account's (or name
 * it as the runner), be for this link, under the current declaration, and not
 * older than an hour — nothing is written. Without one: null while
 * `content_rights_required` is off; refused once it is on.
 */
export async function checkRightsConfirmation(input: CheckRightsInput): Promise<ConfirmationRecord | null> {
  if (!input.confirmationId) {
    if (await contentRightsRequired()) {
      throw new ContentRightsError("rights_confirmation_required", "Confirm that you hold the rights to this content before it is imported.")
    }
    return null
  }
  const row = await readConfirmation(input.confirmationId)
  if (!row) throw new ContentRightsError("rights_confirmation_not_found", "That confirmation does not exist.")
  if (row.userId !== input.userId && row.runnerUserId !== input.userId) {
    throw new ContentRightsError("rights_confirmation_mismatch", "That confirmation belongs to another account.")
  }
  if (row.normalizedUrl !== normalizeSourceUrl(input.url)) {
    throw new ContentRightsError("rights_confirmation_mismatch", "That confirmation is for another link. Confirm the link you are importing.")
  }
  const declaration = await currentDeclaration()
  if (row.declarationVersion !== declaration.version) {
    throw new ContentRightsError("rights_confirmation_stale", "The declaration changed; read the current text and confirm again.")
  }
  if (Date.parse(row.createdAt) + CONFIRMATION_TTL_MS < Date.now()) {
    throw new ContentRightsError("rights_confirmation_expired", "That confirmation expired. Confirm again to import.")
  }
  return row
}

export interface ConsumeRightsInput {
  confirmationId: string
  url: string
  lane: RightsLane
  requestId?: string | null
}

/**
 * The WRITE half: spends the confirmation on the download that is about to
 * start (call it once the download's slot is held and nothing else can refuse
 * it). Throws `rights_confirmation_used` when another download spent it first.
 */
export async function consumeRightsConfirmation(input: ConsumeRightsInput): Promise<void> {
  const consumed = await recordEvent({ confirmationId: input.confirmationId, kind: "consumed", lane: input.lane, requestId: input.requestId ?? null, detail: { url: input.url } })
  if (!consumed) throw new ContentRightsError("rights_confirmation_used", "That confirmation was used for a download already. Confirm again to import.")
}

/**
 * The file's own fingerprint (sha256 of its bytes). Read from the file on
 * disk before the upload (a second pass over at most 500 MB, kept simple on
 * purpose: the upload path streams the file itself and is not ours to change
 * here).
 */
export async function contentHashOf(chunks: AsyncIterable<Buffer | Uint8Array>): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of chunks) hash.update(chunk)
  return hash.digest("hex")
}
