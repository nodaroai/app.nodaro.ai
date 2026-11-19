/**
 * The `share_links` table (migration 680), read and written with the service
 * role only: the table grants nothing to client roles.
 *
 * One row per item (`owner_id, kind, target_id`): turning a link off stamps
 * `revoked_at`, turning it on again clears it and keeps the token, so a link
 * handed out before works again. The token is the capability: 32 random bytes,
 * base64url — never derived from an id.
 *
 * Staging runs ahead of the migration (it reaches the shared database only when
 * main deploys), so a missing table reads as "nothing shared"
 * (`ShareLinksUnavailableError` for a write).
 */
import { randomBytes } from "node:crypto"
import { supabase } from "../supabase.js"
import { isMissingTableError } from "../postgrest-errors.js"
import type { Share, ShareKind, ShareLinkRow } from "./types.js"

const SHARE_COLUMNS = "id, token, owner_id, kind, target_id, allow_copy, created_at, updated_at, revoked_at"

/** 32 random bytes, base64url: 43 characters. */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url")
}

/** The token's shape: anything else is no token of ours. */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

/** The table is not in this database yet (staging before the migration reaches main). */
export class ShareLinksUnavailableError extends Error {
  readonly code = "not_available" as const
  constructor() {
    super("Share links are not available on this server yet.")
    this.name = "ShareLinksUnavailableError"
  }
}

export function toShare(row: ShareLinkRow): Share {
  return {
    token: row.token,
    kind: row.kind,
    targetId: row.target_id,
    shared: row.revoked_at === null,
    allowCopy: row.allow_copy === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** The owner's row for one item, or null. */
export async function findOwnShare(ownerId: string, kind: ShareKind, targetId: string): Promise<ShareLinkRow | null> {
  const { data, error } = await supabase
    .from("share_links")
    .select(SHARE_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("kind", kind)
    .eq("target_id", targetId)
    .maybeSingle()
  if (error) {
    if (isMissingTableError(error)) return null
    throw new Error(`share_links read failed: ${error.message}`)
  }
  return (data as ShareLinkRow | null) ?? null
}

/** A LIVE link by its token, or null (unknown, malformed, turned off, or no table yet). */
export async function findLiveShareByToken(token: string): Promise<ShareLinkRow | null> {
  if (!SHARE_TOKEN_RE.test(token)) return null
  const { data, error } = await supabase
    .from("share_links")
    .select(SHARE_COLUMNS)
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle()
  if (error) {
    if (isMissingTableError(error)) return null
    throw new Error(`share_links read failed: ${error.message}`)
  }
  return (data as ShareLinkRow | null) ?? null
}

const UNIQUE_VIOLATION = "23505"

export interface ShareSetInput {
  readonly ownerId: string
  readonly kind: ShareKind
  readonly targetId: string
  readonly shared: boolean
  /** Omitted: the row keeps its value (false on a new row). */
  readonly allowCopy?: boolean
}

/**
 * Turn one item's link on or off. The first call creates the row (with a new
 * token; off from birth when it asks for off, so the setting is kept); every
 * later call keeps the token. Two first calls at once meet on the unique key
 * and the loser updates the winner's row.
 */
export async function setShare(input: ShareSetInput): Promise<ShareLinkRow> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await findOwnShare(input.ownerId, input.kind, input.targetId)
    if (existing) return updateShare(existing, input)
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from("share_links")
      .insert({
        token: newShareToken(),
        owner_id: input.ownerId,
        kind: input.kind,
        target_id: input.targetId,
        allow_copy: input.allowCopy ?? false,
        revoked_at: input.shared ? null : now,
        created_at: now,
        updated_at: now,
      })
      .select(SHARE_COLUMNS)
      .single()
    if (!error && data) return data as ShareLinkRow
    if (isMissingTableError(error)) throw new ShareLinksUnavailableError()
    // A row made at the same moment (the item's key), or a token already
    // taken (the token's key): read again and update, or try a new token.
    if (error?.code !== UNIQUE_VIOLATION) throw new Error(`share_links insert failed: ${error?.message ?? "no row"}`)
  }
  throw new Error("share_links insert kept conflicting")
}

async function updateShare(existing: ShareLinkRow, input: ShareSetInput): Promise<ShareLinkRow> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("share_links")
    .update({
      // Off keeps the moment it went off; on clears it (same token).
      revoked_at: input.shared ? null : (existing.revoked_at ?? now),
      allow_copy: input.allowCopy ?? existing.allow_copy,
      updated_at: now,
    })
    .eq("id", existing.id)
    .eq("owner_id", input.ownerId)
    .select(SHARE_COLUMNS)
    .single()
  if (error || !data) {
    if (isMissingTableError(error)) throw new ShareLinksUnavailableError()
    throw new Error(`share_links update failed: ${error?.message ?? "no row"}`)
  }
  return data as ShareLinkRow
}
