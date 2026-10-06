import type { FastifyRequest } from "fastify"
import { supabase } from "../../lib/supabase.js"
import { readNodeCursor, resetNodeCursor, writeNodeCursor } from "../workflow-engine/node-cursor.js"
import { normalizeChannel } from "./telegram-channel.js"

export const FEED_CURSOR_KIND = "telegram-channel-feed"

/**
 * Where a Telegram Channel Feed node stands is a property of the NODE and the
 * CHANNEL it reads: the key the position is stored under names both, so
 * changing the channel starts fresh (post ids are per channel — a position
 * from another channel either hides every post for ever or replays its
 * history as news) and changing back resumes where that channel stood.
 */
export function feedPositionKey(nodeId: string, channel: string): string {
  // Channel names are case-insensitive on Telegram: @Acme and @acme are one channel.
  const normalized = (normalizeChannel(channel) || channel.trim()).toLowerCase()
  return `${nodeId}#${normalized}`
}

/** The workflow's owner — the row the position lives under. */
export async function workflowOwnerId(workflowId: string): Promise<string | undefined> {
  try {
    const { data, error } = await supabase.from("workflows").select("user_id").eq("id", workflowId).maybeSingle()
    if (error || !data) return undefined
    const owner = (data as { user_id?: unknown }).user_id
    return typeof owner === "string" && owner.length > 0 ? owner : undefined
  } catch {
    return undefined
  }
}

/**
 * Whose position this request may read and move: the workflow owner's — when
 * the orchestrator calls (every run of the workflow, a published app's
 * included; the row is the workflow's, whoever ran it) or the owner runs the
 * node in the editor. Anyone else (a collaborator's editor Run, an API token
 * naming someone's workflow and node) reads the feed statelessly: they
 * neither see nor move the owner's position, so a stranger's call can never
 * take the row over and make the owner's next tick republish the newest posts.
 */
export function feedPositionUser(req: Pick<FastifyRequest, "authKind">, callerId: string, ownerId: string | undefined): string | undefined {
  if (!ownerId) return undefined
  if (req.authKind === "internal") return ownerId
  return ownerId === callerId ? ownerId : undefined
}

/**
 * The position under its channel key. A row written before positions were
 * keyed by channel (the bare node id) is carried over once and removed, so a
 * feed that was already running continues where it stood.
 */
export async function readFeedPosition(workflowId: string, nodeId: string, channel: string, userId: string): Promise<number | undefined> {
  const key = feedPositionKey(nodeId, channel)
  const current = await readNodeCursor(workflowId, key, userId)
  if (current !== undefined) return current
  const legacy = await readNodeCursor(workflowId, nodeId, userId)
  if (legacy === undefined) return undefined
  await writeNodeCursor(workflowId, key, userId, FEED_CURSOR_KIND, legacy)
  await resetNodeCursor(workflowId, nodeId, userId)
  return legacy
}
