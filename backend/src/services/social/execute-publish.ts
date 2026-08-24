import { supabase } from "../../lib/supabase.js"
import { decryptToken, encryptToken } from "./encryption.js"
import { refreshAccessToken } from "./oauth.js"
import type { PublishRequest } from "./platforms/index.js"
import { getProvider } from "./providers/registry.js"
import { BadBodyError, NotPublishedError, RefreshTokenError } from "./providers/types.js"

/**
 * The ONE publish executor — shared by the synchronous
 * `POST /v1/social/publish` route and the scheduled-publish worker, so both
 * paths get identical token-refresh, reconnect-surfacing, and typed-error
 * semantics.
 *
 * Typed outcomes (callers map these to HTTP codes / retry policy):
 * - NotConnectedError    — no matching connection row.               No retry.
 * - RefreshTokenError    — token expired and could not self-heal
 *                          (`code` = "token_expired" | "refresh_failed").
 *                          Marks `reconnect_needed` for providers whose
 *                          tokens can't refresh (Meta family).        No retry.
 * - BadBodyError         — the platform DEFINITIVELY rejected the
 *                          content (publisher returned success:false, or the
 *                          publisher threw it). No retry.
 * - NotPublishedError    — the publisher PROVED nothing was posted and the
 *                          cause is transient (Instagram's container phase +
 *                          its 9007 rejection). Definite AND retryable.
 * - UnknownOutcomeError  — the provider call was already in flight when it
 *                          failed (throw/timeout): the platform MAY have
 *                          accepted the post. NEVER blind-retry these — a
 *                          duplicate post is user-visible. Surfaced for
 *                          manual retry.
 * - anything else        — failed BEFORE the provider call (DB/media/etc.):
 *                          safe to retry.
 */

export class NotConnectedError extends Error {}

export class UnknownOutcomeError extends Error {
  constructor(message: string, readonly causeErr?: unknown) {
    super(message)
  }
}

export interface SocialConnectionRow {
  id: string
  user_id: string
  platform: string
  access_token_encrypted: string
  refresh_token_encrypted: string | null
  token_expires_at: string | null
  metadata: Record<string, unknown> | null
}

export interface ExecutePublishInput {
  userId: string
  platform: string
  connectionId?: string
  request: PublishRequest
  /** Per-request metadata merged over the connection's (e.g. telegram chatId/parseMode). */
  extraMetadata?: Record<string, unknown>
}

export interface ExecutePublishSuccess {
  connectionId: string
  platformPostId?: string
  platformPostUrl?: string
}

async function markReconnectNeeded(connectionId: string, needed: boolean): Promise<void> {
  await supabase
    .from("social_connections")
    .update({ reconnect_needed: needed, updated_at: new Date().toISOString() })
    .eq("id", connectionId)
}

/**
 * Which account to publish to when the node names none.
 *
 * Chosen in JS rather than by `.order("is_default")`, and that is not a style
 * preference: migrations apply on push to `main` while staging shares the
 * production database, so between a merge and the promotion this code runs
 * against a table without the column. A SQL order on a column that does not
 * exist is an error on EVERY publish; reading a missing field is just
 * `undefined`.
 *
 * Oldest-first is the tiebreak, and it replaces something worse: the previous
 * `limit(1)` had no ordering at all, so a user holding two accounts on one
 * platform published to an arbitrary one — a real bug, independent of any of
 * this.
 */
export function pickDefaultConnection(rows: readonly SocialConnectionRow[]): SocialConnectionRow | undefined {
  if (rows.length === 0) return undefined
  const chosen = rows.find((row) => (row as { is_default?: boolean }).is_default === true)
  if (chosen) return chosen
  // `created_at` is on the table but not on the narrowed row type; read it
  // structurally rather than widening a type the rest of this file relies on.
  const at = (row: SocialConnectionRow) => String((row as { created_at?: string }).created_at ?? "")
  return [...rows].sort((a, b) => at(a).localeCompare(at(b)))[0]
}

export async function executePublish(input: ExecutePublishInput): Promise<ExecutePublishSuccess> {
  const provider = getProvider(input.platform)
  if (!provider) throw new NotConnectedError(`Unknown platform ${input.platform}`)

  // Load connection — by id if named, otherwise the user's default for this
  // platform. "Named none" is not an oversight: the Copilot is forbidden to
  // write a destination, so a node it built says which platform and leaves the
  // account to the user. This is where that choice is honoured.
  let query = supabase
    .from("social_connections")
    .select("*")
    .eq("user_id", input.userId)
    .eq("platform", input.platform)
  if (input.connectionId) query = query.eq("id", input.connectionId)
  const { data: rows, error: connErr } = await query
  const connection = input.connectionId
    ? ((rows?.[0] as SocialConnectionRow | undefined) ?? undefined)
    : pickDefaultConnection((rows ?? []) as SocialConnectionRow[])
  if (connErr || !connection) {
    throw new NotConnectedError(
      `No ${input.platform} account connected. Please connect in Settings > Integrations.`,
    )
  }

  // Decrypt access token; refresh if expired.
  let accessToken = decryptToken(connection.access_token_encrypted)
  const expired =
    connection.token_expires_at && new Date(connection.token_expires_at) <= new Date()

  if (expired) {
    if (!connection.refresh_token_encrypted || !provider.oauth) {
      if (provider.capabilities.refresh === "reconnect") {
        await markReconnectNeeded(connection.id, true)
      }
      const err = new RefreshTokenError(
        `Your ${input.platform} connection has expired. Please reconnect.`,
      )
      ;(err as RefreshTokenError & { code: string }).code = "token_expired"
      throw err
    }
    try {
      const refreshToken = decryptToken(connection.refresh_token_encrypted)
      const refreshed = await refreshAccessToken(provider, refreshToken)
      accessToken = refreshed.accessToken

      const updateData: Record<string, unknown> = {
        access_token_encrypted: encryptToken(refreshed.accessToken),
        reconnect_needed: false,
        updated_at: new Date().toISOString(),
      }
      if (refreshed.refreshToken) {
        updateData.refresh_token_encrypted = encryptToken(refreshed.refreshToken)
      }
      if (refreshed.expiresIn) {
        updateData.token_expires_at = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
      }
      await supabase.from("social_connections").update(updateData).eq("id", connection.id)
    } catch {
      if (provider.capabilities.refresh === "reconnect") {
        await markReconnectNeeded(connection.id, true)
      }
      const err = new RefreshTokenError(
        `Failed to refresh ${input.platform} token. Please reconnect.`,
      )
      ;(err as RefreshTokenError & { code: string }).code = "refresh_failed"
      throw err
    }
  }

  // Connection metadata (+ decrypted page token) + per-request extras.
  const metadata: Record<string, unknown> = { ...(connection.metadata ?? {}) }
  if (metadata.page_access_token && typeof metadata.page_access_token === "string") {
    metadata.page_access_token = decryptToken(metadata.page_access_token)
  }
  Object.assign(metadata, input.extraMetadata ?? {})

  // The provider call. From here on a failure is an UNKNOWN outcome — the
  // platform may have accepted the post before the error surfaced.
  let result
  try {
    result = await provider.publisher.publish(accessToken, input.request, metadata)
  } catch (err) {
    // A publisher that already CLASSIFIED its failure knows more than this
    // catch does — rethrow untouched. Wrapping a proven non-publish as
    // "MAY have been published" both misinforms the user and suppresses a
    // retry that is provably duplicate-free.
    if (err instanceof NotPublishedError || err instanceof BadBodyError) throw err
    const msg = err instanceof Error ? err.message : "Publish failed"
    throw new UnknownOutcomeError(`Publish outcome unknown — the post MAY have been published: ${msg}`, err)
  }

  if (!result.success) {
    // Application-level rejection reported by the platform — definitive, permanent.
    throw new BadBodyError(result.error ?? "Publish failed")
  }

  return {
    connectionId: connection.id,
    platformPostId: result.platformPostId,
    platformPostUrl: result.platformPostUrl,
  }
}
