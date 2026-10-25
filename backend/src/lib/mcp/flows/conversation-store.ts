import { supabase } from "../../supabase.js"
import type { McpSession } from "../session.js"
import { ensureMcpProject } from "../tools/_mcp-project.js"
import type { McpConversationIdentity } from "./conversation-key.js"

/**
 * Where an MCP conversation's flow lives.
 *
 * Every month has one HUB workflow in the caller's MCP project
 * (`settings.mcpHub = { month }`), and each conversation is a CHILD workflow of
 * the hub of the month it started in (`parent_workflow_id`), so the user's
 * workflow lists gain one row per month and the conversations stay out of
 * them. The conversation row carries what identifies it in
 * `settings.mcpConversation`; there is no other store, so nothing has to be
 * kept in step and a restart loses nothing.
 */

/** A conversation with no per-chat key continues while its last step is this recent. */
export const CONVERSATION_IDLE_GAP_MS = 30 * 60 * 1000

/** Longest conversation name taken from the user's first request. */
export const CONVERSATION_NAME_MAX = 50

export interface McpHubSettings {
  readonly month: string
}

export interface McpConversationSettings {
  readonly client: McpConversationIdentity["client"]
  /** The connection's name (`developer_apps.name`), e.g. "Claude Code (nodaro)". */
  readonly clientName: string
  readonly key: string | null
  readonly startedAt: string
  readonly lastActivityAt: string
  /** The user's first request in this conversation, when the assistant passed it. */
  readonly firstRequest?: string
  /** True once the user renamed the conversation: a name the user set is never replaced. */
  readonly nameSetByUser?: boolean
}

export interface ResolvedConversation {
  readonly workflowId: string
  readonly hubId: string
  readonly isNew: boolean
}

/** "YYYY-MM" in UTC. */
export function monthKey(at: Date): string {
  return at.toISOString().slice(0, 7)
}

function hubName(month: string): string {
  return `MCP Conversations · ${month}`
}

/** The conversation's name: the user's first request, else the assistant's prompt, shortened. */
export function conversationName(firstRequest: string | undefined, prompt: string | undefined): string {
  const source = (firstRequest ?? prompt ?? "").replace(/\s+/g, " ").trim()
  if (!source) return "MCP conversation"
  return source.length > CONVERSATION_NAME_MAX ? `${source.slice(0, CONVERSATION_NAME_MAX - 1).trimEnd()}…` : source
}

async function oldestHub(userId: string, projectId: string, month: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("workflows")
    .select("id")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .is("parent_workflow_id", null)
    .eq("settings->mcpHub->>month", month)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`MCP hub lookup failed: ${error.message}`)
  return (data?.id as string | undefined) ?? null
}

/**
 * The month's hub, created on first need. There is no unique constraint to
 * lean on, so after inserting the oldest hub is re-read and used: two racing
 * creators converge on the same one (the loser's empty row is removed).
 */
export async function ensureMonthHub(userId: string, projectId: string, month: string): Promise<string> {
  const existing = await oldestHub(userId, projectId, month)
  if (existing) return existing
  const { data: inserted, error } = await supabase
    .from("workflows")
    .insert({
      project_id: projectId,
      user_id: userId,
      name: hubName(month),
      nodes: [],
      edges: [],
      settings: { mcpHub: { month } satisfies McpHubSettings },
    })
    .select("id")
    .single()
  const winner = await oldestHub(userId, projectId, month)
  if (!winner) throw new Error(`Failed to create the MCP hub: ${error?.message ?? "unknown"}`)
  if (inserted?.id && inserted.id !== winner) {
    await supabase.from("workflows").delete().eq("id", inserted.id).eq("user_id", userId)
  }
  return winner
}

interface ConversationRow {
  readonly id: string
  readonly parent_workflow_id: string
  readonly settings: { mcpConversation?: McpConversationSettings } | null
  readonly created_at?: string
}

/** How far apart two first calls of one keyless chat may start and still be the same conversation. */
const KEYLESS_RACE_WINDOW_MS = 60_000

/**
 * Several first calls of one keyless chat (Claude.ai sends a few at once) each
 * create a conversation: all of them converge on the oldest started within
 * {@link KEYLESS_RACE_WINDOW_MS} of ours.
 */
async function keylessWinner(
  userId: string,
  projectId: string,
  identity: McpConversationIdentity,
  clientName: string,
  startedAt: string,
): Promise<ConversationRow | null> {
  const ours = Date.parse(startedAt)
  const rows = (await recentKeyless(userId, projectId, identity, clientName)).filter((row) => {
    const at = Date.parse(row.settings?.mcpConversation?.startedAt ?? "")
    return Number.isFinite(at) && Math.abs(at - ours) <= KEYLESS_RACE_WINDOW_MS
  })
  const sorted = [...rows].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id))
  return sorted[0] ?? null
}

async function byKey(userId: string, projectId: string, identity: McpConversationIdentity & { key: string }): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from("workflows")
    .select("id, parent_workflow_id, settings")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .not("parent_workflow_id", "is", null)
    .eq("settings->mcpConversation->>client", identity.client)
    .eq("settings->mcpConversation->>key", identity.key)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`MCP conversation lookup failed: ${error.message}`)
  return (data as ConversationRow | null) ?? null
}

/** The most recent keyless conversation of this connection that is still within the idle gap. */
async function recentWithoutKey(
  userId: string,
  projectId: string,
  identity: McpConversationIdentity,
  clientName: string,
  now: Date,
): Promise<ConversationRow | null> {
  const rows = await recentKeyless(userId, projectId, identity, clientName)
  let best: { row: ConversationRow; at: number } | null = null
  for (const row of rows) {
    const at = Date.parse(row.settings?.mcpConversation?.lastActivityAt ?? "")
    if (!Number.isFinite(at) || now.getTime() - at > CONVERSATION_IDLE_GAP_MS) continue
    if (!best || at > best.at) best = { row, at }
  }
  return best?.row ?? null
}

/** This connection's newest keyless conversations, newest first. */
async function recentKeyless(
  userId: string,
  projectId: string,
  identity: McpConversationIdentity,
  clientName: string,
): Promise<ConversationRow[]> {
  const { data, error } = await supabase
    .from("workflows")
    .select("id, parent_workflow_id, settings, created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .not("parent_workflow_id", "is", null)
    .eq("settings->mcpConversation->>client", identity.client)
    .eq("settings->mcpConversation->>clientName", clientName)
    .is("settings->mcpConversation->>key", null)
    .order("updated_at", { ascending: false })
    .limit(5)
  if (error) throw new Error(`MCP conversation lookup failed: ${error.message}`)
  return (data ?? []) as ConversationRow[]
}

/**
 * The conversation this request belongs to, created when there is none: by
 * the client's per-chat key when it sends one, else the connection's latest
 * conversation still within {@link CONVERSATION_IDLE_GAP_MS}.
 */
export async function resolveConversation(
  session: McpSession,
  identity: McpConversationIdentity,
  now: Date,
  naming: { readonly firstRequest?: string; readonly prompt?: string },
): Promise<ResolvedConversation> {
  const projectId = await ensureMcpProject(session)
  const found = identity.key
    ? await byKey(session.userId, projectId, { ...identity, key: identity.key })
    : await recentWithoutKey(session.userId, projectId, identity, session.clientName, now)
  if (found) return { workflowId: found.id, hubId: found.parent_workflow_id, isNew: false }

  const hubId = await ensureMonthHub(session.userId, projectId, monthKey(now))
  const at = now.toISOString()
  const settings: McpConversationSettings = {
    client: identity.client,
    clientName: session.clientName,
    key: identity.key,
    startedAt: at,
    lastActivityAt: at,
    ...(naming.firstRequest ? { firstRequest: naming.firstRequest } : {}),
  }
  const { data, error } = await supabase
    .from("workflows")
    .insert({
      project_id: projectId,
      user_id: session.userId,
      parent_workflow_id: hubId,
      name: conversationName(naming.firstRequest, naming.prompt),
      nodes: [],
      edges: [],
      settings: { mcpConversation: settings },
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`Failed to create the MCP conversation: ${error?.message ?? "unknown"}`)
  const id = data.id as string
  // Two first calls of one keyed chat racing: both inserted, both converge on
  // the oldest and the loser's empty row goes.
  const winner = identity.key
    ? await byKey(session.userId, projectId, { ...identity, key: identity.key })
    : await keylessWinner(session.userId, projectId, identity, session.clientName, at)
  if (winner && winner.id !== id) {
    // Our row is the empty loser of the race: nothing was written into it yet.
    await supabase.from("workflows").delete().eq("id", id).eq("user_id", session.userId)
    return { workflowId: winner.id, hubId: winner.parent_workflow_id, isNew: false }
  }
  return { workflowId: id, hubId, isNew: true }
}
