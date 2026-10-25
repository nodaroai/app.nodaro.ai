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
  /** Part 2, 3, …: a conversation continued once the one before reached the node cap. */
  readonly part?: number
  /** The part this one continues. */
  readonly continuedFrom?: string
  /** "request": started by a call's `flow_id: "new"`, not by the chat's first call. */
  readonly startedBy?: "request"
  /**
   * Steps an assistant made, counted again from the nodes at every step's
   * write, so the node cap is checked without reading the graph. Absent on
   * conversations written before the count (their nodes are read instead).
   */
  readonly steps?: number
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

export interface ConversationRow {
  readonly id: string
  readonly parent_workflow_id: string
  readonly name?: string
  readonly settings: { mcpConversation?: McpConversationSettings } | null
  readonly created_at?: string
}

/** How far apart two first calls of one chat may start and still be the same conversation. */
const RACE_WINDOW_MS = 60_000

/** How far apart several `flow_id: "new"` calls sent together may start and still be one new conversation. */
const NEW_RACE_WINDOW_MS = 10_000

/** Parts followed at most when a full conversation already continues (a chain this long is not a chat). */
const MAX_PART_HOPS = 20

/** Steps a conversation holds before its next step opens "Part N+1": a very long chat as one graph is unreadable. */
export const CONVERSATION_NODE_CAP = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** This connection's conversations of one chat (or its keyless ones), newest first. */
async function candidates(
  userId: string,
  projectId: string,
  identity: McpConversationIdentity,
  clientName: string,
): Promise<ConversationRow[]> {
  let query = supabase
    .from("workflows")
    .select("id, parent_workflow_id, name, settings, created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .not("parent_workflow_id", "is", null)
    .eq("settings->mcpConversation->>client", identity.client)
  query = identity.key
    ? query.eq("settings->mcpConversation->>key", identity.key).order("created_at", { ascending: false })
    : query
        .eq("settings->mcpConversation->>clientName", clientName)
        .is("settings->mcpConversation->>key", null)
        .order("updated_at", { ascending: false })
  const { data, error } = await query.limit(10)
  if (error) throw new Error(`MCP conversation lookup failed: ${error.message}`)
  return (data ?? []) as ConversationRow[]
}

/**
 * The conversation a call continues: a keyed chat's newest conversation (a
 * later part, or one the assistant started with `flow_id: "new"`) — and when
 * that is one of several rows its first calls raced to create, the one they
 * converge on, so a call never lands in a row its race is about to remove; a
 * keyless chat's latest still within {@link CONVERSATION_IDLE_GAP_MS}.
 */
export function current(rows: readonly ConversationRow[], identity: McpConversationIdentity, now: Date): ConversationRow | null {
  if (identity.key) {
    const newest = rows[0]
    if (!newest) return null
    const conv = newest.settings?.mcpConversation
    if (conv?.part) return newest
    return raceWinner(rows, conv?.startedAt ?? "", conv?.startedBy === "request" ? "request" : "chat") ?? newest
  }
  let best: { row: ConversationRow; at: number } | null = null
  for (const row of rows) {
    const at = Date.parse(row.settings?.mcpConversation?.lastActivityAt ?? "")
    if (!Number.isFinite(at) || now.getTime() - at > CONVERSATION_IDLE_GAP_MS) continue
    if (!best || at > best.at) best = { row, at }
  }
  return best?.row ?? null
}

/**
 * Several first calls of one chat (Claude.ai sends a few at once) each create
 * a conversation: all of them converge on the oldest started within
 * {@link RACE_WINDOW_MS} of ours.
 */
function raceWinner(rows: readonly ConversationRow[], startedAt: string, kind: "chat" | "request" = "chat"): ConversationRow | null {
  const ours = Date.parse(startedAt)
  // A chat's first calls race among the chat's own rows; several `flow_id: "new"`
  // calls sent together race among the rows such calls started, in a narrower window.
  const window = kind === "request" ? NEW_RACE_WINDOW_MS : RACE_WINDOW_MS
  const racing = rows.filter((row) => {
    const conv = row.settings?.mcpConversation
    const at = Date.parse(conv?.startedAt ?? "")
    const sameKind = (conv?.startedBy === "request") === (kind === "request")
    return Number.isFinite(at) && Math.abs(at - ours) <= window && !conv?.part && sameKind
  })
  const sorted = [...racing].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id))
  return sorted[0] ?? null
}

/** How many steps (nodes an assistant made) these nodes hold. */
export function countSteps(nodes: ReadonlyArray<Record<string, unknown>>): number {
  return nodes.filter((n) => {
    const data = n?.data as Record<string, unknown> | undefined
    return !!data && typeof data.mcpProvenance === "object" && data.mcpProvenance !== null
  }).length
}

/** How many steps a conversation holds: its stored count, else (an older row) its nodes. */
async function stepCount(userId: string, row: ConversationRow): Promise<number> {
  const stored = row.settings?.mcpConversation?.steps
  if (typeof stored === "number" && Number.isFinite(stored)) return stored
  const { data, error } = await supabase
    .from("workflows")
    .select("nodes")
    .eq("id", row.id)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`MCP conversation lookup failed: ${error.message}`)
  return countSteps(Array.isArray(data?.nodes) ? (data.nodes as Record<string, unknown>[]) : [])
}

/** The newest part continuing `workflowId`, or null when nothing continues it. */
async function nextPart(userId: string, projectId: string, workflowId: string): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from("workflows")
    .select("id, parent_workflow_id, name, settings, created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("settings->mcpConversation->>continuedFrom", workflowId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`MCP conversation lookup failed: ${error.message}`)
  return (data as ConversationRow | null) ?? null
}

/**
 * Remove a row this call created and lost a race with, only while it is still
 * empty and at the version read: a step another call already wrote keeps it.
 */
async function removeIfEmpty(userId: string, workflowId: string): Promise<void> {
  const { data } = await supabase
    .from("workflows")
    .select("version, nodes")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .maybeSingle()
  const row = data as { version?: number; nodes?: unknown } | null
  if (!row || (Array.isArray(row.nodes) && row.nodes.length > 0)) return
  await supabase.from("workflows").delete().eq("id", workflowId).eq("user_id", userId).eq("version", row.version ?? -1)
}

/** A conversation the caller named by id (`flow_id`), if it is one of the caller's. */
async function named(userId: string, projectId: string, workflowId: string): Promise<ConversationRow | null> {
  if (!UUID.test(workflowId)) return null
  const { data, error } = await supabase
    .from("workflows")
    .select("id, parent_workflow_id, name, settings, created_at")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle()
  if (error) throw new Error(`MCP conversation lookup failed: ${error.message}`)
  const row = data as ConversationRow | null
  return row?.settings?.mcpConversation && row.parent_workflow_id ? row : null
}

interface NewConversation {
  readonly firstRequest?: string
  readonly prompt?: string
  /** Started by the call's `flow_id: "new"`, not by a chat's first call. */
  readonly startedByRequest?: boolean
  /** The part this one continues once that part reached {@link CONVERSATION_NODE_CAP}. */
  readonly continues?: ConversationRow
}

async function createConversation(
  session: McpSession,
  projectId: string,
  identity: McpConversationIdentity,
  now: Date,
  opts: NewConversation,
): Promise<{ id: string; hubId: string; startedAt: string }> {
  const hubId = await ensureMonthHub(session.userId, projectId, monthKey(now))
  const at = now.toISOString()
  const before = opts.continues?.settings?.mcpConversation
  const part = before ? (before.part ?? 1) + 1 : undefined
  const settings: McpConversationSettings = {
    client: identity.client,
    clientName: session.clientName,
    key: identity.key,
    startedAt: at,
    lastActivityAt: at,
    ...(before?.firstRequest ? { firstRequest: before.firstRequest } : opts.firstRequest ? { firstRequest: opts.firstRequest } : {}),
    ...(part && opts.continues ? { part, continuedFrom: opts.continues.id } : {}),
    ...(opts.startedByRequest ? { startedBy: "request" as const } : {}),
  }
  const base = opts.continues?.name?.replace(/ · Part \d+$/, "") ?? conversationName(opts.firstRequest, opts.prompt)
  const { data, error } = await supabase
    .from("workflows")
    .insert({
      project_id: projectId,
      user_id: session.userId,
      parent_workflow_id: hubId,
      name: part ? `${base} · Part ${part}` : base,
      nodes: [],
      edges: [],
      settings: { mcpConversation: settings },
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`Failed to create the MCP conversation: ${error?.message ?? "unknown"}`)
  return { id: data.id as string, hubId, startedAt: at }
}

/**
 * The conversation this request belongs to, created when there is none:
 *  - `requested` (the call's `flow_id`): `"new"` starts a new conversation; a
 *    conversation id of the caller's continues that one;
 *  - else the client's per-chat key when it sends one, or the connection's
 *    latest conversation still within {@link CONVERSATION_IDLE_GAP_MS}.
 * A conversation that reached {@link CONVERSATION_NODE_CAP} steps continues in
 * a new part, linked to the one before.
 */
export async function resolveConversation(
  session: McpSession,
  identity: McpConversationIdentity,
  now: Date,
  naming: { readonly firstRequest?: string; readonly prompt?: string },
  requested?: string,
): Promise<ResolvedConversation> {
  const projectId = await ensureMcpProject(session)
  const pinned = requested && requested !== "new" ? await named(session.userId, projectId, requested) : null
  const found =
    requested === "new"
      ? null
      : pinned ?? current(await candidates(session.userId, projectId, identity, session.clientName), identity, now)
  if (found) {
    // A full conversation continues in its newest part; a new part only when none has room.
    let part = found
    for (let hop = 0; hop < MAX_PART_HOPS; hop++) {
      if ((await stepCount(session.userId, part)) < CONVERSATION_NODE_CAP) {
        return { workflowId: part.id, hubId: part.parent_workflow_id, isNew: false }
      }
      const later = await nextPart(session.userId, projectId, part.id)
      if (!later) break
      part = later
    }
    const next = await createConversation(session, projectId, identity, now, { ...naming, continues: part })
    return { workflowId: next.id, hubId: next.hubId, isNew: true }
  }

  const byRequest = requested === "new"
  const created = await createConversation(session, projectId, identity, now, { ...naming, startedByRequest: byRequest })
  // Calls racing to start one conversation (a chat's first calls, or several
  // `flow_id: "new"` calls sent together): all converge on the oldest, and the
  // loser's row goes while it is still empty.
  const rows = await candidates(session.userId, projectId, identity, session.clientName)
  const winner = raceWinner(rows, created.startedAt, byRequest ? "request" : "chat")
  if (winner && winner.id !== created.id) {
    await removeIfEmpty(session.userId, created.id)
    return { workflowId: winner.id, hubId: winner.parent_workflow_id, isNew: false }
  }
  return { workflowId: created.id, hubId: created.hubId, isNew: true }
}
