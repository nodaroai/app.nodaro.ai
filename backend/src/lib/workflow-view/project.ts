/**
 * The PUBLIC projection of a workflow: what a view link shows to anyone who
 * holds it (decided 2026-11-23). ONE function feeds all three things a view
 * link hands out, so none can say more than another: the canvas the page
 * draws (`GET /v1/workflow-views/:token`), the preview card's picture
 * (card.ts) and the frozen downloadable copy (export-snapshot.ts).
 *
 * A view link shows the whole canvas, to people who are not signed in, and
 * search engines may index it, so it starts from what a presentation link's
 * viewer is shown (routes/presentation.ts, the non-owner branch) and takes
 * away more:
 *  - a hidden node (a sub-workflow's run leftovers) and the edges that touch it;
 *  - the references only the owner can use (`stripUnownedRefs`: a webhook's
 *    stored credential, a connected account and its chats);
 *  - every node that sends or fetches somewhere (`DENIED_NODE_TYPES`: a
 *    webhook output, the social publishers, the outbound fetchers) keeps its
 *    name only — its address, its headers and its account are the owner's;
 *  - a Webhook Trigger's address and token: the token is the credential that
 *    runs the workflow on the owner's credits;
 *  - any value under a key that names a secret, at any depth;
 *  - any address of restricted bytes (`isRestrictedAddress`, the share links'
 *    rule): an object's value becomes null, an array drops it.
 * The workflow's `settings` are never shown; the copy carries them through
 * the same scrub.
 *
 * The owner sees exactly what the public sees: nothing here branches on who
 * asks.
 */
import { stripStudioDraftWorkflow, stripStudioTakeVoiceRecords } from "@nodaro/shared/pipeline"
import { stripUnownedRefs } from "@nodaro/shared/workflow"
import { resolveCanvasResultIds } from "../canvas-result-ids.js"
import { ugcPublishedGraph } from "../ugc-composed-graph.js"
import { savedNodesProviderWords } from "../provider-words.js"
import { DENIED_NODE_TYPES } from "../outbound-node-lock.js"
import { isRestrictedAddress } from "../share-links/job-reads.js"
import { hiddenResultUrls } from "./private-results.js"

export interface ViewNode {
  readonly id: string
  readonly type?: string
  readonly hidden?: boolean
  readonly data?: Record<string, unknown>
  readonly [key: string]: unknown
}

export interface ViewEdge {
  readonly source?: unknown
  readonly target?: unknown
  readonly [key: string]: unknown
}

export interface WorkflowViewSource {
  readonly nodes: unknown
  readonly edges: unknown
  readonly settings: unknown
  /** The workflow's creator: whose saved results the canvas names. */
  readonly ownerId: string
}

export interface WorkflowViewProjection {
  readonly nodes: ViewNode[]
  readonly edges: ViewEdge[]
  /** The settings a public copy carries (never sent with the canvas). */
  readonly settings: Record<string, unknown>
}

/** What a sending or fetching node keeps: its name and its notes, nothing it would send or fetch with. */
const OUTBOUND_KEPT_KEYS: ReadonlySet<string> = new Set(["label", "title", "description", "notes"])

/**
 * Fields a node type keeps for its owner alone (review round, decided
 * 2026-11-23), beyond `stripUnownedRefs`'s references:
 *  - a Webhook Trigger's address and token (the credential that runs the workflow);
 *  - a Telegram bot trigger's connection, its private chat filter and its trigger id;
 *  - a Suno voice's recordings, its verification and the persona made from them.
 */
const PRIVATE_FIELDS_BY_TYPE: Readonly<Record<string, ReadonlySet<string>>> = {
  "webhook-trigger": new Set(["webhookToken", "webhookUrl", "token", "secret"]),
  "telegram-trigger": new Set(["connectionId", "chatIdFilter", "triggerId"]),
  "suno-voice": new Set(["sourceAudioUrl", "verifyAudioUrl", "validateInfo", "voiceId"]),
}

/**
 * Keys dropped at ANY depth, on every node and in the settings:
 *  - a cloned voice's recordings and the consent signed for them (`replica`,
 *    `replicaConsent`: a real person's voice, their consent recording, and the
 *    owner's id) — a published app's runner gives their own;
 *  - an outbound request's headers;
 *  - the provider's words on a failure, the assistant request a node was made
 *    from, and run-time state (a job in flight, a list's progress).
 */
const PRIVATE_KEYS: ReadonlySet<string> = new Set([
  "replica",
  "replicaConsent",
  "consentAudioUrl",
  "headers",
  "errorDetail",
  "mcpProvenance",
  "currentJobId",
  "currentJobProgress",
])

/**
 * A key that names a secret: matched anywhere in the key, so it also drops a
 * few harmless keys (`cookieBanner`) — the safe side. Never a bare `token`, so
 * a model's `maxTokens` or a `tokenCount` stays.
 */
const SECRET_KEY_RE = /(secret|password|passwd|api[-_]?key|private[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|webhook[-_]?token|share[-_]?token|bearer|authorization|cookie|credential|signature|jwt)/i

/** A key the public never sees. Run-time keys (`__listTotal`, …) start with two underscores. */
function privateKey(key: string): boolean {
  return PRIVATE_KEYS.has(key) || key.startsWith("__") || SECRET_KEY_RE.test(key)
}

/** A run address of a webhook trigger, wherever it was copied into a node (a note, a prompt). */
const WEBHOOK_ADDRESS_RE = /\/v1\/webhooks\/[A-Za-z0-9_-]{16,}/

/** How deep the scrub walks (node data is a few levels deep; a deeper value is dropped, never shown unread). */
const MAX_DEPTH = 24

/** The settings a public copy keeps: what the canvas's nodes read. Everything else is the owner's (assistant conversations, Studio drafts, app setup). */
const PUBLIC_SETTINGS_KEYS: readonly string[] = ["characterDefinitions", "flowPromptTemplates", "viewport"]

const NO_HIDDEN: ReadonlySet<string> = new Set()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A string the public may not see: a webhook's run address, a restricted file, or a result a share link would refuse. */
function hiddenString(value: string, hidden: ReadonlySet<string>): boolean {
  if (WEBHOOK_ADDRESS_RE.test(value)) return true
  if (!/^https?:\/\//i.test(value)) return false
  return hidden.has(value) || isRestrictedAddress(value)
}

const DROP = Symbol("drop")

/** The scrubbed copy of `value`: private keys dropped, hidden strings nulled (dropped in an array). Never mutates. */
function scrubValue(value: unknown, depth: number, hidden: ReadonlySet<string>): unknown {
  if (typeof value === "string") return hiddenString(value, hidden) ? null : value
  if (depth > MAX_DEPTH) return DROP
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      // A list entry that IS a hidden file (a result whose `url` may not be shown) goes whole.
      if (isRecord(item) && typeof item.url === "string" && hiddenString(item.url, hidden)) return []
      const scrubbed = scrubValue(item, depth + 1, hidden)
      return scrubbed === DROP || (typeof item === "string" && scrubbed === null) ? [] : [scrubbed]
    })
  }
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    if (privateKey(key)) continue
    const scrubbed = scrubValue(inner, depth + 1, hidden)
    if (scrubbed !== DROP) out[key] = scrubbed
  }
  return out
}

/** The public copy of any value (a node's data, a workflow's settings). `hidden`: result addresses that may not be shown. */
export function scrubPublicValue<T>(value: T, hidden: ReadonlySet<string> = NO_HIDDEN): T {
  const scrubbed = scrubValue(value, 0, hidden)
  return (scrubbed === DROP ? null : scrubbed) as T
}

/** The settings a public copy carries: the keys the canvas's nodes read, scrubbed. */
export function publicSettings(settings: unknown, hidden: ReadonlySet<string> = NO_HIDDEN): Record<string, unknown> {
  if (!isRecord(settings)) return {}
  const kept = Object.fromEntries(PUBLIC_SETTINGS_KEYS.filter((key) => key in settings).map((key) => [key, settings[key]]))
  return scrubPublicValue(kept, hidden)
}

/** One node's data as the public sees it. */
function publicNodeData(type: string | undefined, data: Record<string, unknown>, hidden: ReadonlySet<string>): Record<string, unknown> {
  if (type && DENIED_NODE_TYPES.has(type)) {
    const named = Object.fromEntries(Object.entries(data).filter(([key, value]) => OUTBOUND_KEPT_KEYS.has(key) && typeof value === "string"))
    return scrubPublicValue(named, hidden)
  }
  const privateFields = type ? PRIVATE_FIELDS_BY_TYPE[type] : undefined
  const kept = privateFields ? Object.fromEntries(Object.entries(data).filter(([key]) => !privateFields.has(key))) : data
  const scrubbed = scrubPublicValue(kept, hidden)
  // A result dropped from the list leaves the active index pointing past it: show the first one left.
  const results = scrubbed.generatedResults
  const active = scrubbed.activeResultIndex
  if (Array.isArray(results) && typeof active === "number" && active >= results.length) {
    return { ...scrubbed, activeResultIndex: results.length > 0 ? 0 : -1 }
  }
  return scrubbed
}

function asNodes(value: unknown): ViewNode[] {
  return Array.isArray(value) ? value.filter((n): n is ViewNode => isRecord(n) && typeof n.id === "string") : []
}

/** The public nodes of already-resolved node rows (pure: the owner-scoped reads happen in `projectWorkflowView`). */
export function publicViewNodes(nodes: readonly ViewNode[], hidden: ReadonlySet<string> = NO_HIDDEN): ViewNode[] {
  const visible = nodes.filter((n) => !n.hidden)
  const unowned = stripUnownedRefs(visible as unknown as Parameters<typeof stripUnownedRefs>[0]) as unknown as ViewNode[]
  return unowned.map((node) => {
    const { data, ...rest } = node
    // The node's own fields (position, size, style) through the same scrub; its data by its type's rules.
    return { ...scrubPublicValue(rest, hidden), id: node.id, data: publicNodeData(node.type, isRecord(data) ? data : {}, hidden) } as ViewNode
  })
}

/** The edges between shown nodes, scrubbed like the nodes (a label or a style is all an edge carries). */
export function publicViewEdges(edges: unknown, nodes: readonly ViewNode[]): ViewEdge[] {
  if (!Array.isArray(edges)) return []
  const ids = new Set(nodes.map((n) => n.id))
  return edges
    .filter((e): e is ViewEdge => isRecord(e) && typeof e.source === "string" && typeof e.target === "string" && ids.has(e.source) && ids.has(e.target))
    .map((edge) => scrubPublicValue(edge))
}

/**
 * The canvas a view link shows. Reads the owner's saved results (to label
 * them as the editor does) and the UGC graph (whose photo and renders never
 * leave the owner), then applies the public rules above.
 */
export async function projectWorkflowView(source: WorkflowViewSource): Promise<WorkflowViewProjection> {
  // What a `view` collaborator is never shown first (Studio drafts, a take's voice record): "the ONE strip every view door applies".
  const draftless = stripStudioDraftWorkflow({ nodes: source.nodes, settings: source.settings })
  const settings = isRecord(draftless.settings) ? draftless.settings : null
  const resolved = asNodes(await resolveCanvasResultIds(draftless.nodes, source.ownerId, { settings }))
  const edgeList = Array.isArray(source.edges) ? (source.edges as ViewEdge[]) : []
  const ugc = await ugcPublishedGraph(resolved, edgeList as never, source.ownerId, { settings })
  const voiceless = stripStudioTakeVoiceRecords(ugc.nodes as never) as unknown as ViewNode[]
  const withoutProviderWords = savedNodesProviderWords(voiceless, { isAdmin: false, canRead: false })
  const hidden = await hiddenResultUrls(withoutProviderWords, source.ownerId)
  const nodes = publicViewNodes(withoutProviderWords, hidden)
  // The settings as the funnel hands them on: a character definition drawn on the UGC photo's path is emptied there.
  return { nodes, edges: publicViewEdges(source.edges, nodes), settings: publicSettings(ugc.settings ?? settings, hidden) }
}
