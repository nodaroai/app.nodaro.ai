/**
 * Workflow trigger sync — the graph is the single source of truth.
 *
 * `schedule-cron.ts` polls `workflow_triggers` rows; it never looks at the
 * workflow graph. Before this module nothing wrote those rows from a save, so
 * a Schedule Trigger node placed in the editor (or written by MCP / import /
 * the SDK) was decorative: the user configured a cron, saved, and nothing was
 * ever scheduled — silently. Same for Webhook Trigger, even though
 * `docs/api-integration.md` promises "Add a Webhook Trigger node. Save it.
 * Nodaro mints a token".
 *
 * So every graph write reconciles: trigger nodes in the graph are projected
 * onto rows, and a node that leaves the graph takes its row with it. Callers
 * run this AFTER the workflow row is persisted, and it never throws — a
 * failure here must not fail a save that already succeeded.
 *
 * Telegram Trigger is the third projected type, and the only one with a side
 * effect outside the table: a bot has to be TOLD where to deliver. That lives
 * in `telegram-trigger-activation.ts`; the rule here is that the row is never
 * written unless Telegram accepted the registration, so an active row always
 * means a bot that is really talking to us.
 *
 * Ownership: a row this module creates carries `config.nodeId`. Rows WITHOUT a
 * `nodeId` were created directly against `POST /v1/workflow-triggers` (curl, a
 * script, an integration) and are left strictly alone — reconciling them would
 * delete automation the user set up on purpose.
 */

import { randomBytes } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import {
  SCHEDULE_TRIGGER_NODE_TYPE,
  TELEGRAM_TRIGGER_NODE_TYPE,
  TELEGRAM_ACCOUNT_TRIGGER_NODE_TYPE,
  WEBHOOK_TRIGGER_NODE_TYPE,
  isCronExpression,
  isValidTimezone,
  legacyScheduleToRules,
  normalizeScheduleRules,
  type ScheduleRule,
} from "@nodaro/shared"
import { supabase } from "./supabase.js"
import { isMissingColumnError } from "./postgrest-errors.js"
import { getRuntimeEnv } from "./runtime-env.js"
import {
  ensureBotRegistration,
  syncBotRegistration,
  TelegramActivationError,
  type BotRegistration,
  type ReleasedUrl,
} from "./telegram-trigger-activation.js"

export { SCHEDULE_TRIGGER_NODE_TYPE, TELEGRAM_TRIGGER_NODE_TYPE, WEBHOOK_TRIGGER_NODE_TYPE, isCronExpression }

export type SyncedTriggerType = "schedule" | "webhook" | "telegram" | "telegram_account"

/** The row types this module owns. A row of any other type is nobody's here. */
const SYNCED_TRIGGER_TYPES: readonly SyncedTriggerType[] = ["schedule", "webhook", "telegram", "telegram_account"]

export interface GraphNode {
  readonly id?: unknown
  readonly type?: unknown
  readonly data?: unknown
}

export interface DesiredTrigger {
  readonly nodeId: string
  readonly type: SyncedTriggerType
  readonly config: Record<string, unknown>
  /**
   * Whether the row fires. A schedule is what its node's switch says
   * (`data.active === true`) — a new schedule starts PAUSED, saving is not
   * enough, and the graph decides on every save (the panel's switch, the
   * editor's top-bar button, or an API write of `active`). A webhook is
   * always armed: its token is minted on save and there is no switch for it
   * yet.
   */
  readonly isActive: boolean
  /**
   * The node is on the graph but cannot run (no usable rule, a timezone the
   * runtime cannot read): keep an EXISTING row — paused, its schedule keys
   * cleared, its `executionCount` and `owner_initiated` intact for the day
   * the node is fixed — and create none. Deleting it instead would restart
   * the run count and lose the owner's vouch when it came back.
   */
  readonly parked?: true
}

export interface ExistingTrigger {
  readonly id: string
  readonly type: string
  readonly config: Record<string, unknown> | null
  readonly is_active: boolean
  /** Telegram only: the url this row holds for its bot, if it is the one
   *  holding it. Read when the row leaves, so the url can be handed on. */
  readonly webhook_token?: string | null
}

export interface TriggerPlan {
  readonly create: readonly DesiredTrigger[]
  readonly update: ReadonlyArray<{ id: string; config: Record<string, unknown>; isActive: boolean }>
  readonly remove: readonly string[]
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * The schedule a `schedule-trigger` node is asking for, as the RULES the cron
 * evaluates (`config.rules` — the model the editor shares, `@nodaro/shared`
 * `schedule-rules`), or null when the node is not configured enough to
 * schedule (a half-filled node must not quietly start running).
 *
 * A node written before the rules model carries `interval` ("5m", or one of
 * the old panel's cron presets — `"0 * * * *"` stored under `interval`) and/or
 * a custom `cron` (`cronExpression` — the name the old panel used). Those
 * convert on the way through, so a row always holds rules and the legacy
 * keys never reach it to shadow them (`scheduleDue` reads `interval` before
 * `cron`, and a cron string under `interval` used to parse as 0 ms — a
 * schedule that never fired and said nothing). Rules present means rules: a
 * stale legacy key beside them is ignored.
 *
 * A timezone the runtime cannot read is a refusal, not a fallback — a
 * schedule that ran at UTC hours its owner never asked for is worse than one
 * that waits to be fixed.
 */
export function normalizeScheduleConfig(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const rules: ScheduleRule[] = Array.isArray(data.rules)
    ? normalizeScheduleRules(data.rules)
    : legacyScheduleToRules(data)
  if (rules.length === 0) return null

  const timezone = trimmed(data.timezone)
  if (timezone && !isValidTimezone(timezone)) return null

  const maxExecutions = data.maxExecutions
  return {
    rules,
    ...(timezone ? { timezone } : {}),
    ...(typeof maxExecutions === "number" && Number.isInteger(maxExecutions) && maxExecutions > 0
      ? { maxExecutions }
      : {}),
  }
}

/** What the inbound handler falls back to, and what the panel ships checked. */
export const DEFAULT_TELEGRAM_MESSAGE_TYPES = ["text", "photo", "video", "audio", "document"] as const

/**
 * The listener a `telegram-trigger` node is asking for, or null when it is
 * not asking for one. Two conditions, both deliberate:
 * - `connectionId` — WHICH bot. There is nothing to point at Telegram without it.
 * - `isActive === true` — the panel's Activate button. A trigger that started
 *   listening the moment a bot was picked would read the user's chats before
 *   they asked for it; off (the default) projects nothing, and projecting
 *   nothing is how a row is reconciled away. Deactivating IS removal here.
 *
 * Every filter is emitted, never omitted: `mergeTriggerConfig` keeps whatever
 * the desired config does not mention, so an omitted `chatIdFilter` would
 * leave a filter the user just cleared standing on the row.
 */
export function normalizeTelegramConfig(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const connectionId = trimmed(data.connectionId)
  if (!connectionId || data.isActive !== true) return null

  const filters = Array.isArray(data.messageTypeFilters)
    ? (data.messageTypeFilters as unknown[]).filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : []
  const chatIdFilter = trimmed(data.chatIdFilter)

  return {
    connectionId,
    chatIdFilter: chatIdFilter || null,
    // Empty means "every type" to the inbound handler either way; spelling the
    // default out keeps the row readable and matches the API lane.
    messageTypeFilters: filters.length > 0 ? filters : [...DEFAULT_TELEGRAM_MESSAGE_TYPES],
  }
}

/**
 * A Telegram ACCOUNT trigger's row config, or null when it must not listen.
 *
 * Same rule as the bot lane: nothing is projected until the node is switched on
 * (`isActive === true`) with an account picked — listening is reading the
 * owner's chats, so it starts only when they ask. Every filter is emitted,
 * never omitted (see normalizeTelegramConfig): an omitted key would keep a
 * filter the user just cleared standing on the row. Whether the account is
 * the owner's own is checked where the message arrives, not trusted from here.
 */
export function normalizeTelegramAccountConfig(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const accountId = trimmed(data.accountId)
  if (!accountId || data.isActive !== true) return null
  return {
    accountId,
    chatIds: stringList(data.chatIds),
    senderIds: stringList(data.senderIds),
    messageTypeFilters: stringList(data.messageTypeFilters),
    keywords: stringList(data.keywords),
    includeOutgoing: data.includeOutgoing === true,
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const items = value.filter((v): v is string => typeof v === "string").map((v) => v.trim())
  return [...new Set(items.filter((v) => v !== ""))]
}

/** Every trigger the graph asks for, in node order. */
export function desiredTriggersFromGraph(nodes: readonly GraphNode[] | undefined): DesiredTrigger[] {
  const desired: DesiredTrigger[] = []
  const seen = new Set<string>()
  for (const node of nodes ?? []) {
    const nodeId = trimmed(node?.id)
    const nodeType = trimmed(node?.type)
    if (!nodeId || seen.has(nodeId)) continue
    const data = (node?.data && typeof node.data === "object" ? node.data : {}) as Record<string, unknown>

    if (nodeType === SCHEDULE_TRIGGER_NODE_TYPE) {
      seen.add(nodeId)
      const config = normalizeScheduleConfig(data)
      desired.push(
        config
          ? { nodeId, type: "schedule", config, isActive: data.active === true }
          : { nodeId, type: "schedule", config: {}, isActive: false, parked: true },
      )
    } else if (nodeType === WEBHOOK_TRIGGER_NODE_TYPE) {
      seen.add(nodeId)
      desired.push({ nodeId, type: "webhook", config: {}, isActive: true })
    } else if (nodeType === TELEGRAM_TRIGGER_NODE_TYPE) {
      const config = normalizeTelegramConfig(data)
      if (config) {
        seen.add(nodeId)
        // Always armed once it is desired at all: normalizeTelegramConfig
        // returns null until the node's Activate button was pressed, so an
        // un-activated node never reaches this list and its row is released.
        desired.push({ nodeId, type: "telegram", config, isActive: true })
      }
    } else if (nodeType === TELEGRAM_ACCOUNT_TRIGGER_NODE_TYPE) {
      const config = normalizeTelegramAccountConfig(data)
      if (config) {
        seen.add(nodeId)
        // Armed once desired, like the bot lane; nothing to register outside.
        desired.push({ nodeId, type: "telegram_account", config, isActive: true })
      }
    }
  }
  return desired
}

/**
 * Every key that describes the schedule. Runtime state the cron writes back
 * onto `config` (`executionCount`) is everything else, and a re-save must not
 * clobber it.
 */
const SCHEDULE_CONFIG_KEYS = ["rules", "cron", "interval", "timezone", "maxExecutions"] as const

/**
 * Desired config merged onto the stored one: runtime state (`executionCount`)
 * survives, and EVERY schedule key is dropped first so a row written before
 * the rules model cannot keep its `interval` / `cron` beside the new rules,
 * and a switch of timezone cannot leave the old one behind.
 */
export function mergeTriggerConfig(
  existing: Record<string, unknown> | null,
  desired: Record<string, unknown>,
  nodeId: string,
): Record<string, unknown> {
  const preserved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(existing ?? {})) {
    if ((SCHEDULE_CONFIG_KEYS as readonly string[]).includes(key)) continue
    preserved[key] = value
  }
  return { ...preserved, ...desired, nodeId }
}

/**
 * A change the row cannot absorb in place. A Telegram row IS a registration at
 * one bot, so re-pointing the node at another bot is a new registration plus an
 * old one to take down — replace the row rather than edit it, and the create
 * and remove paths do both halves for free. An INACTIVE Telegram row is
 * replaced too: deactivation gives its url up (the API lane clears the token,
 * and may have taken the bot's webhook down with it), and only the create
 * path registers one — flipping `is_active` back would leave a trigger that
 * is active on paper and reachable by nothing. A PARKED schedule row is the
 * opposite case and never comes here: it is kept, paused, on purpose.
 */
function requiresReplacement(
  type: SyncedTriggerType,
  row: ExistingTrigger,
  desired: Record<string, unknown>,
): boolean {
  if (type !== "telegram") return false
  if (!row.is_active) return true
  return trimmed((row.config ?? {}).connectionId) !== trimmed(desired.connectionId)
}

/**
 * `PATCH /v1/workflow-triggers/:id` config semantics: the submitted keys land
 * ON TOP of the stored config — a PATCH of the timezone alone keeps the
 * rules — and the row's `nodeId` (its link to the node that manages it) and
 * `executionCount` (the cron's own count) are never the caller's to change.
 * One family of schedule keys at a time: submitting `rules` drops a stored
 * `interval` / `cron`; submitting either of those without rules drops stored
 * `rules` — whichever the caller just said is what runs, never a stale key
 * shadowing it.
 */
export function applyTriggerConfigPatch(
  existing: Record<string, unknown> | null,
  submitted: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(existing ?? {}) }
  if (submitted.rules !== undefined) {
    delete base.interval
    delete base.cron
  } else if (submitted.interval !== undefined || submitted.cron !== undefined) {
    delete base.rules
  }
  const merged: Record<string, unknown> = { ...base, ...submitted }
  if (existing && typeof existing.nodeId === "string") merged.nodeId = existing.nodeId
  else delete merged.nodeId
  if (existing && existing.executionCount !== undefined) merged.executionCount = existing.executionCount
  else delete merged.executionCount
  return merged
}

/** Pure diff: what to create, update and delete. Rows without `nodeId` are not ours. */
export function planTriggerSync(
  desired: readonly DesiredTrigger[],
  existing: readonly ExistingTrigger[],
): TriggerPlan {
  const owned = new Map<string, ExistingTrigger>()
  for (const row of existing) {
    const nodeId = trimmed((row.config ?? {}).nodeId)
    if (!nodeId) continue
    // A duplicate key can only come from hand-edited rows; keep the first and
    // let the rest be removed so the graph stays authoritative.
    if (!owned.has(`${row.type}:${nodeId}`)) owned.set(`${row.type}:${nodeId}`, row)
  }

  const create: DesiredTrigger[] = []
  const update: Array<{ id: string; config: Record<string, unknown>; isActive: boolean }> = []
  const remove: string[] = []
  const matched = new Set<string>()

  for (const want of desired) {
    const key = `${want.type}:${want.nodeId}`
    const row = owned.get(key)
    if (!row) {
      if (!want.parked) create.push(want)
      continue
    }
    matched.add(key)
    if (requiresReplacement(want.type, row, want.config)) {
      remove.push(row.id)
      create.push(want)
      continue
    }
    const config = mergeTriggerConfig(row.config, want.config, want.nodeId)
    // The graph decides whether the row fires: a switch flipped in the editor
    // reaches the row here, a row paused or resumed through the API is
    // brought back to what the node says on the next save, and a node that
    // cannot run keeps its row paused whatever its switch says.
    const wantActive = want.parked ? false : want.isActive
    if (!isDeepStrictEqual(config, row.config) || row.is_active !== wantActive) {
      update.push({ id: row.id, config, isActive: wantActive })
    }
  }

  for (const [key, row] of owned) {
    if (!matched.has(key)) remove.push(row.id)
  }
  // A duplicate owned row never entered the map, so sweep it too.
  const keptIds = new Set([...owned.values()].map((r) => r.id))
  for (const row of existing) {
    if (keptIds.has(row.id)) continue
    if (!trimmed((row.config ?? {}).nodeId)) continue
    remove.push(row.id)
  }

  return { create, update, remove }
}

export interface ReconcileResult {
  readonly created: number
  readonly updated: number
  readonly removed: number
  /** What went wrong, for the caller's log. Internal — never shown to a user. */
  readonly error?: string
  /**
   * The one failure a USER can act on — a Telegram bot that could not be
   * registered — in the words `TelegramActivationError` chose for them
   * (reconnect the bot, set `PUBLIC_URL`, fix the address Telegram refused).
   * Anything else stays in `error`.
   */
  readonly reason?: string
}

const EMPTY: ReconcileResult = { created: 0, updated: 0, removed: 0 }

/** Shown when a Telegram registration failed for a reason that is ours, not the user's. */
const GENERIC_TELEGRAM_REASON = "A Telegram bot could not be registered"

/**
 * Bots a reconcile touched, with the urls their removed rows held. Settled ONCE
 * at the end, from the rows that remain — so a create, an edit and a removal
 * on the same bot cannot race each other into a half-published state.
 */
type TouchedBots = Map<string, ReleasedUrl[]>

function noteBot(touched: TouchedBots, connectionId: string, released?: ReleasedUrl): void {
  if (!connectionId) return
  const prior = touched.get(connectionId) ?? []
  touched.set(connectionId, released ? [...prior, released] : prior)
}

interface TelegramCreates {
  readonly creatable: readonly DesiredTrigger[]
  readonly registrations: ReadonlyMap<string, BotRegistration>
  readonly error?: string
  readonly reason?: string
}

/**
 * Register every Telegram create at its bot BEFORE any row is written. A bot
 * that could not be registered gets NO row — a listening trigger nothing
 * delivers to is exactly the silent decoration this module exists to end —
 * and the other creates in the same save still go through.
 */
async function registerTelegramCreates(
  userId: string,
  creates: readonly DesiredTrigger[],
  touched: TouchedBots,
): Promise<TelegramCreates> {
  const registrations = new Map<string, BotRegistration>()
  const creatable: DesiredTrigger[] = []
  let error: string | undefined
  let reason: string | undefined
  for (const want of creates) {
    if (want.type !== "telegram") {
      creatable.push(want)
      continue
    }
    const connectionId = trimmed(want.config.connectionId)
    try {
      registrations.set(want.nodeId, await ensureBotRegistration({ userId, connectionId }))
      creatable.push(want)
      noteBot(touched, connectionId)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      // Only OUR words reach the user; a database or network message is an
      // internal detail that would leak and could not be acted on anyway.
      reason = err instanceof TelegramActivationError ? err.message : GENERIC_TELEGRAM_REASON
    }
  }
  return { creatable, registrations, error, reason }
}

interface TriggerRowInsert {
  readonly workflow_id: string
  readonly user_id: string
  readonly type: SyncedTriggerType
  readonly config: Record<string, unknown>
  readonly webhook_token: string | null
  readonly is_active: boolean
}

function buildTriggerRow(
  workflowId: string,
  userId: string,
  want: DesiredTrigger,
  registration: BotRegistration | undefined,
): TriggerRowInsert {
  return {
    workflow_id: workflowId,
    user_id: userId,
    type: want.type,
    config: registration
      ? { ...want.config, nodeId: want.nodeId, secretToken: registration.secretToken }
      : { ...want.config, nodeId: want.nodeId },
    // The token IS the auth for a webhook, so it is minted once here and then
    // left alone by every later save. A Telegram row carries one only when it
    // is the row holding its bot's url; a second trigger on the same bot rides
    // that url and stores none.
    webhook_token: want.type === "webhook"
      ? randomBytes(32).toString("hex")
      : registration?.webhookToken ?? null,
    // What the graph decided (see DesiredTrigger.isActive): a schedule
    // starts paused until its switch is on; webhook and telegram are armed.
    is_active: want.isActive,
  }
}

/**
 * `owner_initiated` rides only on the rows the caller vouched for, and only on
 * the wire when true — the default is already false, so a database that does
 * not have the column yet (migration 436 not landed) only ever sees it on a
 * "yes"; that write is retried without it. Two inserts because PostgREST wants
 * one key set per batch.
 *
 * A Telegram row is never vouched: the flag means "this run carries no
 * external input", and every one of these runs is a message somebody else sent.
 *
 * Returns the failing insert's message, or undefined when every row landed.
 */
async function insertTriggerRows(
  rows: readonly TriggerRowInsert[],
  vouched: ReadonlySet<string>,
): Promise<string | undefined> {
  // A message lane is started by whoever writes to the chat, never by the owner — never vouched.
  const isVouched = (r: TriggerRowInsert): boolean =>
    r.type !== "telegram" && r.type !== "telegram_account" && vouched.has(String(r.config.nodeId))
  const vouchedRows = rows.filter(isVouched)
  const plainRows = rows.filter((r) => !isVouched(r))

  if (plainRows.length > 0) {
    const { error } = await supabase.from("workflow_triggers").insert(plainRows)
    if (error) return error.message
  }
  if (vouchedRows.length > 0) {
    let { error } = await supabase
      .from("workflow_triggers")
      .insert(vouchedRows.map((r) => ({ ...r, owner_initiated: true })))
    if (error && isMissingColumnError(error)) {
      ;({ error } = await supabase.from("workflow_triggers").insert(vouchedRows))
    }
    if (error) return error.message
  }
  return undefined
}

/** The urls the removed Telegram rows held — read BEFORE they go, because a
 *  bot's url outlives the row that held it whenever another trigger remains. */
function collectTelegramReleases(
  removeIds: readonly string[],
  byId: ReadonlyMap<string, ExistingTrigger>,
  touched: TouchedBots,
): void {
  for (const id of removeIds) {
    const row = byId.get(id)
    if (row?.type !== "telegram") continue
    const cfg = row.config ?? {}
    noteBot(
      touched,
      trimmed(cfg.connectionId),
      row.webhook_token ? { token: row.webhook_token, secret: trimmed(cfg.secretToken) } : undefined,
    )
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The account ids among the graph's Telegram ACCOUNT triggers that are the
 * owner's own connected accounts in this environment (the generic
 * `plugin_account_secrets` store), or null when that cannot be read — the
 * caller then leaves the lane untouched rather than guess.
 */
async function ownedAccountIds(desired: readonly DesiredTrigger[], userId: string): Promise<Set<string> | null> {
  const wanted = [
    ...new Set(desired.filter((t) => t.type === "telegram_account").map((t) => String(t.config.accountId))),
  ].filter((id) => UUID.test(id))
  if (wanted.length === 0) return new Set()
  const { data, error } = await supabase
    .from("plugin_account_secrets")
    .select("id")
    .in("id", wanted)
    .eq("user_id", userId)
    .eq("runtime_env", getRuntimeEnv())
  if (error) return null
  return new Set((data ?? []).map((row: { id: string }) => row.id))
}

/**
 * Project the graph's trigger nodes onto `workflow_triggers`. Call AFTER the
 * workflow row is written. Never throws: the save has already happened, and a
 * trigger-sync failure must not turn a successful save into a 500.
 */
export async function reconcileWorkflowTriggers(params: {
  readonly workflowId: string
  readonly userId: string
  readonly nodes: readonly GraphNode[] | undefined
  /**
   * Node ids the OWNER, in their own browser session, ADDED in the save this
   * projection follows — the editor's sync after its save names them. A row
   * CREATED for one of them is stamped `owner_initiated` (plan D3, migration
   * 436); every other created row, and every existing row, keeps the default.
   * Narrow on purpose: a node that was already in the stored graph may have
   * been written by an API token or an OAuth app AS the owner, and the
   * owner's next autosave must not launder that into a vouched schedule.
   */
  readonly vouchNodeIds?: ReadonlyArray<string>
  /**
   * The save was made by the workflow's OWNER. Only such a save may create,
   * change or remove a Telegram ACCOUNT trigger — the lane reads the owner's
   * own messages, so an editor saving a shared workflow must never arm, widen
   * or re-point it (rows are always written under the owner, whoever saved).
   * Absent or false: rows of that lane are left exactly as stored.
   */
  readonly ownerActing?: boolean
}): Promise<ReconcileResult> {
  const { workflowId, userId, nodes } = params
  const vouched = new Set(params.vouchNodeIds ?? [])
  try {
    const accountLane = params.ownerActing === true ? await ownedAccountIds(desiredTriggersFromGraph(nodes), userId) : null
    // Not the owner, or the ownership read failed: the account lane is out of this save's reach.
    const desired = desiredTriggersFromGraph(nodes).filter(
      (t) => t.type !== "telegram_account" || (accountLane !== null && accountLane.has(String(t.config.accountId))),
    )

    const { data: rows, error: listError } = await supabase
      .from("workflow_triggers")
      .select("id, type, config, is_active, webhook_token")
      .eq("workflow_id", workflowId)
      .eq("user_id", userId)
      .in("type", SYNCED_TRIGGER_TYPES)

    if (listError) return { ...EMPTY, error: listError.message }

    const existing = ((rows ?? []) as ExistingTrigger[]).filter((r) => r.type !== "telegram_account" || accountLane !== null)
    // Nothing on either side: the overwhelmingly common save. No writes.
    if (desired.length === 0 && existing.length === 0) return EMPTY

    const plan = planTriggerSync(desired, existing)
    const byId = new Map(existing.map((r) => [r.id, r] as const))
    const touched: TouchedBots = new Map()

    const creates = await registerTelegramCreates(userId, plan.create, touched)
    const inserted = creates.creatable.map((want) =>
      buildTriggerRow(workflowId, userId, want, creates.registrations.get(want.nodeId)),
    )
    const insertError = await insertTriggerRows(inserted, vouched)
    if (insertError) return { ...EMPTY, error: insertError }

    for (const row of plan.update) {
      const { error } = await supabase
        .from("workflow_triggers")
        .update({ config: row.config, is_active: row.isActive })
        .eq("id", row.id)
        .eq("user_id", userId)
      if (error) return { ...EMPTY, error: error.message }
      if (byId.get(row.id)?.type === "telegram") noteBot(touched, trimmed(row.config.connectionId))
    }

    if (plan.remove.length > 0) {
      collectTelegramReleases(plan.remove, byId, touched)
      const { error } = await supabase
        .from("workflow_triggers")
        .delete()
        .in("id", plan.remove)
        .eq("user_id", userId)
      if (error) return { ...EMPTY, error: error.message }
    }

    for (const [connectionId, releasedUrls] of touched) {
      await syncBotRegistration({ userId, connectionId, releasedUrls })
    }

    return {
      created: inserted.length,
      updated: plan.update.length,
      removed: plan.remove.length,
      ...(creates.error ? { error: creates.error } : {}),
      ...(creates.reason ? { reason: creates.reason } : {}),
    }
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : String(err) }
  }
}
