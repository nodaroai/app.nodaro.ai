/**
 * The generic account-secret store behind `tk.accountSecrets` (migration 440,
 * `plugin_account_secrets`): for a private plugin that keeps a long-lived
 * account credential on a user's behalf — a session, not a key the user can
 * rotate on a settings page.
 *
 * Posture is `http_credentials`' (migration 435): RLS on, no policies, no
 * API-role privileges, so not even the ciphertext can be read through
 * PostgREST. Every access goes through this module, and every call is scoped
 * to two things the caller cannot opt out of:
 *   - the plugin it names, and
 *   - THIS process's runtime environment (`getRuntimeEnv()`, never an
 *     argument). Staging and production share one database; an account row is
 *     a live session, and two installs opening the same one get it killed by
 *     the provider. Each environment therefore sees only its own rows.
 *
 * Two surfaces:
 *   - list / get / update / delete — metadata only, every process. No query
 *     here selects the ciphertext.
 *   - upsert / open — the only encrypt and decrypt sites. `buildToolkit()`
 *     wires them ONLY into the daemon host's toolkit, so a secret is never
 *     decrypted outside the process that holds the session.
 */
import { z } from "zod"
import { supabase } from "./supabase.js"
import { boundCipher, EncryptionKeyMissingError } from "./instance-cipher.js"
import { getRuntimeEnv } from "./runtime-env.js"
import type {
  PluginAccountOwnerScope,
  PluginAccountSecretRow,
  PluginAccountSecretUpdate,
  PluginAccountSecretUpsert,
} from "./private-plugins/daemon-contract.js"

const TABLE = "plugin_account_secrets"
const ROW_COLUMNS =
  "id, plugin, kind, user_id, external_id, label, status, status_reason, metadata, created_at, updated_at"
/** Must match the unique index of migration 440 column for column. */
const IDENTITY_CONFLICT = "plugin,kind,runtime_env,user_id,external_id"
const MAX_JSON_BYTES = 16 * 1024

// ---------------------------------------------------------------------------
// Validation — input is refused before any query; values never reach errors.
// ---------------------------------------------------------------------------

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "must be lowercase letters, digits and dashes")
const statusSchema = z.string().regex(/^[a-z][a-z_]{0,31}$/, "must be lowercase letters and underscores")
const uuidSchema = z.string().uuid()

function withinJsonBudget(value: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_JSON_BYTES
}

const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine(withinJsonBudget, `must serialize to at most ${MAX_JSON_BYTES} bytes`)

const secretSchema = z
  .record(z.string(), z.string())
  .refine((secret) => Object.keys(secret).length > 0, "must not be empty")
  .refine(withinJsonBudget, `must serialize to at most ${MAX_JSON_BYTES} bytes`)

const labelSchema = z.string().max(200).nullable()

const upsertSchema = z.object({
  plugin: slugSchema,
  kind: slugSchema,
  userId: uuidSchema,
  externalId: z.string().min(1).max(200),
  label: labelSchema.optional(),
  secret: secretSchema,
  metadata: metadataSchema.optional(),
  status: statusSchema.optional(),
})

/**
 * Every metadata call states whose rows it may reach: `userId` (the ownership
 * check a route acting for a user makes) XOR `allOwners: true` (the daemon, or
 * an admin surface). Neither — a forgotten owner — throws rather than quietly
 * widening to every user's accounts.
 */
const ownerScopeFields = {
  userId: uuidSchema.optional(),
  allOwners: z.boolean().optional(),
}

function statesOneOwnerScope(v: { userId?: string; allOwners?: boolean }): boolean {
  return (v.userId !== undefined) !== (v.allOwners === true)
}

const OWNER_SCOPE_MESSAGE = "must state its owner scope: userId, or allOwners: true (not both)"

const updateSchema = z
  .object({
    plugin: slugSchema,
    id: uuidSchema,
    ...ownerScopeFields,
    status: statusSchema.optional(),
    statusReason: z.string().max(500).nullable().optional(),
    label: labelSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .refine(statesOneOwnerScope, OWNER_SCOPE_MESSAGE)

const listSchema = z
  .object({
    plugin: slugSchema,
    kind: slugSchema.optional(),
    ...ownerScopeFields,
    statuses: z.array(statusSchema).max(20).optional(),
  })
  .refine(statesOneOwnerScope, OWNER_SCOPE_MESSAGE)

const byIdSchema = z
  .object({
    plugin: slugSchema,
    id: uuidSchema,
    ...ownerScopeFields,
  })
  .refine(statesOneOwnerScope, OWNER_SCOPE_MESSAGE)

const openSchema = z.object({ plugin: slugSchema, id: uuidSchema })

const rowSchema = z.object({
  id: z.string(),
  plugin: z.string(),
  kind: z.string(),
  user_id: z.string(),
  external_id: z.string(),
  label: z.string().nullable(),
  status: z.string(),
  status_reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")
    throw new Error(`invalid account-secret input: ${issues}`)
  }
  return parsed.data
}

// ---------------------------------------------------------------------------
// The envelope — bound to its environment and its row.
// ---------------------------------------------------------------------------

/**
 * One subkey per environment (HKDF from the instance key): staging and
 * production share this database and, often, the instance key — the subkey is
 * what stops one environment's code from opening the other's sessions. `v1`
 * names the scheme; a different scheme gets a different purpose string.
 */
function envelopeCipher(runtimeEnv: string) {
  return boundCipher(`plugin_account_secrets:v1:${runtimeEnv}`)
}

/**
 * The row identity each envelope is bound to (its GCM associated data) — the
 * migration's unique key, column for column. A ciphertext copied onto another
 * row (another owner, another account) no longer authenticates.
 */
function envelopeAad(identity: {
  plugin: string
  kind: string
  runtimeEnv: string
  userId: string
  externalId: string
}): string {
  return JSON.stringify([identity.plugin, identity.kind, identity.runtimeEnv, identity.userId, identity.externalId])
}

function toRow(raw: unknown): PluginAccountSecretRow {
  return fromParsedRow(rowSchema.parse(raw))
}

function fromParsedRow(row: z.infer<typeof rowSchema>): PluginAccountSecretRow {
  return {
    id: row.id,
    plugin: row.plugin,
    kind: row.kind,
    userId: row.user_id,
    externalId: row.external_id,
    label: row.label,
    status: row.status,
    statusReason: row.status_reason,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------------------------------------------------------------------
// Metadata surface — every process.
// ---------------------------------------------------------------------------

/**
 * This plugin's rows in this environment under the stated owner scope, oldest
 * first; `kind` / `statuses` narrow further. A row that no longer parses is
 * skipped rather than failing the whole list — the daemon boots from this
 * read, and one bad row must not take every other account down. `get` and
 * `open` still refuse such a row, so it cannot be USED either.
 */
export async function listAccountSecrets(
  query: PluginAccountOwnerScope & { plugin: string; kind?: string; statuses?: readonly string[] },
): Promise<PluginAccountSecretRow[]> {
  const q = parseInput(listSchema, query)
  if (q.statuses && q.statuses.length === 0) return []

  let request = supabase.from(TABLE).select(ROW_COLUMNS).eq("plugin", q.plugin).eq("runtime_env", getRuntimeEnv())
  if (q.kind) request = request.eq("kind", q.kind)
  if (q.userId) request = request.eq("user_id", q.userId)
  if (q.statuses) request = request.in("status", q.statuses)

  const { data, error } = await request.order("created_at", { ascending: true })
  if (error) throw new Error(`Failed to list account secrets: ${error.message}`)
  return (data ?? []).flatMap((raw) => {
    const parsed = rowSchema.safeParse(raw)
    return parsed.success ? [fromParsedRow(parsed.data)] : []
  })
}

/** One row of this plugin in this environment, or null — including someone else's row under a `userId` scope. */
export async function getAccountSecret(
  query: PluginAccountOwnerScope & { plugin: string; id: string },
): Promise<PluginAccountSecretRow | null> {
  const q = parseInput(byIdSchema, query)
  let request = supabase.from(TABLE).select(ROW_COLUMNS).eq("id", q.id).eq("plugin", q.plugin).eq("runtime_env", getRuntimeEnv())
  if (q.userId) request = request.eq("user_id", q.userId)

  const { data, error } = await request.maybeSingle()
  if (error) throw new Error(`Failed to load account secret: ${error.message}`)
  return data ? toRow(data) : null
}

/** True when a row changed under the stated owner scope. The ciphertext is never part of the patch. */
export async function updateAccountSecret(input: PluginAccountSecretUpdate): Promise<boolean> {
  const u = parseInput(updateSchema, input)
  const patch = {
    updated_at: new Date().toISOString(),
    ...(u.status !== undefined ? { status: u.status } : {}),
    ...(u.statusReason !== undefined ? { status_reason: u.statusReason } : {}),
    ...(u.label !== undefined ? { label: u.label } : {}),
    ...(u.metadata !== undefined ? { metadata: u.metadata } : {}),
  }

  let request = supabase.from(TABLE).update(patch).eq("id", u.id).eq("plugin", u.plugin).eq("runtime_env", getRuntimeEnv())
  if (u.userId) request = request.eq("user_id", u.userId)

  const { data, error } = await request.select("id")
  if (error) throw new Error(`Failed to update account secret: ${error.message}`)
  return (data?.length ?? 0) > 0
}

/** True when a row was deleted; false when none matched (someone else's, or already gone). */
export async function deleteAccountSecret(
  query: PluginAccountOwnerScope & { plugin: string; id: string },
): Promise<boolean> {
  const q = parseInput(byIdSchema, query)
  let request = supabase.from(TABLE).delete().eq("id", q.id).eq("plugin", q.plugin).eq("runtime_env", getRuntimeEnv())
  if (q.userId) request = request.eq("user_id", q.userId)

  const { data, error } = await request.select("id")
  if (error) throw new Error(`Failed to delete account secret: ${error.message}`)
  return (data?.length ?? 0) > 0
}

// ---------------------------------------------------------------------------
// Secret surface — the daemon host's toolkit only.
// ---------------------------------------------------------------------------

/**
 * Inserts the account, or replaces the secret of the same account (same
 * plugin, kind, owner and `externalId` in this environment). A reconnect is a
 * fresh start: status back to `active` unless stated, reason cleared.
 */
export async function upsertAccountSecret(input: PluginAccountSecretUpsert): Promise<PluginAccountSecretRow> {
  const u = parseInput(upsertSchema, input)
  const runtimeEnv = getRuntimeEnv()
  // EncryptionKeyMissingError propagates as-is: the calling route answers 503.
  const ciphertext = envelopeCipher(runtimeEnv).encrypt(
    JSON.stringify(u.secret),
    envelopeAad({ plugin: u.plugin, kind: u.kind, runtimeEnv, userId: u.userId, externalId: u.externalId }),
  )

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      {
        plugin: u.plugin,
        kind: u.kind,
        user_id: u.userId,
        runtime_env: runtimeEnv,
        external_id: u.externalId,
        label: u.label ?? null,
        ciphertext,
        status: u.status ?? "active",
        status_reason: null,
        metadata: u.metadata ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: IDENTITY_CONFLICT },
    )
    .select(ROW_COLUMNS)
    .single()
  if (error) throw new Error(`Failed to store account secret: ${error.message}`)
  return toRow(data)
}

/** The one decrypt site. Null when no such row exists for this plugin in this environment. */
export async function openAccountSecret(query: {
  plugin: string
  id: string
}): Promise<{ row: PluginAccountSecretRow; secret: Record<string, string> } | null> {
  const q = parseInput(openSchema, query)
  const runtimeEnv = getRuntimeEnv()
  const { data, error } = await supabase
    .from(TABLE)
    .select(`${ROW_COLUMNS}, ciphertext`)
    .eq("id", q.id)
    .eq("plugin", q.plugin)
    .eq("runtime_env", runtimeEnv)
    .maybeSingle()
  if (error) throw new Error(`Failed to load account secret: ${error.message}`)
  if (!data) return null

  const { ciphertext, ...rest } = data as Record<string, unknown>
  const row = toRow(rest)
  const aad = envelopeAad({ plugin: row.plugin, kind: row.kind, runtimeEnv, userId: row.userId, externalId: row.externalId })
  let secret: Record<string, string>
  try {
    secret = secretSchema.parse(JSON.parse(envelopeCipher(runtimeEnv).decrypt(String(ciphertext), aad)))
  } catch (err) {
    // A missing key is the operator's actionable error — pass it through as is.
    if (err instanceof EncryptionKeyMissingError) throw err
    // Otherwise deliberately no detail: the cause (a rotated instance key, an
    // envelope moved from another row or environment, a truncated one) is an
    // operator question, and nothing of the payload may leak.
    throw new Error(`account secret ${q.id} cannot be opened: wrong key, or an envelope not sealed for this row`)
  }
  return { row, secret }
}
