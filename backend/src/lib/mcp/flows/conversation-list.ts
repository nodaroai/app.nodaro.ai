import { supabase } from "../../supabase.js"
import { hasCredits } from "../../config.js"
import { creditsChargedOf, runCreditsFor } from "../../job-credit-status.js"
import { resolveCanvasResultIds } from "../../canvas-result-ids.js"
import { KIND_OF_OUTPUT, outputKeyOfStep } from "./mappers/kit.js"
import { CONVERSATION_IDLE_GAP_MS, monthKey, type McpConversationSettings } from "./conversation-store.js"

/**
 * The MCP Conversations screen's read: one month's conversations of the
 * caller, and what the month and source pickers need (how many conversations
 * each month and each source has).
 */

export type ConversationMediaKind = "image" | "video" | "audio"

export interface ConversationSummary {
  readonly id: string
  /** The project it lives in (the editor opens it at /projects/{projectId}/workflows/{id}). */
  readonly projectId: string
  readonly name: string
  /** The product, with the connection names folded in ("Claude Code (nodaro)" is "claude-code"). */
  readonly client: string
  readonly clientLabel: string
  /** The connection's own name, as the user named the connector. */
  readonly clientName: string
  readonly startedAt: string
  readonly lastActivityAt: string
  /** Still receiving steps (its last step is within the idle gap). */
  readonly live: boolean
  readonly firstRequest: string | null
  readonly nodeCount: number
  readonly counts: Readonly<Record<ConversationMediaKind, number>>
  /** Credits charged for its jobs; null where credits are not billed. */
  readonly credits: number | null
  readonly cover: { readonly url: string; readonly kind: "image" | "video"; readonly setByUser: boolean } | null
  readonly updatedAt: string
}

export interface ConversationCount {
  readonly month: string
  readonly conversations: number
}

export interface ConversationSource {
  readonly client: string
  readonly label: string
  readonly conversations: number
  /** The connection names folded into this source, with their counts. */
  readonly connections: ReadonlyArray<{ readonly clientName: string; readonly conversations: number }>
}

export interface ConversationListing {
  /** The month listed ("YYYY-MM"). */
  readonly month: string
  readonly months: readonly ConversationCount[]
  /** Sources of the listed month. */
  readonly sources: readonly ConversationSource[]
  readonly data: readonly ConversationSummary[]
}

const PRODUCT_LABEL: Record<string, string> = {
  claude: "Claude",
  "claude-code": "Claude Code",
  chatgpt: "ChatGPT",
}

/** The source a conversation is listed under: the product, never the connection's own name. */
export function sourceOf(client: string | null | undefined, clientName: string | null | undefined): { client: string; label: string } {
  if (client && PRODUCT_LABEL[client]) return { client, label: PRODUCT_LABEL[client] }
  const base = (clientName ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim()
  if (!base) return { client: "other", label: "MCP" }
  const known = Object.entries(PRODUCT_LABEL).find(([, label]) => label.toLowerCase() === base.toLowerCase())
  if (known) return { client: known[0], label: known[1] }
  return { client: base.toLowerCase(), label: base }
}

/** The media kind of a step's result. */
function kindOf(step: Node): ConversationMediaKind | undefined {
  const key = outputKeyOfStep(step.type, step.data)
  return key ? KIND_OF_OUTPUT[key] : undefined
}

type Node = { id?: string; type?: string; data?: Record<string, unknown> }

function stepNodes(nodes: unknown): Node[] {
  if (!Array.isArray(nodes)) return []
  return (nodes as Node[]).filter((n) => n && typeof n === "object" && n.data && typeof n.data.mcpProvenance === "object")
}

/** The latest result of the conversation's steps (a video's thumbnail when it has one). */
function latestResult(steps: readonly Node[]): { url: string; kind: "image" | "video" } | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const data = steps[i].data ?? {}
    const results = Array.isArray(data.generatedResults) ? (data.generatedResults as Array<Record<string, unknown>>) : []
    const active = results[typeof data.activeResultIndex === "number" ? data.activeResultIndex : 0] ?? results[0]
    if (!active || typeof active.url !== "string") continue
    const kind = kindOf(steps[i])
    // An audio step has nothing to picture.
    if (kind === "audio") continue
    const isVideo = kind === "video"
    if (isVideo && typeof active.thumbnailUrl === "string") return { url: active.thumbnailUrl, kind: "image" }
    return { url: active.url, kind: isVideo ? "video" : "image" }
  }
  return null
}

interface ConversationRow {
  readonly id: string
  readonly project_id: string
  readonly name: string
  readonly nodes: unknown
  readonly thumbnail_url: string | null
  readonly settings: { mcpConversation?: McpConversationSettings } | null
  readonly updated_at: string
}

export function summarize(row: ConversationRow, now: Date, credits: number | null): ConversationSummary {
  const conv = row.settings?.mcpConversation
  const steps = stepNodes(row.nodes)
  const counts: Record<ConversationMediaKind, number> = { image: 0, video: 0, audio: 0 }
  for (const step of steps) {
    const kind = kindOf(step)
    if (kind) counts[kind] += 1
  }
  const source = sourceOf(conv?.client, conv?.clientName)
  const lastActivityAt = conv?.lastActivityAt ?? row.updated_at
  const latest = latestResult(steps)
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    client: source.client,
    clientLabel: source.label,
    clientName: conv?.clientName ?? source.label,
    startedAt: conv?.startedAt ?? row.updated_at,
    lastActivityAt,
    live: now.getTime() - Date.parse(lastActivityAt) <= CONVERSATION_IDLE_GAP_MS,
    firstRequest: conv?.firstRequest ?? null,
    nodeCount: steps.length,
    counts,
    credits,
    cover: row.thumbnail_url
      ? { url: row.thumbnail_url, kind: "image", setByUser: true }
      : latest
        ? { ...latest, setByUser: false }
        : null,
    updatedAt: row.updated_at,
  }
}

/** Every job a conversation's nodes ran: the assistant's, and the re-runs made in the editor. */
export function jobIdsOf(nodes: unknown): string[] {
  const ids = new Set<string>()
  for (const step of stepNodes(nodes)) {
    const data = step.data ?? {}
    const provenance = data.mcpProvenance as { jobId?: unknown } | undefined
    if (typeof provenance?.jobId === "string") ids.add(provenance.jobId)
    const results = Array.isArray(data.generatedResults) ? (data.generatedResults as Array<Record<string, unknown>>) : []
    for (const r of results) if (typeof r.jobId === "string") ids.add(r.jobId)
  }
  return [...ids]
}

/** Ids per `.in()` filter: what the gateway reliably accepts (as in job-step-charge.ts). */
const IN_BATCH = 200

/** Rows per page of a list read (PostgREST caps an answer at 1000). */
const PAGE = 1000

function batches<T>(items: readonly T[], size: number = IN_BATCH): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`MCP conversations: ${what} failed: ${error.message}`)
}

/**
 * Credits charged per conversation, from the usage logs of the jobs its nodes
 * ran (in batches). The jobs carry no workflow id (flow-graph.ts flowNodeId),
 * so the nodes are what names them. Null when credits are not billed, or when
 * a read failed: an unknown figure is never shown as 0.
 */
async function creditsByConversation(userId: string, rows: readonly ConversationRow[]): Promise<Map<string, number> | null> {
  if (!hasCredits()) return null
  const totals = new Map<string, number>()
  const owner = new Map<string, string>()
  for (const row of rows) for (const jobId of jobIdsOf(row.nodes)) owner.set(jobId, row.id)
  try {
    for (const ids of batches([...owner.keys()])) {
      // trash-read: the credits a conversation spent count a deleted job until the purge.
      const { data, error } = await supabase.from("jobs").select("id, usage_log_id").eq("user_id", userId).in("id", ids)
      if (error) fail("the jobs read", error)
      const jobs = (data ?? []) as Array<{ id: string; usage_log_id: string | null }>
      // Each job as a run: its steps (child jobs) and settled side holds included.
      const credits = await runCreditsFor(jobs, userId)
      for (const job of jobs) {
        const charged = creditsChargedOf(job.id, credits)
        const conversation = owner.get(job.id)
        if (charged === null || !conversation) continue
        totals.set(conversation, (totals.get(conversation) ?? 0) + charged)
      }
    }
    return totals
  } catch {
    return null
  }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH.test(value)
}

interface ChildRow {
  readonly id: string
  readonly parent_workflow_id: string
  readonly client: string | null
  readonly clientName: string | null
}

/** Every conversation of these hubs (a page at a time: a busy account has thousands). */
async function childrenOf(userId: string, hubIds: readonly string[]): Promise<ChildRow[]> {
  const all: ChildRow[] = []
  for (const ids of batches(hubIds)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("workflows")
        .select("id, parent_workflow_id, client:settings->mcpConversation->>client, clientName:settings->mcpConversation->>clientName")
        .eq("user_id", userId)
        .in("parent_workflow_id", ids)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) fail("the conversations read", error)
      const page = (data ?? []) as ChildRow[]
      all.push(...page)
      if (page.length < PAGE) break
    }
  }
  return all
}

/**
 * List one month's conversations (default: the latest month that has any,
 * else the current one), newest first, optionally only some sources.
 */
export async function listMcpConversations(
  userId: string,
  opts: { readonly month?: string; readonly sources?: readonly string[] },
  now: Date = new Date(),
): Promise<ConversationListing> {
  const { data: hubRows, error: hubError } = await supabase
    .from("workflows")
    .select("id, month:settings->mcpHub->>month")
    .eq("user_id", userId)
    .is("parent_workflow_id", null)
    .not("settings->mcpHub", "is", null)
    .limit(PAGE)
  if (hubError) fail("the hubs read", hubError)
  const hubs = ((hubRows ?? []) as Array<{ id: string; month: string | null }>).filter((h) => isMonth(h.month))
  const hubMonth = new Map(hubs.map((h) => [h.id, h.month as string]))
  const children = await childrenOf(userId, hubs.map((h) => h.id))

  const perMonth = new Map<string, number>()
  for (const child of children) {
    const month = hubMonth.get(child.parent_workflow_id)
    if (month) perMonth.set(month, (perMonth.get(month) ?? 0) + 1)
  }
  const months = [...perMonth.entries()]
    .map(([month, conversations]) => ({ month, conversations }))
    .sort((a, b) => b.month.localeCompare(a.month))
  const month = opts.month ?? months[0]?.month ?? monthKey(now)

  const inMonth = children.filter((c) => hubMonth.get(c.parent_workflow_id) === month)
  const sources = new Map<string, { label: string; conversations: number; connections: Map<string, number> }>()
  for (const child of inMonth) {
    const source = sourceOf(child.client, child.clientName)
    const entry = sources.get(source.client) ?? { label: source.label, conversations: 0, connections: new Map<string, number>() }
    entry.conversations += 1
    const connection = child.clientName ?? source.label
    entry.connections.set(connection, (entry.connections.get(connection) ?? 0) + 1)
    sources.set(source.client, entry)
  }

  const wanted = opts.sources && opts.sources.length > 0 ? new Set(opts.sources) : null
  const ids = inMonth.filter((c) => !wanted || wanted.has(sourceOf(c.client, c.clientName).client)).map((c) => c.id)
  const rows: ConversationRow[] = []
  for (const batch of batches(ids)) {
    const { data, error } = await supabase
      .from("workflows")
      .select("id, project_id, name, nodes, thumbnail_url, settings, updated_at")
      .eq("user_id", userId)
      .in("id", batch)
    if (error) fail("the conversation rows read", error)
    rows.push(...((data ?? []) as ConversationRow[]))
  }
  // Result ids resolved as every server read of workflow nodes does (canvas-result-ids.ts).
  const resolved = await Promise.all(
    rows.map(async (row) => ({ ...row, nodes: await resolveCanvasResultIds(row.nodes, userId, { settings: row.settings }) })),
  )
  const credits = await creditsByConversation(userId, resolved)
  const data = resolved
    .map((row) => summarize(row, now, credits ? credits.get(row.id) ?? 0 : null))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))

  return {
    month,
    months,
    sources: [...sources.entries()]
      .map(([client, s]) => ({
        client,
        label: s.label,
        conversations: s.conversations,
        connections: [...s.connections.entries()].map(([clientName, conversations]) => ({ clientName, conversations })),
      }))
      .sort((a, b) => b.conversations - a.conversations),
    data,
  }
}
