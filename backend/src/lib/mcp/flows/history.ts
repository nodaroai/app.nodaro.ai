import { randomUUID } from "node:crypto"
import { supabase } from "../../supabase.js"
import { newSession } from "../session.js"
import { ensureMcpProject } from "../tools/_mcp-project.js"
import type { McpConversationClient } from "./conversation-key.js"
import { CONVERSATION_IDLE_GAP_MS, CONVERSATION_NODE_CAP, conversationName, ensureMonthHub, monthKey, type McpConversationSettings } from "./conversation-store.js"
import { sourceOf } from "./conversation-list.js"
import { flowNodeId, placeFlowNode } from "./flow-graph.js"
import { flowNodeFor, historyRouteFor, type FlowNodeSpec } from "./node-mappers.js"
import { OUTPUT_URL_FIELD } from "./mappers/kit.js"

/**
 * One account's MCP history made into conversation flows, after the fact:
 * the jobs an assistant made before the feature existed (or with it off),
 * grouped the way a live conversation is — by connection, a new
 * conversation after a pause longer than the idle gap or at the node cap —
 * and filed in the month's hub of when each conversation started.
 *
 * `planHistory` is pure and decides everything; `applyHistory` writes the
 * plan through the same writers a live conversation uses (the month hub, the
 * conversation row, `placeFlowNode`). A job already in a conversation is never
 * filed twice, so a second run adds only what is new. A job whose node could
 * not reproduce it (no mapper, or a field the node cannot hold) is left as it
 * is, in the library and "Recent from MCP".
 */

export interface HistoryJob {
  readonly id: string
  readonly created_at: string
  readonly completed_at: string | null
  readonly source_detail: string | null
  readonly input_data: Record<string, unknown> | null
  readonly output_data: Record<string, unknown> | null
}

export interface PlannedStep {
  readonly jobId: string
  readonly at: string
  readonly spec: FlowNodeSpec
  readonly resultUrl: string
  readonly thumbnailUrl?: string
}

export interface PlannedConversation {
  readonly client: McpConversationClient
  readonly clientName: string
  readonly month: string
  readonly name: string
  readonly startedAt: string
  readonly lastActivityAt: string
  readonly steps: readonly PlannedStep[]
}

export interface HistoryPlan {
  readonly conversations: readonly PlannedConversation[]
  /** Jobs left as they are, by reason. */
  readonly skipped: Readonly<Record<string, number>>
}

/** What a job's input carries beyond the route body: bookkeeping, never a node setting. */
const INPUT_BOOKKEEPING: ReadonlySet<string> = new Set([
  "type", "userPrompt", "resolvedModel", "batchId", "batchIndex", "injectCharacterContext", "origin",
  "mcp_client", "userId", "workflowId", "nodeId",
])

const PRODUCTS: ReadonlySet<McpConversationClient> = new Set(["claude", "claude-code", "chatgpt"])

function stepOf(job: HistoryJob): PlannedStep | string {
  const input = job.input_data ?? {}
  const type = typeof input.type === "string" ? input.type : ""
  const target = historyRouteFor(type)
  if (!target) return `no node for ${type || "an untyped job"}`
  const body = Object.fromEntries(Object.entries(input).filter(([k]) => !INPUT_BOOKKEEPING.has(k)))
  const spec = flowNodeFor(target.route, body, target.tool)
  if (!spec) return `${type}: the node cannot reproduce it`
  const url = job.output_data?.[OUTPUT_URL_FIELD[spec.outputKey]]
  if (typeof url !== "string" || !url) return `${type}: no result`
  const thumb = job.output_data?.thumbnailUrl
  return {
    jobId: job.id,
    at: job.completed_at ?? job.created_at,
    spec,
    resultUrl: url,
    ...(typeof thumb === "string" && spec.outputKey === "generatedVideoUrl" ? { thumbnailUrl: thumb } : {}),
  }
}

/** Group an account's completed MCP jobs into conversations (pure). `filed` lists the jobs already in one. */
export function planHistory(jobs: readonly HistoryJob[], filed: ReadonlySet<string> = new Set()): HistoryPlan {
  const skipped: Record<string, number> = {}
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }
  const byConnection = new Map<string, HistoryJob[]>()
  for (const job of jobs) {
    if (filed.has(job.id)) {
      skip("already in a conversation")
      continue
    }
    const connection = job.source_detail ?? "MCP"
    byConnection.set(connection, [...(byConnection.get(connection) ?? []), job])
  }
  const conversations: PlannedConversation[] = []
  for (const [clientName, list] of byConnection) {
    const source = sourceOf(null, clientName).client as McpConversationClient
    const client: McpConversationClient = PRODUCTS.has(source) ? source : "other"
    let current: { startedAt: string; last: number; steps: PlannedStep[]; firstPrompt?: string } | null = null
    const close = () => {
      if (!current || current.steps.length === 0) return
      const lastStep = current.steps[current.steps.length - 1]
      conversations.push({
        client,
        clientName,
        month: monthKey(new Date(current.startedAt)),
        name: conversationName(undefined, current.firstPrompt),
        startedAt: current.startedAt,
        lastActivityAt: lastStep.at,
        steps: current.steps,
      })
    }
    for (const job of [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const step = stepOf(job)
      if (typeof step === "string") {
        skip(step)
        continue
      }
      const at = Date.parse(job.created_at)
      if (!current || at - current.last > CONVERSATION_IDLE_GAP_MS || current.steps.length >= CONVERSATION_NODE_CAP) {
        close()
        current = { startedAt: job.created_at, last: at, steps: [], firstPrompt: step.spec.prompt }
      }
      current = { ...current, last: at, steps: [...current.steps, step] }
    }
    close()
  }
  return { conversations: conversations.sort((a, b) => a.startedAt.localeCompare(b.startedAt)), skipped }
}

/** The account's completed MCP jobs, oldest first (a page at a time). */
export async function loadHistoryJobs(userId: string): Promise<HistoryJob[]> {
  const all: HistoryJob[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, created_at, completed_at, source_detail, input_data, output_data")
      .eq("user_id", userId)
      .eq("source", "mcp")
      .eq("status", "completed")
      .is("parent_job_id", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Reading the MCP jobs failed: ${error.message}`)
    const page = (data ?? []) as HistoryJob[]
    all.push(...page)
    if (page.length < PAGE) return all
  }
}

/** The jobs already in one of the account's conversations (live or filed by an earlier run). */
export async function loadFiledJobIds(userId: string): Promise<Set<string>> {
  const filed = new Set<string>()
  const PAGE = 200
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("workflows")
      .select("nodes")
      .eq("user_id", userId)
      .not("settings->mcpConversation", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Reading the conversations failed: ${error.message}`)
    for (const row of (data ?? []) as Array<{ nodes: unknown }>) {
      for (const node of Array.isArray(row.nodes) ? (row.nodes as Array<{ data?: Record<string, unknown> }>) : []) {
        const jobId = (node.data?.mcpProvenance as { jobId?: unknown } | undefined)?.jobId
        if (typeof jobId === "string") filed.add(jobId)
      }
    }
    if ((data ?? []).length < PAGE) return filed
  }
}

/** Write the plan: one conversation row per planned conversation, its steps already holding their results. */
export async function applyHistory(userId: string, plan: HistoryPlan): Promise<{ readonly conversations: number; readonly steps: number }> {
  const projectId = await ensureMcpProject(newSession({ userId, scopes: [], clientName: "history" }))
  let steps = 0
  for (const conv of plan.conversations) {
    const hubId = await ensureMonthHub(userId, projectId, conv.month)
    const settings: McpConversationSettings = {
      client: conv.client,
      clientName: conv.clientName,
      key: null,
      startedAt: conv.startedAt,
      lastActivityAt: conv.lastActivityAt,
    }
    // The id is minted here so the steps' node ids can name it, and the
    // conversation lands in ONE insert: a failure leaves no empty row behind.
    const workflowId = randomUUID()
    let nodes: Record<string, unknown>[] = []
    let edges: Record<string, unknown>[] = []
    for (const step of conv.steps) {
      const nodeId = flowNodeId(workflowId, step.jobId.replace(/-/g, "").slice(0, 12))
      const result = { url: step.resultUrl, ...(step.thumbnailUrl ? { thumbnailUrl: step.thumbnailUrl } : {}), timestamp: step.at, jobId: step.jobId }
      const placed = placeFlowNode(nodes, nodeId, step.spec, {
        ...step.spec.data,
        executionStatus: "completed",
        [step.spec.outputKey]: step.resultUrl,
        generatedResults: [result],
        activeResultIndex: 0,
        mcpProvenance: { client: conv.client, clientName: conv.clientName, jobId: step.jobId, at: step.at, outputKey: step.spec.outputKey, imported: true },
      })
      const ids = new Set(placed.upsertNodes.map((n) => n.id))
      nodes = [...nodes.filter((n) => !ids.has(n.id as string)), ...placed.upsertNodes]
      edges = [...edges, ...placed.upsertEdges]
      steps += 1
    }
    const { error } = await supabase.from("workflows").insert({
      id: workflowId,
      project_id: projectId,
      user_id: userId,
      parent_workflow_id: hubId,
      name: conv.name,
      nodes,
      edges,
      settings: { mcpConversation: { ...settings, steps: conv.steps.length, imported: true } },
    })
    if (error) throw new Error(`Creating a conversation failed: ${error.message}`)
  }
  return { conversations: plan.conversations.length, steps }
}
